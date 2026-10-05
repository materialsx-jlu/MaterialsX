package payments

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"strings"
)

const refundColumns = `id,order_id,amount_fen::text,reason,approval,execution,frozen_credits::text,version,created_at`

func scanRefund(row pgx.Row) (Refund, error) {
	var v Refund
	e := row.Scan(&v.ID, &v.OrderID, &v.AmountFen, &v.Reason, &v.Approval, &v.Execution, &v.Frozen, &v.Version, &v.Created)
	if errors.Is(e, pgx.ErrNoRows) {
		return v, ErrNotFound
	}
	v.Created = v.Created.UTC()
	return v, e
}
func (s *Store) Refunds(ctx context.Context, owner, order string) ([]Refund, error) {
	rows, e := s.Pool.Query(ctx, `SELECT `+refundColumns+` FROM payment_refunds WHERE account_id=$1 AND order_id=$2 ORDER BY created_at,id LIMIT 100`, owner, order)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Refund{}
	for rows.Next() {
		v, e := scanRefund(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) RequestRefund(ctx context.Context, owner, key, id, value, reason string) (Refund, error) {
	n, e := metering.Amount(value)
	reason = strings.TrimSpace(reason)
	if e != nil || n < 1 || len(reason) < 1 || len(reason) > 256 || !identifier.MatchString(key) {
		return Refund{}, ErrValidation
	}
	rid := ""
	fingerprint := fp([]string{id, value, reason})
	e = s.transaction(ctx, id, func(tx pgx.Tx, account string, o Order) error {
		if owner != account {
			return ErrNotFound
		}
		var prior string
		e := tx.QueryRow(ctx, `SELECT id,fingerprint FROM payment_refunds WHERE account_id=$1 AND idempotency_key=$2`, owner, key).Scan(&rid, &prior)
		if e == nil {
			if prior != fingerprint {
				return ErrConflict
			}
			return nil
		}
		if !errors.Is(e, pgx.ErrNoRows) {
			return e
		}
		if o.State != "paid" && o.State != "partially_refunded" {
			return ErrRefund
		}
		total, _ := metering.Amount(o.AmountFen)
		returned, _ := metering.Amount(o.RefundedFen)
		if n > total-returned || (o.Product.RefundRule == "unused-full-v1" && (n != total || returned != 0)) {
			return ErrRefund
		}
		var count int
		if e = tx.QueryRow(ctx, `SELECT count(*) FROM payment_refunds WHERE order_id=$1 AND approval IN ('requested','reviewing','approved') AND execution NOT IN ('failed','succeeded')`, id).Scan(&count); e != nil {
			return e
		}
		if count > 0 {
			return ErrConflict
		}
		if o.Product.RefundRule == "unused-full-v1" {
			candidate := Refund{AmountFen: value, Approval: "requested"}
			eligibility, err := previewTx(ctx, tx, o, candidate)
			if err != nil {
				return err
			}
			if !eligibility.Eligible {
				return ErrRefund
			}
		}
		rid = newID()
		if _, e = tx.Exec(ctx, `INSERT INTO payment_refunds(id,order_id,account_id,idempotency_key,fingerprint,amount_fen,reason) VALUES($1,$2,$3,$4,$5,$6,$7)`, rid, id, owner, key, fingerprint, n, reason); e != nil {
			return e
		}
		return audit(ctx, tx, owner, "refund.request", rid, reason)
	})
	if e != nil {
		return Refund{}, e
	}
	return scanRefund(s.Pool.QueryRow(ctx, `SELECT `+refundColumns+` FROM payment_refunds WHERE id=$1`, rid))
}
func previewTx(ctx context.Context, tx pgx.Tx, o Order, r Refund) (Preview, error) {
	v := Preview{Refund: r, OrderVersion: o.Version, RecoverCredits: "0", AvailableCredits: "0", HeldCredits: "0", Explanation: "退款只回收原订单未消耗的积分；采用累计向上取整，尾差随最后一笔退款回收。"}
	if (r.Approval != "requested" && r.Approval != "reviewing") || (o.State != "paid" && o.State != "partially_refunded") {
		return v, nil
	}
	total, _ := metering.Amount(o.AmountFen)
	refunded, _ := metering.Amount(o.RefundedFen)
	n, _ := metering.Amount(r.AmountFen)
	if n > total-refunded {
		return v, nil
	}
	var credits, consumed, held, frozen, returned, paidHeld, paidConsumed int64
	if e := tx.QueryRow(ctx, `SELECT credits,consumed,held,refund_frozen,returned,paid_held_subunits,paid_consumed_subunits FROM credit_grants WHERE id=(SELECT grant_id FROM payment_orders WHERE id=$1)`, o.ID).Scan(&credits, &consumed, &held, &frozen, &returned, &paidHeld, &paidConsumed); e != nil {
		return v, e
	}
	// Fractionally used paid packs await an approved fractional refund policy.
	if paidHeld > 0 || paidConsumed > 0 {
		v.Explanation = "该订单积分已预留或消耗；需人工核对真实消费，暂不支持按旧整数规则退款。"
	}
	recover := recoverCredits(credits, refunded, n, total) - returned
	v.RecoverCredits = amount(recover)
	v.AvailableCredits = amount(credits - consumed - held - frozen - returned)
	v.HeldCredits = amount(held)
	if o.Channel == "wechat" {
		v.AvailableCredits = metering.Display((credits-consumed-held-frozen-returned)*metering.PaidPrecision-paidHeld-paidConsumed, metering.PaidPrecision)
		v.HeldCredits = metering.Display(held*metering.PaidPrecision+paidHeld, metering.PaidPrecision)
	}
	v.Eligible = paidHeld == 0 && paidConsumed == 0 && held == 0 && frozen == 0 && recover >= 0 && recover <= credits-consumed-held-frozen-returned
	if o.Product.Kind == "subscription" {
		var later int
		if e := tx.QueryRow(ctx, `SELECT count(*) FROM subscription_periods WHERE account_id=(SELECT account_id FROM payment_orders WHERE id=$1) AND state='active' AND starts_at>=(SELECT ends_at FROM subscription_periods WHERE order_id=$1)`, o.ID).Scan(&later); e != nil {
			return v, e
		}
		v.Eligible = v.Eligible && n == total && refunded == 0 && consumed == 0 && later == 0
		v.Explanation = "联调订阅仅支持未消耗且没有后续续费期间的全额退款；复杂调整等待正式退款政策。"
	}
	if o.Product.RefundRule == "unused-full-v1" {
		v.Eligible = v.Eligible && n == total && refunded == 0 && consumed == 0 && returned == 0
		v.Explanation = "仅完全未使用的订单支持全额原路退款；任何整数或小数消费、预留、退款冻结均不符合。订阅退款成功后终止对应剩余权益。"
	}
	return v, nil
}
func (s *Store) Preview(ctx context.Context, rid string) (Preview, error) {
	var oid string
	if e := s.Pool.QueryRow(ctx, `SELECT order_id FROM payment_refunds WHERE id=$1`, rid).Scan(&oid); e != nil {
		return Preview{}, ErrNotFound
	}
	var out Preview
	e := s.transaction(ctx, oid, func(tx pgx.Tx, _ string, o Order) error {
		r, e := scanRefund(tx.QueryRow(ctx, `SELECT `+refundColumns+` FROM payment_refunds WHERE id=$1`, rid))
		if e != nil {
			return e
		}
		out, e = previewTx(ctx, tx, o, r)
		return e
	})
	return out, e
}
func (s *Store) Decide(ctx context.Context, actor, rid, decision, reason string, version, orderVersion int64) error {
	if decision != "review" && decision != "approve" && decision != "reject" {
		return ErrValidation
	}
	reason = strings.TrimSpace(reason)
	if len(reason) < 1 || len(reason) > 256 {
		return ErrValidation
	}
	var oid string
	if e := s.Pool.QueryRow(ctx, `SELECT order_id FROM payment_refunds WHERE id=$1`, rid).Scan(&oid); e != nil {
		return ErrNotFound
	}
	return s.transaction(ctx, oid, func(tx pgx.Tx, owner string, o Order) error {
		r, e := scanRefund(tx.QueryRow(ctx, `SELECT `+refundColumns+` FROM payment_refunds WHERE id=$1 FOR UPDATE`, rid))
		if e != nil {
			return e
		}
		var priorActor, priorReason *string
		if e = tx.QueryRow(ctx, `SELECT actor_id,decision_reason FROM payment_refunds WHERE id=$1`, rid).Scan(&priorActor, &priorReason); e != nil {
			return e
		}
		target := map[string]string{"review": "reviewing", "approve": "approved", "reject": "rejected"}[decision]
		if r.Approval == target && priorActor != nil && *priorActor == actor && priorReason != nil && *priorReason == reason {
			return nil
		}
		if r.Version != version || o.Version != orderVersion || (r.Approval != "requested" && r.Approval != "reviewing") {
			return ErrConflict
		}
		recover := int64(0)
		if decision == "approve" {
			v, e := previewTx(ctx, tx, o, r)
			if e != nil {
				return e
			}
			if !v.Eligible {
				return ErrRefund
			}
			recover, _ = metering.Amount(v.RecoverCredits)
			if _, e = tx.Exec(ctx, `UPDATE credit_grants SET refund_frozen=refund_frozen+$2 WHERE id=(SELECT grant_id FROM payment_orders WHERE id=$1)`, oid, recover); e != nil {
				return e
			}
			if e = refundEntry(ctx, tx, owner, oid, rid, "refund_freeze", recover, 0); e != nil {
				return e
			}
			if _, e = tx.Exec(ctx, `UPDATE payment_orders SET state='refund_pending',version=version+1 WHERE id=$1`, oid); e != nil {
				return e
			}
			if _, e = tx.Exec(ctx, `INSERT INTO payment_jobs(id,order_id,refund_id,kind) VALUES($1,$2,$1,'refund')`, rid, oid); e != nil {
				return e
			}
		}
		if _, e = tx.Exec(ctx, `UPDATE payment_refunds SET approval=$2,frozen_credits=$3,actor_id=$4,decision_reason=$5,version=version+1 WHERE id=$1`, rid, target, recover, actor, reason); e != nil {
			return e
		}
		return audit(ctx, tx, actor, "refund."+decision, rid, reason)
	})
}
func refundEntry(ctx context.Context, tx pgx.Tx, owner, oid, rid, kind string, frozen, returned int64) error {
	_, e := tx.Exec(ctx, `INSERT INTO credit_ledger(account_id,grant_id,event_id,kind,frozen_delta,returned_delta,reason) SELECT $1,grant_id,$3||':'||$4,$4,$5,$6,'original-order refund' FROM payment_orders WHERE id=$2`, owner, oid, rid, kind, frozen, returned)
	return e
}
func (s *Store) ApplyRefund(ctx context.Context, v Evidence) error {
	return s.transaction(ctx, v.OrderID, func(tx pgx.Tx, owner string, o Order) error {
		r, e := scanRefund(tx.QueryRow(ctx, `SELECT `+refundColumns+` FROM payment_refunds WHERE id=$1 AND order_id=$2 FOR UPDATE`, v.RefundID, o.ID))
		if e != nil {
			return e
		}
		n, _ := metering.Amount(r.AmountFen)
		if v.Refund != n || r.Approval != "approved" || !identifier.MatchString(v.ProviderRefundID) {
			return ErrEvidence
		}
		var txn *string
		if e = tx.QueryRow(ctx, `SELECT transaction_id FROM payment_orders WHERE id=$1`, o.ID).Scan(&txn); e != nil {
			return e
		}
		if txn == nil || v.TransactionID != *txn {
			return ErrEvidence
		}
		if e = s.evidence(ctx, tx, o, v); e != nil {
			return e
		}
		var previous *string
		if e = tx.QueryRow(ctx, `SELECT provider_refund_id FROM payment_refunds WHERE id=$1`, r.ID).Scan(&previous); e != nil {
			return e
		}
		if previous != nil && *previous != v.ProviderRefundID {
			return ErrEvidence
		}
		if r.Execution == "succeeded" || r.Execution == "failed" {
			want := "SUCCESS"
			if r.Execution == "failed" {
				want = "CLOSED"
			}
			if v.State != want {
				return ErrEvidence
			}
			return nil
		}
		if v.State == "PROCESSING" || v.State == "ABNORMAL" {
			_, e = tx.Exec(ctx, `UPDATE payment_refunds SET execution='pending',provider_refund_id=$2,version=version+1 WHERE id=$1`, r.ID, v.ProviderRefundID)
			return e
		}
		if v.State != "SUCCESS" && v.State != "CLOSED" {
			return ErrEvidence
		}
		frozen, _ := metering.Amount(r.Frozen)
		back := int64(0)
		kind := "refund_release"
		status := "failed"
		if v.State == "SUCCESS" {
			back = frozen
			kind = "refund"
			status = "succeeded"
		}
		if _, e = tx.Exec(ctx, `UPDATE credit_grants SET refund_frozen=refund_frozen-$2,returned=returned+$3 WHERE id=(SELECT grant_id FROM payment_orders WHERE id=$1)`, o.ID, frozen, back); e != nil {
			return e
		}
		if e = refundEntry(ctx, tx, owner, o.ID, r.ID, kind, -frozen, back); e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, `UPDATE payment_refunds SET execution=$2,provider_refund_id=$3,version=version+1 WHERE id=$1`, r.ID, status, v.ProviderRefundID); e != nil {
			return e
		}
		returned, _ := metering.Amount(o.RefundedFen)
		if status == "succeeded" {
			returned += n
		}
		total, _ := metering.Amount(o.AmountFen)
		state := "paid"
		if returned > 0 {
			state = "partially_refunded"
		}
		if returned == total {
			state = "refunded"
		}
		if _, e = tx.Exec(ctx, `UPDATE payment_orders SET state=$2,refunded_fen=$3,version=version+1 WHERE id=$1`, o.ID, state, returned); e != nil {
			return e
		}
		if state == "refunded" {
			if _, e = tx.Exec(ctx, `UPDATE subscription_periods SET state='canceled' WHERE order_id=$1`, o.ID); e != nil {
				return e
			}
		}
		if _, e = tx.Exec(ctx, `UPDATE payment_jobs SET state='completed' WHERE id=$1`, r.ID); e != nil {
			return e
		}
		return audit(ctx, tx, "", "refund."+status, r.ID, v.Source)
	})
}

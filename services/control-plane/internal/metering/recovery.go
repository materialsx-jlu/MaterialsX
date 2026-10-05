package metering

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
	"strconv"
	"time"
)

// Tick is restartable and safe with multiple workers. It never reissues model calls.
func (s *Store) Tick(ctx context.Context, limit int) (int, error) {
	if limit < 1 || limit > 100 {
		return 0, ErrValidation
	}
	rows, e := s.Pool.Query(ctx, `SELECT j.request_id,r.account_id FROM billing_jobs j JOIN gateway_requests r ON r.id=j.request_id WHERE j.status IN ('scheduled','pending') AND j.available_at<=clock_timestamp() ORDER BY j.available_at LIMIT $1`, limit)
	if e != nil {
		return 0, e
	}
	type candidate struct{ id, owner string }
	list := []candidate{}
	for rows.Next() {
		var v candidate
		if e = rows.Scan(&v.id, &v.owner); e != nil {
			rows.Close()
			return 0, e
		}
		list = append(list, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return 0, e
	}
	processed := 0
	for _, v := range list {
		ok, e := s.recoverOne(ctx, v.owner, v.id)
		if e != nil {
			return processed, e
		}
		if ok {
			processed++
		}
	}
	return processed, nil
}
func (s *Store) recoverOne(ctx context.Context, owner, id string) (bool, error) {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return false, e
	}
	defer tx.Rollback(ctx)
	if e = lockAccount(ctx, tx, owner); e != nil {
		return false, e
	}
	var execution string
	var dispatched, terminal bool
	var usage []byte
	var deadline time.Time
	e = tx.QueryRow(ctx, `SELECT execution,dispatched,terminal_received,usage,deadline FROM gateway_requests WHERE id=$1 FOR UPDATE`, id).Scan(&execution, &dispatched, &terminal, &usage, &deadline)
	if e != nil {
		return false, e
	}
	var created time.Time
	var attempts int
	e = tx.QueryRow(ctx, `SELECT created_at,attempts FROM billing_jobs WHERE request_id=$1 AND status IN ('scheduled','pending') AND available_at<=clock_timestamp() FOR UPDATE SKIP LOCKED`, id).Scan(&created, &attempts)
	if errors.Is(e, pgx.ErrNoRows) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	if (execution == "running" || execution == "cancel_requested") && deadline.After(time.Now()) {
		_, e = tx.Exec(ctx, `UPDATE billing_jobs SET available_at=$2 WHERE request_id=$1`, id, deadline)
		if e != nil {
			return false, e
		}
		return true, tx.Commit(ctx)
	}
	if execution == "running" || execution == "cancel_requested" {
		if _, e = tx.Exec(ctx, `UPDATE gateway_requests SET execution='unknown',settlement='reconciliation_pending',error_code='STREAM_INTERRUPTED',finished_at=clock_timestamp() WHERE id=$1`, id); e != nil {
			return false, e
		}
	}
	var u *rootflow.Usage
	if terminal && len(usage) > 0 {
		var value rootflow.Usage
		if json.Unmarshal(usage, &value) == nil {
			u = &value
		}
	}
	if e = SettleTx(ctx, tx, id, u, !dispatched, "recovery_verified_outcome"); e != nil {
		return false, e
	}
	// Missing usage remains held: 24h alert, 72h manual review; never a TTL refund.
	delay := time.Minute << min(attempts, 6)
	_, e = tx.Exec(ctx, `UPDATE billing_jobs SET attempts=attempts+1,available_at=clock_timestamp()+$2::interval,alerted_at=CASE WHEN created_at<=clock_timestamp()-interval '24 hours' THEN COALESCE(alerted_at,clock_timestamp()) ELSE alerted_at END,manual_at=CASE WHEN created_at<=clock_timestamp()-interval '72 hours' THEN COALESCE(manual_at,clock_timestamp()) ELSE manual_at END,status=CASE WHEN created_at<=clock_timestamp()-interval '72 hours' THEN 'manual' ELSE status END WHERE request_id=$1 AND status<>'completed'`, id, delay.String())
	if e != nil {
		return false, e
	}
	return true, tx.Commit(ctx)
}

type Evidence struct {
	RequestID       string          `json:"requestId"`
	ExpectedVersion int64           `json:"expectedVersion"`
	Resolution      string          `json:"resolution"`
	SourceRef       string          `json:"sourceRef"`
	Reason          string          `json:"reason"`
	Usage           *rootflow.Usage `json:"usage"`
}

func validateEvidence(in Evidence) error {
	if !identifier.MatchString(in.RequestID) || in.ExpectedVersion < 1 || !identifier.MatchString(in.SourceRef) || len(in.Reason) < 1 || len(in.Reason) > 256 || (in.Resolution != "usage" && in.Resolution != "no-call" && in.Resolution != "waiver") || ((in.Resolution == "usage") != (in.Usage != nil)) {
		return ErrValidation
	}
	if in.Usage != nil && (in.Usage.Source != "responses" || in.Usage.Uncached != nil && (in.Usage.Input == nil || in.Usage.Cached == nil || *in.Usage.Uncached != *in.Usage.Input-*in.Usage.Cached)) {
		return ErrValidation
	}
	return nil
}

// Operator evidence affects settlement only, never scientific quality or stream success.
func (s *Store) Reconcile(ctx context.Context, actor string, in Evidence) error {
	if e := validateEvidence(in); e != nil {
		return e
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var owner string
	e = tx.QueryRow(ctx, `SELECT account_id FROM credit_reservations WHERE request_id=$1`, in.RequestID).Scan(&owner)
	if errors.Is(e, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if e != nil {
		return e
	}
	if e = lockAccount(ctx, tx, owner); e != nil {
		return e
	}
	var execution string
	if e = tx.QueryRow(ctx, `SELECT execution FROM gateway_requests WHERE id=$1 FOR UPDATE`, in.RequestID).Scan(&execution); e != nil {
		return e
	}
	var old string
	e = tx.QueryRow(ctx, `SELECT fingerprint FROM reconciliation_evidence WHERE request_id=$1`, in.RequestID).Scan(&old)
	if e == nil {
		if old != fingerprint(in) {
			return ErrConflict
		}
		return tx.Commit(ctx)
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return e
	}
	var status, price string
	var version int64
	e = tx.QueryRow(ctx, `SELECT status,version,sales_price_version_id FROM credit_reservations WHERE request_id=$1 FOR UPDATE`, in.RequestID).Scan(&status, &version, &price)
	if e != nil {
		return e
	}
	if execution == "running" || execution == "cancel_requested" || status != "reconciliation_pending" || version != in.ExpectedVersion {
		return ErrConflict
	}
	if in.Usage != nil {
		if in.Usage.Source != "responses" || in.Usage.Uncached != nil && (in.Usage.Input == nil || in.Usage.Cached == nil || *in.Usage.Uncached != *in.Usage.Input-*in.Usage.Cached) {
			return ErrValidation
		}
		p, e := PriceTx(ctx, tx, price)
		if e != nil {
			return e
		}
		if _, e = p.Quote(*in.Usage); e != nil {
			return e
		}
	}
	reason := "operator_evidence"
	if in.Resolution == "waiver" {
		reason = "operator_waiver"
	}
	if e = SettleTx(ctx, tx, in.RequestID, in.Usage, in.Resolution != "usage", reason); e != nil {
		return e
	}
	if e = tx.QueryRow(ctx, `SELECT status FROM credit_reservations WHERE request_id=$1`, in.RequestID).Scan(&status); e != nil {
		return e
	}
	if status == "reconciliation_pending" {
		return ErrBudget
	}
	if in.Usage != nil {
		body, _ := json.Marshal(in.Usage)
		if _, e = tx.Exec(ctx, `UPDATE gateway_requests SET usage=$2 WHERE id=$1`, in.RequestID, body); e != nil {
			return e
		}
	}
	_, e = tx.Exec(ctx, `INSERT INTO reconciliation_evidence(request_id,fingerprint,resolution,source_ref,reason,actor_id) VALUES($1,$2,$3,$4,$5,NULLIF($6,''))`, in.RequestID, fingerprint(in), in.Resolution, in.SourceRef, in.Reason, actor)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO audit_events(actor_id,action,target_id,result,reason) VALUES(NULLIF($1,''),'billing.reconcile',$2,'succeeded',$3)`, actor, in.RequestID, in.Resolution+":"+in.SourceRef)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}

type Pending struct {
	RequestID       string     `json:"requestId"`
	AccountID       string     `json:"accountId"`
	TaskID          string     `json:"taskId"`
	Reserved        string     `json:"reservedCredits"`
	Unit            string     `json:"unit"`
	Version         int64      `json:"version"`
	Reason          string     `json:"reason"`
	JobStatus       string     `json:"jobStatus"`
	Created         time.Time  `json:"createdAt"`
	Alerted         *time.Time `json:"alertedAt"`
	Manual          *time.Time `json:"manualAt"`
	PurchaseVersion *string    `json:"purchasePriceVersionId"`
}

func (s *Store) Pending(ctx context.Context) ([]Pending, error) {
	rows, e := s.Pool.Query(ctx, `SELECT r.request_id,r.account_id,r.task_id,r.reserved::text,r.version,j.reason,j.status,r.created_at,j.alerted_at,j.manual_at,r.purchase_price_version_id,r.precision FROM credit_reservations r JOIN billing_jobs j USING(request_id) WHERE r.status='reconciliation_pending' ORDER BY r.created_at LIMIT 100`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	items := []Pending{}
	for rows.Next() {
		var v Pending
		var precision int64
		if e = rows.Scan(&v.RequestID, &v.AccountID, &v.TaskID, &v.Reserved, &v.Version, &v.Reason, &v.JobStatus, &v.Created, &v.Alerted, &v.Manual, &v.PurchaseVersion, &precision); e != nil {
			return nil, e
		}
		v.Unit = "test-credit"
		if precision == PaidPrecision {
			v.Unit = "paid-credit"
		}
		v.Reserved, e = displayText(v.Reserved, precision)
		if e != nil {
			return nil, e
		}
		v.Created = v.Created.UTC()
		items = append(items, v)
	}
	return items, rows.Err()
}

type Preview struct {
	RequestID       string  `json:"requestId"`
	Version         int64   `json:"version"`
	Reserved        string  `json:"reservedCredits"`
	Charged         string  `json:"chargedCredits"`
	Released        string  `json:"releaseCredits"`
	PurchaseCostFen *string `json:"purchaseCostFen"`
	SalesPrice      string  `json:"salesPriceVersionId"`
	Resolution      string  `json:"resolution"`
	Unit            string  `json:"unit"`
}

func (s *Store) Preview(ctx context.Context, in Evidence) (Preview, error) {
	result := Preview{RequestID: in.RequestID, Resolution: in.Resolution}
	if e := validateEvidence(in); e != nil {
		return result, e
	}
	tx, e := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return result, e
	}
	defer tx.Rollback(ctx)
	var status, execution string
	var price string
	var purchase *string
	var reserved, input, output, precision int64
	e = tx.QueryRow(ctx, `SELECT r.status,r.version,r.reserved,r.input_bound,r.output_bound,r.sales_price_version_id,r.purchase_price_version_id,g.execution,r.precision FROM credit_reservations r JOIN gateway_requests g ON g.id=r.request_id WHERE r.request_id=$1`, in.RequestID).Scan(&status, &result.Version, &reserved, &input, &output, &price, &purchase, &execution, &precision)
	if errors.Is(e, pgx.ErrNoRows) {
		return result, ErrNotFound
	}
	if e != nil {
		return result, e
	}
	if status != "reconciliation_pending" || result.Version != in.ExpectedVersion || execution == "running" || execution == "cancel_requested" {
		return result, ErrConflict
	}
	charged := int64(0)
	if in.Usage != nil {
		p, e := PriceTx(ctx, tx, price)
		if e != nil {
			return result, e
		}
		charged, e = p.Quote(*in.Usage)
		if e != nil {
			return result, e
		}
		if *in.Usage.Input > input || *in.Usage.Output > output || charged > reserved {
			return result, ErrBudget
		}
		if purchase != nil {
			p, e := PurchaseTx(ctx, tx, *purchase)
			if e != nil {
				return result, e
			}
			v, e := p.Quote(*in.Usage)
			if e == nil {
				c := strconv.FormatInt(v, 10)
				result.PurchaseCostFen = &c
			}
		}
	} else if in.Resolution == "no-call" {
		zero := "0"
		result.PurchaseCostFen = &zero
	}
	result.Unit = "test-credit"
	if precision == PaidPrecision {
		result.Unit = "paid-credit"
	}
	result.Reserved = Display(reserved, precision)
	result.Charged = Display(charged, precision)
	result.Released = Display(reserved-charged, precision)
	result.SalesPrice = price
	return result, tx.Commit(ctx)
}

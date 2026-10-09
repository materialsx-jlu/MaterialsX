package mxpoints

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jamip/materialsx/control-plane/internal/mxpricing"
	"github.com/jamip/materialsx/control-plane/internal/payments"
)

type Store struct {
	Pool                              *pgxpool.Pool
	Provider                          payments.Provider
	Merchant                          string
	AppID                             string
	Mode                              string // disabled, test, wechat pilot, or explicitly enabled live MX checkout.
	PilotAccount                      string // development-only real-payment pilot; only the ¥10 product is admitted.
	ReleaseID, ReleasePath, APIOrigin string
}

func FromPayments(pool *pgxpool.Pool, payment *payments.Store, environment string) (*Store, error) {
	s := &Store{Pool: pool, Provider: payment.Provider, Merchant: payment.Merchant, AppID: payment.AppID, Mode: "disabled"}
	switch os.Getenv("MATERIALSX_MX03_PAYMENT_MODE") {
	case "":
		return s, nil
	case "test":
		if environment != "development" || payment.Mode != "test" {
			return nil, ErrDisabled
		}
		if _, ok := payment.Provider.(*payments.TestProvider); !ok {
			return nil, ErrDisabled
		}
		s.Mode = "test"
		return s, nil
	case "wechat-pilot":
		// The upstream payment pilot already pins a single local account, database,
		// callback origin and real WeChat provider. MX adds its own explicit switch.
		if environment != "development" || payment.Mode != "wechat-pilot" || payment.PilotAccount == "" ||
			os.Getenv("MATERIALSX_MX03_PILOT_ACCOUNT") != payment.PilotAccount {
			return nil, ErrDisabled
		}
		if _, ok := payment.Provider.(*payments.Wechat); !ok {
			return nil, ErrDisabled
		}
		s.Mode, s.PilotAccount = "wechat", payment.PilotAccount
		return s, nil
	case "wechat-live":
		if environment != "development" || payment.Mode != "wechat-mx-live" || os.Getenv("MATERIALSX_MX03_GATEWAY_MODE") != "wallet" || os.Getenv("MATERIALSX_MX03_PRICE_VERSION") != mxpricing.ApprovedVersion {
			return nil, ErrDisabled
		}
		if _, ok := payment.Provider.(*payments.Wechat); !ok {
			return nil, ErrDisabled
		}
		tx, err := pool.Begin(context.Background())
		if err != nil {
			return nil, err
		}
		defer tx.Rollback(context.Background())
		bundle, err := mxpricing.LoadBundle(context.Background(), tx, mxpricing.ApprovedVersion+"-purchase", mxpricing.ApprovedVersion+"-fx", mxpricing.ApprovedVersion+"-retail")
		if err != nil || bundle.Purchase.Status != "approved" || bundle.FX.Status != "approved" || bundle.Retail.Status != "approved" {
			return nil, ErrDisabled
		}
		s.Mode = "wechat-live"
		return s, nil
	case "wechat-production":
		if environment != "production" || payment.Mode != "wechat-native" || !payment.MXOnly ||
			os.Getenv("MATERIALSX_CLOUD_MODE") != "mx-production" || os.Getenv("MATERIALSX_MX03_GATEWAY_MODE") != "wallet-production" ||
			os.Getenv("MATERIALSX_MX03_PRICE_VERSION") != payment.MXReleaseID || payment.MXReleaseID != mxpricing.ApprovedVersion ||
			payment.MXReleasePath == "" || payment.MXAPIOrigin == "" || payment.Merchant == "" {
			return nil, ErrDisabled
		}
		if _, ok := payment.Provider.(*payments.Wechat); !ok {
			return nil, ErrDisabled
		}
		s.Mode, s.ReleaseID, s.ReleasePath, s.APIOrigin = "wechat-production", payment.MXReleaseID, payment.MXReleasePath, payment.MXAPIOrigin
		return s, nil
	default:
		// Real MX sales require the 0.3.4 price and 0.3.7 release gates.
		return nil, ErrDisabled
	}
}

func (s *Store) Products(ctx context.Context) ([]Product, error) {
	ready := s.Mode != "wechat-production" || s.ProductionReady(ctx)
	rows, err := s.Pool.Query(ctx, `SELECT id,name,amount_fen,points_subunits,policy_version FROM mx_point_products ORDER BY amount_fen`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Product{}
	for rows.Next() {
		var p Product
		var amount, points int64
		if err := rows.Scan(&p.ID, &p.Name, &amount, &points, &p.PolicyVersion); err != nil {
			return nil, err
		}
		p.AmountFen, p.Points, p.Enabled, p.TestOnly = strconv.FormatInt(amount, 10), Points(points), s.Mode != "disabled" && ready, s.Mode == "test"
		out = append(out, p)
	}
	return out, rows.Err()
}

const orderColumns = `id,product_id,amount_fen,points_subunits,channel,state,checkout_state,close_requested,code_url,version,created_at,expires_at,paid_at`

func scanOrder(row pgx.Row) (Order, error) {
	var o Order
	var amount, points int64
	err := row.Scan(&o.ID, &o.ProductID, &amount, &points, &o.Channel, &o.State, &o.CheckoutState, &o.CloseRequested, &o.CodeURL, &o.Version, &o.CreatedAt, &o.ExpiresAt, &o.PaidAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return o, ErrNotFound
	}
	if err != nil {
		return o, err
	}
	o.AmountFen, o.Points = strconv.FormatInt(amount, 10), Points(points)
	return o, nil
}
func (s *Store) Order(ctx context.Context, owner, orderID string) (Order, error) {
	return scanOrder(s.Pool.QueryRow(ctx, `SELECT `+orderColumns+` FROM mx_point_orders WHERE account_id=$1 AND id=$2`, owner, orderID))
}
func (s *Store) Orders(ctx context.Context, owner string) ([]Order, error) {
	rows, err := s.Pool.Query(ctx, `SELECT `+orderColumns+` FROM mx_point_orders WHERE account_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Order{}
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// Cancel requests a channel close. The order remains pending until the channel
// reports CLOSED; a verified late SUCCESS still grants the purchased points.
func (s *Store) Cancel(ctx context.Context, owner, orderID string) (Order, error) {
	if !identifier.MatchString(orderID) {
		return Order{}, ErrValidation
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Order{}, err
	}
	defer tx.Rollback(ctx)
	if err = lockAccount(ctx, tx, owner, false); err != nil {
		return Order{}, err
	}
	var state string
	err = tx.QueryRow(ctx, `SELECT state FROM mx_point_orders WHERE id=$1 AND account_id=$2 FOR UPDATE`, orderID, owner).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return Order{}, ErrNotFound
	}
	if err != nil {
		return Order{}, err
	}
	if state != "pending" && state != "closed" {
		return Order{}, ErrConflict
	}
	if state == "pending" {
		if _, err = tx.Exec(ctx, `UPDATE mx_point_orders SET close_requested=true,version=version+1 WHERE id=$1 AND close_requested=false`, orderID); err != nil {
			return Order{}, err
		}
		if _, err = tx.Exec(ctx, `UPDATE mx_point_jobs SET state='pending',available_at=clock_timestamp() WHERE id=$1 AND kind='order' AND state IN ('pending','manual')`, orderID); err != nil {
			return Order{}, err
		}
		if err = audit(ctx, tx, owner, "mx.order_cancel_requested", orderID, "customer_requested_channel_close"); err != nil {
			return Order{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return Order{}, err
	}
	return s.Order(ctx, owner, orderID)
}
func lockAccount(ctx context.Context, tx pgx.Tx, owner string, requireActive bool) error {
	var status string
	err := tx.QueryRow(ctx, `SELECT status FROM accounts WHERE id=$1 FOR UPDATE`, owner).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if requireActive && status != "active" {
		return ErrDisabled
	}
	return nil
}
func ledger(ctx context.Context, tx pgx.Tx, owner, order, reservation, refund, event, kind string, grant, held, spent, frozen, returned int64) error {
	_, err := tx.Exec(ctx, `INSERT INTO mx_point_ledger(account_id,order_id,reservation_id,refund_id,event_id,kind,granted_delta,held_delta,consumed_delta,frozen_delta,returned_delta,reason)
 VALUES($1,$2,NULLIF($3,''),NULLIF($4,''),$5,$6,$7,$8,$9,$10,$11,$12)`, owner, order, reservation, refund, event, kind, grant, held, spent, frozen, returned, kind)
	return err
}
func audit(ctx context.Context, tx pgx.Tx, actor, action, target, reason string) error {
	_, err := tx.Exec(ctx, `INSERT INTO audit_events(actor_id,action,target_id,result,reason) VALUES(NULLIF($1,''),$2,$3,'succeeded',$4)`, actor, action, target, reason)
	return err
}
func (s *Store) Create(ctx context.Context, owner, key, productID string) (Order, error) {
	if (s.Mode != "test" && s.Mode != "wechat" && s.Mode != "wechat-live" && s.Mode != "wechat-production") || s.Provider == nil {
		return Order{}, ErrDisabled
	}
	if s.PilotAccount != "" && (owner != s.PilotAccount || productID != "mx-cny-10-v1") {
		return Order{}, ErrDisabled
	}
	if !identifier.MatchString(key) || !identifier.MatchString(productID) {
		return Order{}, ErrValidation
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Order{}, err
	}
	defer tx.Rollback(ctx)
	if err = lockAccount(ctx, tx, owner, true); err != nil {
		return Order{}, err
	}
	channel := "wechat"
	if s.Mode == "test" {
		channel = "test"
	}
	fp := fingerprint([]string{productID, channel})
	var previousID, previousFP string
	err = tx.QueryRow(ctx, `SELECT id,fingerprint FROM mx_point_orders WHERE account_id=$1 AND idempotency_key=$2`, owner, key).Scan(&previousID, &previousFP)
	if err == nil {
		if previousFP != fp {
			return Order{}, ErrConflict
		}
		if err = tx.Commit(ctx); err != nil {
			return Order{}, err
		}
		return s.Order(ctx, owner, previousID)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Order{}, err
	}
	if err = s.productionReadyTx(ctx, tx); err != nil {
		return Order{}, err
	}
	var paused bool
	if err = tx.QueryRow(ctx, `SELECT sales_paused FROM operations_controls WHERE id FOR SHARE`).Scan(&paused); err != nil {
		return Order{}, err
	}
	if paused {
		return Order{}, ErrDisabled
	}
	var pending int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM mx_point_orders WHERE account_id=$1 AND state='pending' AND expires_at>clock_timestamp()`, owner).Scan(&pending); err != nil {
		return Order{}, err
	}
	if pending >= 3 {
		return Order{}, ErrConflict
	}
	var amount, points int64
	if err = tx.QueryRow(ctx, `SELECT amount_fen,points_subunits FROM mx_point_products WHERE id=$1`, productID).Scan(&amount, &points); errors.Is(err, pgx.ErrNoRows) {
		return Order{}, ErrNotFound
	} else if err != nil {
		return Order{}, err
	}
	orderID := id("mx") // 32 chars, inside WeChat's out_trade_no boundary.
	_, err = tx.Exec(ctx, `INSERT INTO mx_point_orders(id,account_id,idempotency_key,fingerprint,product_id,amount_fen,points_subunits,channel,expires_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+interval '20 minutes')`, orderID, owner, key, fp, productID, amount, points, channel)
	if err != nil {
		return Order{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO mx_point_jobs(id,order_id,kind) VALUES($1,$1,'order')`, orderID); err != nil {
		return Order{}, err
	}
	if err = audit(ctx, tx, owner, "mx.order_create", orderID, "fixed_product_snapshot"); err != nil {
		return Order{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Order{}, err
	}
	return s.Order(ctx, owner, orderID)
}
func (s *Store) providerOrder(ctx context.Context, orderID string) (payments.Order, error) {
	var owner, name, channel string
	var amount int64
	var expires time.Time
	err := s.Pool.QueryRow(ctx, `SELECT o.account_id,p.name,o.channel,o.amount_fen,o.expires_at FROM mx_point_orders o JOIN mx_point_products p ON p.id=o.product_id WHERE o.id=$1`, orderID).Scan(&owner, &name, &channel, &amount, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return payments.Order{}, ErrNotFound
	}
	if err != nil {
		return payments.Order{}, err
	}
	return payments.Order{ID: orderID, AmountFen: strconv.FormatInt(amount, 10), Currency: "CNY", Channel: channel,
		Product: payments.Product{Name: name, TestOnly: channel == "test"}, Expires: expires}, nil
}
func (s *Store) storeEvidence(ctx context.Context, tx pgx.Tx, orderID string, v payments.Evidence) error {
	if v.OrderID != orderID || (v.Currency != "CNY" && !v.AmountlessClose()) || v.Merchant != s.Merchant || v.AppID != s.AppID || !identifier.MatchString(v.ID) || (v.Source != "query" && v.Source != "notification" && v.Source != "test") {
		return ErrEvidence
	}
	var prior string
	err := tx.QueryRow(ctx, `SELECT fingerprint FROM mx_point_evidence WHERE id=$1`, v.ID).Scan(&prior)
	if err == nil {
		if prior != fingerprint(v) {
			return ErrEvidence
		}
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	body, _ := json.Marshal(v)
	_, err = tx.Exec(ctx, `INSERT INTO mx_point_evidence(id,fingerprint,order_id,refund_id,source,body)
 VALUES($1,$2,$3,NULLIF($4,''),$5,$6)`, v.ID, fingerprint(v), orderID, v.RefundID, v.Source, body)
	return err
}
func (s *Store) ApplyPayment(ctx context.Context, v payments.Evidence) error {
	if !strings.HasPrefix(v.OrderID, "mx") || v.RefundID != "" {
		return ErrEvidence
	}
	var owner string
	if err := s.Pool.QueryRow(ctx, `SELECT account_id FROM mx_point_orders WHERE id=$1`, v.OrderID).Scan(&owner); err != nil {
		return ErrNotFound
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = lockAccount(ctx, tx, owner, false); err != nil {
		return err
	}
	var state, channel string
	var amount, points int64
	var prior *string
	err = tx.QueryRow(ctx, `SELECT state,channel,amount_fen,points_subunits,transaction_id FROM mx_point_orders WHERE id=$1 FOR UPDATE`, v.OrderID).Scan(&state, &channel, &amount, &points, &prior)
	if err != nil {
		return err
	}
	if (v.Total != amount && !v.AmountlessClose()) || (channel == "test") != (v.Source == "test") {
		return ErrEvidence
	}
	if err = s.storeEvidence(ctx, tx, v.OrderID, v); err != nil {
		return err
	}
	switch v.State {
	case "NOTPAY", "USERPAYING":
		return tx.Commit(ctx)
	case "CLOSED":
		if state == "pending" {
			if _, err = tx.Exec(ctx, `UPDATE mx_point_orders SET state='closed',version=version+1 WHERE id=$1`, v.OrderID); err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, `UPDATE mx_point_jobs SET state='completed' WHERE id=$1`, v.OrderID); err != nil {
				return err
			}
		}
		return tx.Commit(ctx)
	case "SUCCESS":
	default:
		return ErrEvidence
	}
	if !identifier.MatchString(v.TransactionID) || v.PaidAt.IsZero() || v.PaidAt.After(time.Now().Add(5*time.Minute)) {
		return ErrEvidence
	}
	if prior != nil {
		if *prior != v.TransactionID {
			return ErrEvidence
		}
		return tx.Commit(ctx)
	}
	var previousTotal int64
	if err = tx.QueryRow(ctx, `SELECT COALESCE(sum(granted),0) FROM mx_point_batches WHERE account_id=$1`, owner).Scan(&previousTotal); err != nil {
		return err
	}
	const maxAccountSubunits int64 = 1_000_000_000_000_000
	if previousTotal > maxAccountSubunits-points {
		return ErrConflict
	}
	// A late, verified payment must still create exactly one batch, even after a local close.
	_, err = tx.Exec(ctx, `INSERT INTO mx_point_batches(order_id,account_id,granted) VALUES($1,$2,$3)`, v.OrderID, owner, points)
	if err != nil {
		return err
	}
	if err = ledger(ctx, tx, owner, v.OrderID, "", "", "mx:paid:"+v.OrderID, "grant", points, 0, 0, 0, 0); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE mx_point_orders SET state='paid',transaction_id=$2,paid_at=$3,version=version+1 WHERE id=$1`, v.OrderID, v.TransactionID, v.PaidAt.UTC()); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE mx_point_jobs SET state='completed' WHERE id=$1`, v.OrderID); err != nil {
		return err
	}
	if err = audit(ctx, tx, "", "mx.payment_verified", v.OrderID, v.Source); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

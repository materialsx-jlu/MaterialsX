package payments

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"regexp"
)

// These immutable products implement the owner's explicitly authorized development
// purchase. This is not a general live price publisher or a production sales switch.
func PilotSubscription() Product {
	return Product{ID: "wechat-pilot-month-100fen-v1", Name: "真实支付联调 · 月度订阅", Kind: "subscription", Currency: "CNY", PriceFen: "100", Credits: "1000", ValidDays: 30, RefundPolicyVersion: "pilot-unused-v1", RefundRule: "unused-proportional-v1", DailyLimit: "1000", MonthlyLimit: "1000", RequestLimit: 1}
}
func PilotDiagnosticPack() Product {
	return Product{ID: "wechat-pilot-import-1fen-v1", Name: "已付诊断订单补发积分", Kind: "pack", Currency: "CNY", PriceFen: "1", Credits: "10", ValidDays: 30, RefundPolicyVersion: "pilot-unused-v1", RefundRule: "unused-proportional-v1", DailyLimit: "10", MonthlyLimit: "10", RequestLimit: 1}
}
func paymentUnit(o Order) string {
	if o.Channel == "wechat" && !o.Product.TestOnly {
		return "paid-credit"
	}
	return "test-credit"
}

// ImportPaidDiagnostic is operator-only: first query the signed provider response,
// then bind the original payment ID to one nominated account. Never submit a new
// prepay for the historic order; apply through the same atomic settlement path.
func (s *Store) ImportPaidDiagnostic(ctx context.Context, id string) (Order, error) {
	if s.Mode != "wechat-pilot" || s.PilotAccount == "" || s.Provider == nil || !regexp.MustCompile(`^mxp[0-9a-f]{24}$`).MatchString(id) {
		return Order{}, ErrDisabled
	}
	p := PilotDiagnosticPack()
	v, e := s.Provider.Query(ctx, Order{ID: id, Product: p, AmountFen: "1", Currency: "CNY", Channel: "wechat"})
	if e != nil {
		return Order{}, e
	}
	if v.OrderID != id || v.State != "SUCCESS" || v.Source != "query" || v.Total != 1 || v.Currency != "CNY" || v.Merchant != s.Merchant || v.AppID != s.AppID || v.TransactionID == "" || v.PaidAt.IsZero() {
		return Order{}, ErrEvidence
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Order{}, e
	}
	defer tx.Rollback(ctx)
	if e = accountLock(ctx, tx, s.PilotAccount); e != nil {
		return Order{}, e
	}
	var existingOwner, existingProduct string
	e = tx.QueryRow(ctx, `SELECT account_id,product_id FROM payment_orders WHERE id=$1`, id).Scan(&existingOwner, &existingProduct)
	if e == nil {
		if existingOwner != s.PilotAccount || existingProduct != p.ID {
			return Order{}, ErrConflict
		}
	} else if !errors.Is(e, pgx.ErrNoRows) {
		return Order{}, e
	} else {
		var imports int
		if e = tx.QueryRow(ctx, `SELECT count(*) FROM payment_orders WHERE account_id=$1 AND product_id=$2`, s.PilotAccount, p.ID).Scan(&imports); e != nil {
			return Order{}, e
		}
		if imports != 0 {
			return Order{}, ErrDisabled
		}
		b, _ := json.Marshal(p)
		if _, e = tx.Exec(ctx, `INSERT INTO payment_orders(id,account_id,idempotency_key,fingerprint,product_id,snapshot,amount_fen,currency,test_only,channel,checkout_state,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,1,'CNY',false,'wechat','ready',$7::timestamptz,$7::timestamptz+interval '20 minutes')`, id, s.PilotAccount, "import:"+id, fp([]string{"verified-diagnostic-import", id}), p.ID, b, v.PaidAt); e != nil {
			return Order{}, e
		}
		if e = audit(ctx, tx, s.PilotAccount, "payment.import_verified_diagnostic", id, "signed upstream SUCCESS queried before import; one fen ten paid credits"); e != nil {
			return Order{}, e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return Order{}, e
	}
	if e = s.ApplyPayment(ctx, v); e != nil {
		return Order{}, e
	}
	return s.Order(ctx, s.PilotAccount, id)
}

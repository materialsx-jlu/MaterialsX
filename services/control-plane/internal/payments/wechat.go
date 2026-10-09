package payments

import (
	"context"
	"errors"
	"github.com/jamip/materialsx/control-plane/internal/lifecycle"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"github.com/jamip/materialsx/control-plane/internal/mxpricing"
	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/core/auth/verifiers"
	"github.com/wechatpay-apiv3/wechatpay-go/core/notify"
	"github.com/wechatpay-apiv3/wechatpay-go/core/option"
	wxpayments "github.com/wechatpay-apiv3/wechatpay-go/services/payments"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments/native"
	"github.com/wechatpay-apiv3/wechatpay-go/services/refunddomestic"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Wechat struct {
	client                   *core.Client
	notify                   *notify.Handler
	merchant, app, notifyURL string
}

func FromEnv(ctx context.Context, s *Store, environment, database, origin string) error {
	mode := os.Getenv("MATERIALSX_PAYMENT_MODE")
	if mode == "" || mode == "disabled" {
		s.Mode = "disabled"
		return nil
	}
	if mode == "test" {
		if environment != "development" || !strings.Contains(database, "test") || (os.Getenv("MATERIALSX_CLOUD_MODE") == "alpha" && os.Getenv("MATERIALSX_METERING_PRICE_VERSION") == "") {
			return ErrDisabled
		}
		s.Mode = "test"
		s.Merchant = "synthetic-merchant"
		s.AppID = "synthetic-app"
		s.Provider = NewTestProvider(s.Merchant, s.AppID)
		return nil
	}
	if mode == "wechat-pilot" {
		// A development-only, single-account, one-yuan authorization. No inherited
		// environment can silently enable production billing or provider generation.
		databaseURL, parseError := url.Parse(database)
		if environment != "development" || os.Getenv("MATERIALSX_CLOUD_MODE") != "disabled" || parseError != nil || databaseURL.Path != "/materialsx_local_dev" || origin != "http://127.0.0.1:8788" || os.Getenv("MATERIALSX_WECHAT_PILOT_ACCOUNT") == "" {
			return ErrDisabled
		}
		account := os.Getenv("MATERIALSX_WECHAT_PILOT_ACCOUNT")
		var valid bool
		if e := s.Pool.QueryRow(ctx, `SELECT email='developer@materialsx.local' AND role='user' AND status='active' FROM accounts WHERE id=$1`, account).Scan(&valid); e != nil || !valid {
			return ErrDisabled
		}
		w, e := NewWechat(ctx, os.Getenv("MATERIALSX_WECHAT_NOTIFY_ORIGIN"))
		if e != nil {
			return e
		}
		s.Mode = mode
		s.PilotAccount = account
		s.Provider = w
		s.Merchant = w.merchant
		s.AppID = w.app
		return nil
	}
	if mode == "wechat-mx-live" {
		// Real MX checkout on the loopback deployment has its own explicit mode.
		// Legacy M5 products remain disabled; only MX fixed-denomination orders use
		// this provider. Callback origin is validated by NewWechat.
		databaseURL, parseError := url.Parse(database)
		if environment != "development" || parseError != nil || databaseURL.Path != "/materialsx_local_dev" ||
			origin != "http://127.0.0.1:8788" || os.Getenv("MATERIALSX_MX03_PAYMENT_MODE") != "wechat-live" ||
			os.Getenv("MATERIALSX_MX03_GATEWAY_MODE") != "wallet" ||
			os.Getenv("MATERIALSX_MX03_PRICE_VERSION") != mxpricing.ApprovedVersion ||
			os.Getenv("MATERIALSX_CLOUD_MODE") != "alpha" {
			return ErrDisabled
		}
		w, e := NewWechat(ctx, os.Getenv("MATERIALSX_WECHAT_NOTIFY_ORIGIN"))
		if e != nil {
			return e
		}
		s.Mode, s.Provider, s.Merchant, s.AppID = mode, w, w.merchant, w.app
		return nil
	}
	if mode != "wechat-native" || environment != "production" {
		return ErrDisabled
	}
	if os.Getenv("MATERIALSX_CLOUD_MODE") == "mx-production" {
		path := os.Getenv("MATERIALSX_MX_PRODUCTION_APPROVAL_FILE")
		if os.Getenv("MATERIALSX_MX03_PAYMENT_MODE") != "wechat-production" ||
			os.Getenv("MATERIALSX_MX03_GATEWAY_MODE") != "wallet-production" || os.Getenv("MATERIALSX_MX03_PRICE_VERSION") != mxpricing.ApprovedVersion || path == "" {
			return ErrDisabled
		}
		w, err := NewWechat(ctx, origin)
		if err != nil {
			return err
		}
		s.Mode, s.Provider, s.Merchant, s.AppID = mode, w, w.merchant, w.app
		s.MXOnly, s.MXReleaseID, s.MXReleasePath, s.MXAPIOrigin = true, mxpricing.ApprovedVersion, path, origin
		return nil
	}
	a, err := lifecycle.ReadApprovals(os.Getenv("MATERIALSX_BETA_APPROVALS_FILE"), "rootflow-sol-responses-2026-10-01-v1")
	s.ApprovalsPath = os.Getenv("MATERIALSX_BETA_APPROVALS_FILE")
	s.FormalEnabled = err == nil && len(a.Missing(time.Now().UTC())) == 0 && os.Getenv("MATERIALSX_CLOUD_MODE") == "paid-beta" && os.Getenv("MATERIALSX_INPUT_COUNTER_EXECUTABLE") != ""
	w, e := NewWechat(ctx, origin)
	if e != nil {
		return e
	}
	s.Mode = mode
	s.Provider = w
	s.Merchant = w.merchant
	s.AppID = w.app
	return nil
}

// Public-key mode avoids fetching certificates at startup. Rotation is an explicit deployment operation.
func NewWechat(ctx context.Context, origin string) (*Wechat, error) {
	cfg, e := loadWechatConfig(os.Getenv)
	if e != nil {
		return nil, ErrValidation
	}
	return newWechat(ctx, cfg, origin)
}

func newWechat(ctx context.Context, cfg wechatConfig, origin string) (*Wechat, error) {
	if !wechatOriginValid(origin) || !cfg.identifiersValid() {
		return nil, ErrValidation
	}
	private, e := cfg.privateKey()
	if e != nil {
		return nil, ErrValidation
	}
	public, e := cfg.publicKey()
	if e != nil {
		return nil, ErrValidation
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 8 * time.Second
	client, e := core.NewClient(ctx, option.WithWechatPayPublicKeyAuthCipher(cfg.merchant, cfg.serial, private, cfg.keyID, public), option.WithHTTPClient(&http.Client{Timeout: 8 * time.Second, Transport: transport, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return errors.New("redirect rejected") }}))
	if e != nil {
		return nil, ErrValidation
	}
	handler, e := notify.NewRSANotifyHandler(cfg.apiKey, verifiers.NewSHA256WithRSAPubkeyVerifier(cfg.keyID, *public))
	if e != nil {
		return nil, ErrValidation
	}
	return &Wechat{client, handler, cfg.merchant, cfg.app, origin + "/v1/payments/wechat/notify"}, nil
}
func (w *Wechat) Create(ctx context.Context, o Order) (string, error) {
	if o.Product.TestOnly || o.Channel != "wechat" {
		return "", ErrDisabled
	}
	n, e := metering.Amount(o.AmountFen)
	if e != nil {
		return "", e
	}
	svc := native.NativeApiService{Client: w.client}
	v, _, e := svc.Prepay(ctx, native.PrepayRequest{Appid: core.String(w.app), Mchid: core.String(w.merchant), OutTradeNo: core.String(o.ID), Description: core.String(o.Product.Name), NotifyUrl: core.String(w.notifyURL), TimeExpire: &o.Expires, Amount: &native.Amount{Total: &n, Currency: core.String("CNY")}})
	if e != nil {
		return "", ErrDisabled
	}
	if v == nil || v.CodeUrl == nil || !strings.HasPrefix(*v.CodeUrl, "weixin://wxpay/") {
		return "", ErrEvidence
	}
	return *v.CodeUrl, nil
}
func (w *Wechat) transaction(v *wxpayments.Transaction, source, event string) (Evidence, error) {
	if v == nil || v.OutTradeNo == nil || v.Mchid == nil || v.Appid == nil || v.TradeState == nil {
		return Evidence{}, ErrEvidence
	}
	if v.Amount == nil && source == "query" && *v.TradeState == "CLOSED" && v.TransactionId == nil && v.SuccessTime == nil {
		out := Evidence{OrderID: *v.OutTradeNo, Merchant: *v.Mchid, AppID: *v.Appid, State: "CLOSED", Source: "query"}
		out.ID = "query:" + fp(out)
		return out, nil
	}
	if v.Amount == nil || v.Amount.Total == nil || v.Amount.Currency == nil {
		return Evidence{}, ErrEvidence
	}
	out := Evidence{OrderID: *v.OutTradeNo, Merchant: *v.Mchid, AppID: *v.Appid, Currency: *v.Amount.Currency, Total: *v.Amount.Total, State: *v.TradeState, Source: source}
	if v.TransactionId != nil {
		out.TransactionID = *v.TransactionId
	}
	if v.SuccessTime != nil {
		t, e := time.Parse(time.RFC3339, *v.SuccessTime)
		if e != nil {
			return out, ErrEvidence
		}
		out.PaidAt = t
	}
	out.ID = event
	if event == "" {
		out.ID = "query:" + fp(out)
	}
	return out, nil
}
func (w *Wechat) Query(ctx context.Context, o Order) (Evidence, error) {
	svc := native.NativeApiService{Client: w.client}
	v, _, e := svc.QueryOrderByOutTradeNo(ctx, native.QueryOrderByOutTradeNoRequest{OutTradeNo: core.String(o.ID), Mchid: core.String(w.merchant)})
	if e != nil {
		return Evidence{}, ErrDisabled
	}
	return w.transaction(v, "query", "")
}
func (w *Wechat) Close(ctx context.Context, o Order) error {
	svc := native.NativeApiService{Client: w.client}
	_, e := svc.CloseOrder(ctx, native.CloseOrderRequest{OutTradeNo: core.String(o.ID), Mchid: core.String(w.merchant)})
	if e != nil {
		return ErrDisabled
	}
	return nil
}
func (w *Wechat) refund(v *refunddomestic.Refund) (Evidence, error) {
	if v == nil || v.Amount == nil || v.Amount.Total == nil || v.Amount.Refund == nil || v.Amount.Currency == nil || v.Status == nil || v.OutRefundNo == nil || v.OutTradeNo == nil || v.RefundId == nil || v.TransactionId == nil {
		return Evidence{}, ErrEvidence
	}
	out := Evidence{OrderID: *v.OutTradeNo, RefundID: *v.OutRefundNo, ProviderRefundID: *v.RefundId, TransactionID: *v.TransactionId, Merchant: w.merchant, AppID: w.app, Currency: *v.Amount.Currency, Total: *v.Amount.Total, Refund: *v.Amount.Refund, State: string(*v.Status), Source: "query"}
	out.ID = "query:" + fp(out)
	return out, nil
}
func (w *Wechat) Refund(ctx context.Context, o Order, r Refund) (Evidence, error) {
	n, e := metering.Amount(r.AmountFen)
	total, e2 := metering.Amount(o.AmountFen)
	if e != nil || e2 != nil {
		return Evidence{}, ErrValidation
	}
	svc := refunddomestic.RefundsApiService{Client: w.client} // Do not transmit user-entered reasons/PII to the provider.
	v, _, e := svc.Create(ctx, refunddomestic.CreateRequest{OutTradeNo: core.String(o.ID), OutRefundNo: core.String(r.ID), Reason: core.String("MaterialsX approved refund"), Amount: &refunddomestic.AmountReq{Refund: &n, Total: &total, Currency: core.String("CNY")}})
	if e != nil {
		return Evidence{}, ErrDisabled
	}
	return w.refund(v)
}
func (w *Wechat) QueryRefund(ctx context.Context, _ Order, r Refund) (Evidence, error) {
	svc := refunddomestic.RefundsApiService{Client: w.client}
	v, _, e := svc.QueryByOutRefundNo(ctx, refunddomestic.QueryByOutRefundNoRequest{OutRefundNo: core.String(r.ID)})
	if e != nil {
		return Evidence{}, ErrDisabled
	}
	return w.refund(v)
}

// Payment notifications are verified + decrypted before parsing. Refunds are recovered by signed queries;
// no second unaudited callback path. Amounts remain exact int64 and no payer identifiers are persisted.
func (w *Wechat) Notification(ctx context.Context, r *http.Request) (Evidence, error) {
	ts, e := strconv.ParseInt(r.Header.Get("Wechatpay-Timestamp"), 10, 64)
	now := time.Now().Unix()
	if e != nil || ts < now-300 || ts > now+300 {
		return Evidence{}, ErrEvidence
	}
	var value wxpayments.Transaction
	event, e := w.notify.ParseNotifyRequest(ctx, r, &value)
	if e != nil || event.EventType != "TRANSACTION.SUCCESS" {
		return Evidence{}, ErrEvidence
	}
	out, e := w.transaction(&value, "notification", event.ID)
	if e != nil {
		return out, e
	}
	if out.State != "SUCCESS" {
		return out, ErrEvidence
	}
	return out, nil
}

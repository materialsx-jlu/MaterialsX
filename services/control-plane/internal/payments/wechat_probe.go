package payments

import (
	"context"
	"errors"
	"time"

	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments/native"
)

// Explicit merchant diagnostic only. This is not a product, credit grant or a
// route reachable from the desktop/operations API. The amount cannot vary.
func (w *Wechat) CreateOneFenProbe(ctx context.Context, id string, expires time.Time) (string, string, error) {
	if len(id) != 27 || id[:3] != "mxp" || !identifier.MatchString(id) || time.Until(expires) < time.Minute || time.Until(expires) > 21*time.Minute {
		return "", "invalid_probe", ErrValidation
	}
	svc := native.NativeApiService{Client: w.client}
	v, _, e := svc.Prepay(ctx, native.PrepayRequest{Appid: core.String(w.app), Mchid: core.String(w.merchant), OutTradeNo: core.String(id), Description: core.String("MaterialsX 微信支付链路测试 ¥0.01"), NotifyUrl: core.String(w.notifyURL), TimeExpire: &expires, Amount: &native.Amount{Total: core.Int64(1), Currency: core.String("CNY")}})
	if e != nil {
		// Never forward the SDK's Error() text: it contains response headers,
		// detailed bodies and possibly identifiers. Only known diagnostic codes.
		code := "network_or_signature_failure"
		var api *core.APIError
		if errors.As(e, &api) {
			switch api.Code {
			case "PARAM_ERROR", "SIGN_ERROR", "APPID_MCHID_NOT_MATCH", "NO_AUTH", "SYSTEM_ERROR", "FREQUENCY_LIMITED", "OUT_TRADE_NO_USED", "INVALID_REQUEST", "MCH_NOT_EXISTS":
				code = api.Code
			default:
				code = "wechat_api_failure"
			}
		}
		return "", code, ErrDisabled
	}
	if v == nil || v.CodeUrl == nil || len(*v.CodeUrl) > 2048 || len(*v.CodeUrl) < 15 || (*v.CodeUrl)[:15] != "weixin://wxpay/" {
		return "", "invalid_checkout_url", ErrEvidence
	}
	return *v.CodeUrl, "", nil
}

// Signature verification is necessary but not sufficient: match the particular
// diagnostic order, merchant, app, currency and exact one-fen total as well.
func (w *Wechat) MatchProbe(id string, v Evidence) error {
	if v.OrderID != id || v.Merchant != w.merchant || v.AppID != w.app || v.Currency != "CNY" || v.Total != 1 || (v.Source != "query" && v.Source != "notification") {
		return ErrEvidence
	}
	switch v.State {
	case "SUCCESS":
		if v.TransactionID == "" || v.PaidAt.IsZero() {
			return ErrEvidence
		}
	case "NOTPAY", "USERPAYING", "CLOSED", "REVOKED", "PAYERROR":
	default:
		return ErrEvidence
	}
	return nil
}

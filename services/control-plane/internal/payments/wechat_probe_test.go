package payments

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/core/option"
)

func TestOneFenProbeCannotChangeAmountOrIdentity(t *testing.T) {
	key, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	calls := 0
	client, e := core.NewClient(context.Background(), option.WithWechatPayPublicKeyAuthCipher("fixture-merchant", "FIXTURE_SERIAL", key, "PUB_KEY_ID_FIXTURE", &key.PublicKey), option.WithHTTPClient(&http.Client{Transport: roundtrip(func(r *http.Request) (*http.Response, error) {
		calls++
		var body struct {
			Amount struct {
				Total    int64  `json:"total"`
				Currency string `json:"currency"`
			} `json:"amount"`
			Notify string `json:"notify_url"`
			Order  string `json:"out_trade_no"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || body.Amount.Total != 1 || body.Amount.Currency != "CNY" || body.Order != "mxp0123456789abcdef01234567" || body.Notify != "https://fixture.invalid/v1/payments/wechat/notify" {
			t.Fatal("probe contract changed")
		}
		response := `{"code_url":"weixin://wxpay/bizpayurl?pr=fixture"}`
		return &http.Response{StatusCode: 200, Header: signFixture(t, key, response), Body: io.NopCloser(strings.NewReader(response)), Request: r}, nil
	})}))
	if e != nil {
		t.Fatal(e)
	}
	w := &Wechat{client: client, merchant: "fixture-merchant", app: "fixture-app", notifyURL: "https://fixture.invalid/v1/payments/wechat/notify"}
	id := "mxp0123456789abcdef01234567"
	if _, _, e = w.CreateOneFenProbe(context.Background(), id, time.Now().Add(20*time.Minute)); e != nil {
		t.Fatal(e)
	}
	if _, _, e = w.CreateOneFenProbe(context.Background(), id, time.Now().Add(time.Hour)); e == nil {
		t.Fatal("unbounded expiry accepted")
	}
	if _, _, e = w.CreateOneFenProbe(context.Background(), "another-order", time.Now().Add(20*time.Minute)); e == nil {
		t.Fatal("invalid diagnostic ID accepted")
	}
	if calls != 1 {
		t.Fatal("invalid probes caused requests")
	}
	v := Evidence{OrderID: id, Merchant: w.merchant, AppID: w.app, Currency: "CNY", Total: 1, Source: "notification", State: "SUCCESS", TransactionID: "fixture-transaction", PaidAt: time.Now()}
	if e = w.MatchProbe(id, v); e != nil {
		t.Fatal(e)
	}
	for _, change := range []func(*Evidence){func(v *Evidence) { v.Total = 100 }, func(v *Evidence) { v.Merchant = "foreign" }, func(v *Evidence) { v.AppID = "foreign" }, func(v *Evidence) { v.OrderID = "foreign" }, func(v *Evidence) { v.Source = "test" }, func(v *Evidence) { v.TransactionID = "" }, func(v *Evidence) { v.PaidAt = time.Time{} }} {
		altered := v
		change(&altered)
		if w.MatchProbe(id, altered) == nil {
			t.Fatal("wrong evidence accepted")
		}
	}
}

package payments

import (
	"bytes"
	"context"
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/core/auth/verifiers"
	"github.com/wechatpay-apiv3/wechatpay-go/core/notify"
	"github.com/wechatpay-apiv3/wechatpay-go/core/option"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

func signFixture(t *testing.T, key *rsa.PrivateKey, body string) http.Header {
	t.Helper()
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	nonce := "fixture-nonce"
	digest := sha256.Sum256([]byte(ts + "\n" + nonce + "\n" + body + "\n"))
	sig, e := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if e != nil {
		t.Fatal(e)
	}
	return http.Header{"Wechatpay-Timestamp": {ts}, "Wechatpay-Nonce": {nonce}, "Wechatpay-Serial": {"PUB_KEY_ID_FIXTURE"}, "Wechatpay-Signature": {base64.StdEncoding.EncodeToString(sig)}, "Content-Type": {"application/json"}}
}

type roundtrip func(*http.Request) (*http.Response, error)

func (f roundtrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestWechatSignedQueriesAndEncryptedNotifications(t *testing.T) {
	key, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	apiKey := strings.Repeat("x", 32)
	handler, e := notify.NewRSANotifyHandler(apiKey, verifiers.NewSHA256WithRSAPubkeyVerifier("PUB_KEY_ID_FIXTURE", key.PublicKey))
	if e != nil {
		t.Fatal(e)
	}
	ctx := context.Background()
	o := Order{ID: "0123456789abcdef0123456789abcd", AmountFen: "100", Currency: "CNY", Channel: "wechat", Expires: time.Now().Add(time.Minute), Product: Product{Name: "Fixture"}}
	paid := time.Now().UTC().Truncate(time.Second).Format(time.RFC3339)
	transaction := `{"appid":"fixture-app","mchid":"fixture-merchant","out_trade_no":"` + o.ID + `","transaction_id":"fixture-transaction","trade_state":"SUCCESS","success_time":"` + paid + `","amount":{"total":100,"currency":"CNY"}}`
	tamperResponse := false
	calls := 0
	client, e := core.NewClient(ctx, option.WithWechatPayPublicKeyAuthCipher("fixture-merchant", "FIXTURE_SERIAL", key, "PUB_KEY_ID_FIXTURE", &key.PublicKey), option.WithHTTPClient(&http.Client{Transport: roundtrip(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Host != "api.mch.weixin.qq.com" || !strings.HasPrefix(r.Header.Get("Authorization"), "WECHATPAY2-SHA256-RSA2048 ") {
			t.Fatal("unsigned or wrong target")
		}
		body := transaction
		if r.Method == "POST" {
			body = `{"code_url":"weixin://wxpay/bizpayurl?pr=synthetic"}`
		}
		if strings.Contains(r.URL.Path, "/refund/") {
			body = `{"refund_id":"fixture-refund","out_refund_no":"fixture-rid","transaction_id":"fixture-transaction","out_trade_no":"` + o.ID + `","status":"SUCCESS","amount":{"total":100,"refund":50,"currency":"CNY"}}`
		}
		headers := signFixture(t, key, body)
		if tamperResponse {
			headers.Set("Wechatpay-Signature", "tampered")
		}
		return &http.Response{StatusCode: 200, Header: headers, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})}))
	if e != nil {
		t.Fatal(e)
	}
	w := &Wechat{client: client, notify: handler, merchant: "fixture-merchant", app: "fixture-app", notifyURL: "https://fixture.invalid/v1/payments/wechat/notify"}
	if _, e = w.Create(ctx, o); e != nil {
		t.Fatal("signed create", e)
	}
	v, e := w.Query(ctx, o)
	if e != nil || v.State != "SUCCESS" || v.Total != 100 || v.TransactionID != "fixture-transaction" {
		t.Fatal("signed query", v, e)
	}
	rrefund := Refund{ID: "fixture-rid", OrderID: o.ID, AmountFen: "50"}
	refunded, e := w.Refund(ctx, o, rrefund)
	if e != nil || refunded.Refund != 50 || refunded.ProviderRefundID != "fixture-refund" {
		t.Fatal("signed refund", refunded, e)
	}
	refunded, e = w.QueryRefund(ctx, o, rrefund)
	if e != nil || refunded.State != "SUCCESS" {
		t.Fatal("signed refund query", e)
	}
	tamperResponse = true
	if _, e = w.Query(ctx, o); e == nil {
		t.Fatal("bad response signature accepted")
	}
	tamperResponse = false
	if calls != 5 {
		t.Fatal(calls)
	}
	block, _ := aes.NewCipher([]byte(apiKey))
	aead, _ := cipher.NewGCM(block)
	nonce := "123456789012"
	ciphertext := aead.Seal(nil, []byte(nonce), []byte(transaction), []byte("transaction"))
	event := map[string]any{"id": "fixture-event", "create_time": paid, "event_type": "TRANSACTION.SUCCESS", "resource_type": "encrypt-resource", "summary": "fixture", "resource": map[string]any{"algorithm": "AEAD_AES_256_GCM", "nonce": nonce, "associated_data": "transaction", "ciphertext": base64.StdEncoding.EncodeToString(ciphertext)}}
	b, _ := json.Marshal(event)
	r := &http.Request{Header: signFixture(t, key, string(b)), Body: io.NopCloser(bytes.NewReader(b))}
	v, e = w.Notification(ctx, r)
	if e != nil || v.ID != "fixture-event" || v.Source != "notification" {
		t.Fatal("encrypted notification", v, e)
	}
	for _, mutate := range []func(*http.Request){func(r *http.Request) { r.Header.Set("Wechatpay-Signature", "tampered") }, func(r *http.Request) { r.Header.Set("Wechatpay-Serial", "foreign") }, func(r *http.Request) { r.Header.Set("Wechatpay-Timestamp", "1") }, func(r *http.Request) { r.Body = io.NopCloser(strings.NewReader("changed")) }} {
		r = &http.Request{Header: signFixture(t, key, string(b)), Body: io.NopCloser(bytes.NewReader(b))}
		mutate(r)
		if _, e = w.Notification(ctx, r); e == nil {
			t.Fatal("unverified callback accepted")
		}
	}
}
func TestMonthAnchorAndRefundRounding(t *testing.T) {
	jan := time.Date(2028, 1, 31, 12, 0, 0, 0, time.UTC)
	feb := nextMonth(jan, 31)
	mar := nextMonth(feb, 31)
	if feb.Day() != 29 || mar.Day() != 31 {
		t.Fatal("calendar drift", feb, mar)
	}
	if recoverCredits(10, 0, 33, 100) != 4 || recoverCredits(10, 33, 33, 100) != 7 || recoverCredits(10, 66, 34, 100) != 10 {
		t.Fatal("partial refund rounding")
	}
}
func TestPaymentConfigurationFailsClosed(t *testing.T) {
	for _, scenario := range []struct{ mode, env, db string }{{"test", "production", "test"}, {"test", "development", "production"}, {"wechat-native", "development", "test"}, {"unknown", "development", "test"}} {
		t.Setenv("MATERIALSX_PAYMENT_MODE", scenario.mode)
		if FromEnv(context.Background(), &Store{}, scenario.env, scenario.db, "http://127.0.0.1") == nil {
			t.Fatal("unsafe config accepted")
		}
	}
	t.Setenv("MATERIALSX_PAYMENT_MODE", "")
	if e := FromEnv(context.Background(), &Store{}, "production", "production", "https://fixture.invalid"); e != nil {
		t.Fatal(e)
	}
}

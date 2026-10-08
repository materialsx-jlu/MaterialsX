package payments

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"github.com/wechatpay-apiv3/wechatpay-go/core"
	wxpayments "github.com/wechatpay-apiv3/wechatpay-go/services/payments"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestWechatAmountlessClosedQuery(t *testing.T) {
	w := &Wechat{}
	v := &wxpayments.Transaction{OutTradeNo: core.String("mxfixture"), Mchid: core.String("merchant"), Appid: core.String("app"), TradeState: core.String("CLOSED")}
	evidence, err := w.transaction(v, "query", "")
	if err != nil || !evidence.AmountlessClose() || evidence.OrderID != "mxfixture" || evidence.ID == "" {
		t.Fatalf("amountless closed query rejected: %+v %v", evidence, err)
	}
	v.TradeState = core.String("SUCCESS")
	if _, err = w.transaction(v, "query", ""); err != ErrEvidence {
		t.Fatalf("amountless successful payment accepted: %v", err)
	}
	v.TradeState = core.String("CLOSED")
	if _, err = w.transaction(v, "notification", "event"); err != ErrEvidence {
		t.Fatalf("amountless notification accepted: %v", err)
	}
}

func wechatConfigFixture(t *testing.T) (string, map[string]string) {
	t.Helper()
	dir := t.TempDir()
	k, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	privateDER, e := x509.MarshalPKCS8PrivateKey(k)
	if e != nil {
		t.Fatal(e)
	}
	b, e := x509.MarshalPKIXPublicKey(&k.PublicKey)
	if e != nil {
		t.Fatal(e)
	}
	for name, data := range map[string][]byte{"private.pem": pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privateDER}), "public.pem": pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: b})} {
		if e = os.WriteFile(filepath.Join(dir, name), data, 0600); e != nil {
			t.Fatal(e)
		}
	}
	path := filepath.Join(dir, "config.yaml")
	doc := `payment:
  providers: [weixin]
  public_base_url: https://legal.example.com
  weixin:
    base_url: https://api.mch.weixin.qq.com
    mchid: fixture-merchant
    appid: fixture-app
    serial_no: FIXTURE_SERIAL
    apiv3_key: zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz
    private_key_pem_path: private.pem
    wechat_pay_public_key_path: public.pem
    notify_path: /api/webhooks/weixin
  order_sync:
    endpoint_url: https://legal.example.com/private-callback
    auth_token: secret-do-not-inherit
database:
  dsn: postgres://secret-do-not-inherit
security:
  business_auth: {enabled: false}
  sanitize_api_errors: false
`
	if e = os.WriteFile(path, []byte(doc), 0600); e != nil {
		t.Fatal(e)
	}
	return path, map[string]string{"MATERIALSX_WECHAT_CONFIG_PATH": path, "WECHAT_PAY_PUBLIC_KEY_ID": "PUB_KEY_ID_FIXTURE"}
}

func TestWechatRuntimeConfigIsolation(t *testing.T) {
	path, env := wechatConfigFixture(t)
	get := func(k string) string { return env[k] }
	before, _ := os.ReadFile(path)
	c, e := loadWechatConfig(get)
	if e != nil || c.privatePath != filepath.Join(filepath.Dir(path), "private.pem") || !c.identifiersValid() {
		t.Fatal("runtime config not resolved", e)
	}
	r := WechatPreflight(get, "https://materialsx.example.com")
	if !r.OfflineConfigReady || !r.MerchantConfigReady || r.FormalSalesEnabled || r.RealPaymentVerified || len(r.Warnings) != 4 {
		t.Fatal("unexpected readiness", r)
	}
	b, _ := json.Marshal(r)
	for _, secret := range []string{c.apiKey, c.merchant, c.app, c.serial, c.keyID, path, "secret-do-not-inherit"} {
		if strings.Contains(string(b), secret) {
			t.Fatal("preflight disclosed credential or source location")
		}
	}
	for _, k := range []string{"WECHAT_PAY_MCH_ID", "WECHAT_PAY_APP_ID", "WECHAT_PAY_CERT_SERIAL", "WECHAT_PAY_API_V3_KEY", "WECHAT_PAY_PRIVATE_KEY_PATH", "WECHAT_PAY_PUBLIC_KEY_PATH", "MATERIALSX_WECHAT_RUNTIME_DIR"} {
		t.Setenv(k, "")
	}
	for k, v := range env {
		t.Setenv(k, v)
	}
	w, e := NewWechat(context.Background(), "https://materialsx.example.com")
	if e != nil || w.notifyURL != "https://materialsx.example.com/v1/payments/wechat/notify" || w.merchant != "fixture-merchant" {
		t.Fatal("SDK runtime wiring failed", e)
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("source YAML was changed")
	}
	delete(env, "WECHAT_PAY_PUBLIC_KEY_ID")
	r = WechatPreflight(get, "https://materialsx.example.com")
	if r.OfflineConfigReady {
		t.Fatal("missing key ID accepted")
	}
	env["WECHAT_PAY_PUBLIC_KEY_ID"] = "PUB_KEY_ID_FIXTURE"
	env["WECHAT_PAY_MCH_ID"] = "another-merchant"
	if _, e = loadWechatConfig(get); e == nil {
		t.Fatal("two merchant sources silently mixed")
	}
}

func TestWechatPreflightFailsClosedAndRedacts(t *testing.T) {
	path, env := wechatConfigFixture(t)
	get := func(k string) string { return env[k] }
	for _, origin := range []string{"", "https://", "http://127.0.0.1", "https://localhost", "https://example.com", "https://fixture.invalid", "https://user:secret@pay.example.com", "https://pay.example.com/", "https://pay.example.com?", "https://pay.example.com?q=secret", "https://pay.example.com#secret"} {
		if WechatPreflight(get, origin).OfflineConfigReady {
			t.Fatal("unsafe origin accepted")
		}
	}
	if runtime.GOOS != "windows" {
		private := filepath.Join(filepath.Dir(path), "private.pem")
		if e := os.Chmod(private, 0644); e != nil {
			t.Fatal(e)
		}
		if WechatPreflight(get, "https://materialsx.example.com").OfflineConfigReady {
			t.Fatal("public-readable private key accepted")
		}
		if e := os.Chmod(private, 0600); e != nil {
			t.Fatal(e)
		}
	}
	for _, raw := range []string{"payment: [parser-secret: {", strings.Repeat("parser-secret", 7000), "payment: {providers: [weixin], weixin: {base_url: 'https://attacker.example.com'}}"} {
		if e := os.WriteFile(path, []byte(raw), 0600); e != nil {
			t.Fatal(e)
		}
		_, e := loadWechatConfig(get)
		if e != ErrValidation {
			t.Fatal("unsafe source accepted or error disclosed raw content")
		}
		b, _ := json.Marshal(WechatPreflight(get, "https://materialsx.example.com"))
		if strings.Contains(string(b), "parser-secret") {
			t.Fatal("parse error leaked YAML")
		}
	}
}

func TestWechatPEMEnvironmentAndPublicKeyIDConflict(t *testing.T) {
	path, env := wechatConfigFixture(t)
	get := func(k string) string { return env[k] }
	raw, _ := os.ReadFile(path)
	raw = []byte(strings.Replace(string(raw), "serial_no: FIXTURE_SERIAL", "wechat_pay_public_key_id: PUB_KEY_ID_YAML\n    private_key_pem_env: FIXTURE_PRIVATE_PEM\n    wechat_pay_public_key_pem_env: FIXTURE_PUBLIC_PEM\n    serial_no: FIXTURE_SERIAL", 1))
	if e := os.WriteFile(path, raw, 0600); e != nil {
		t.Fatal(e)
	}
	if _, e := loadWechatConfig(get); e == nil {
		t.Fatal("conflicting key IDs accepted")
	}
	delete(env, "WECHAT_PAY_PUBLIC_KEY_ID")
	private := filepath.Join(filepath.Dir(path), "private.pem")
	public := filepath.Join(filepath.Dir(path), "public.pem")
	a, _ := os.ReadFile(private)
	b, _ := os.ReadFile(public)
	env["FIXTURE_PRIVATE_PEM"] = string(a)
	env["FIXTURE_PUBLIC_PEM"] = string(b)
	if e := os.Remove(private); e != nil {
		t.Fatal(e)
	}
	if e := os.Remove(public); e != nil {
		t.Fatal(e)
	}
	if !WechatPreflight(get, "https://materialsx.example.com").OfflineConfigReady {
		t.Fatal("PEM environment not supported")
	}
	env["FIXTURE_PRIVATE_PEM"] = "bad-key"
	if WechatPreflight(get, "https://materialsx.example.com").OfflineConfigReady {
		t.Fatal("malformed PEM accepted")
	}
	for _, v := range []string{"${WECHAT_PAY_ID}", "<PUB_KEY_ID_PLACEHOLDER>", "PUB_KEY_ID_", "PUB_KEY_ID_REPLACE"} {
		if (wechatConfig{merchant: "merchant", app: "app", serial: "serial", keyID: v, apiKey: strings.Repeat("z", 32)}).identifiersValid() {
			t.Fatal("placeholder accepted")
		}
	}
}

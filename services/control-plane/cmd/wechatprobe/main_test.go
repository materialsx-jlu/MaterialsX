package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/jamip/materialsx/control-plane/internal/payments"
)

func TestProbeJournalConcurrentNotificationsAndLateQuery(t *testing.T) {
	dir := t.TempDir()
	key, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	private, e := x509.MarshalPKCS8PrivateKey(key)
	if e != nil {
		t.Fatal(e)
	}
	public, e := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if e != nil {
		t.Fatal(e)
	}
	for name, data := range map[string][]byte{"private.pem": pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: private}), "public.pem": pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: public})} {
		if e = os.WriteFile(filepath.Join(dir, name), data, 0600); e != nil {
			t.Fatal(e)
		}
	}
	for k, v := range map[string]string{"MATERIALSX_WECHAT_CONFIG_PATH": "", "WECHAT_PAY_MCH_ID": "fixture-merchant", "WECHAT_PAY_APP_ID": "fixture-app", "WECHAT_PAY_CERT_SERIAL": "FIXTURE_SERIAL", "WECHAT_PAY_PUBLIC_KEY_ID": "PUB_KEY_ID_FIXTURE", "WECHAT_PAY_API_V3_KEY": "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", "WECHAT_PAY_PRIVATE_KEY_PATH": filepath.Join(dir, "private.pem"), "WECHAT_PAY_PUBLIC_KEY_PATH": filepath.Join(dir, "public.pem")} {
		t.Setenv(k, v)
	}
	w, e := payments.NewWechat(context.Background(), "https://fixture.invalid")
	if e != nil {
		t.Fatal(e)
	}
	p := &probe{provider: w, path: filepath.Join(dir, "order.json"), state: journal{OrderID: "mxp0123456789abcdef01234567", AmountFen: "1", Currency: "CNY", State: "NOTPAY"}}
	v := payments.Evidence{OrderID: p.state.OrderID, Merchant: "fixture-merchant", AppID: "fixture-app", Currency: "CNY", Total: 1, State: "SUCCESS", TransactionID: "fixture-transaction", PaidAt: time.Now().UTC(), Source: "notification"}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := p.apply(v); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	query := v
	query.Source = "query"
	if e = p.apply(query); e != nil {
		t.Fatal(e)
	}
	late := query
	late.State = "NOTPAY"
	late.TransactionID = ""
	late.PaidAt = time.Time{}
	if e = p.apply(late); e != nil {
		t.Fatal(e)
	}
	foreign := v
	foreign.TransactionID = "foreign"
	if e = p.apply(foreign); e == nil {
		t.Fatal("second transaction accepted")
	}
	b, e := os.ReadFile(p.path)
	if e != nil {
		t.Fatal(e)
	}
	var saved journal
	if json.Unmarshal(b, &saved) != nil || saved.State != "SUCCESS" || !saved.NotificationVerified || !saved.QueryVerified || saved.TransactionID != v.TransactionID || saved.FormalSalesEnabled {
		t.Fatal("payment erased or formal sales enabled")
	}
	for _, secret := range []string{"fixture-merchant", "fixture-app", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"} {
		if bytes.Contains(b, []byte(secret)) {
			t.Fatal("private journal leaked credential")
		}
	}
}

package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestOperationsMFAOriginCookieAndCSRF(t *testing.T) {
	t.Run("required", func(t *testing.T) { testOperationsLogin(t, false) })
	t.Run("local-password-only", func(t *testing.T) { testOperationsLogin(t, true) })
}
func testOperationsLogin(t *testing.T, disableTOTP bool) {
	s, p, _ := metered(t)
	ident, _ := identity.New(s.Pool, make([]byte, 32))
	ident.DisableAdminTOTP = disableTOTP
	ctx := context.Background()
	secret := "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
	admin, e := ident.CreateAccount(ctx, "ops-fixture@example.invalid", "Ops fixture", "fixture-password-only", "admin", secret)
	if e != nil {
		t.Fatal(e)
	}
	_ = admin
	otp, _ := identity.TOTP(secret, time.Now().Unix()/30)
	if disableTOTP {
		otp = ""
	}
	h := identity.NewHTTP(ident, "http://ops.test", false)
	Mount(h, s)
	call := func(method, path, body, origin, csrf string, cookies []*http.Cookie) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://ops.test"+path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		r.Header.Set("X-CSRF-Token", csrf)
		for _, c := range cookies {
			r.AddCookie(c)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if r := call("GET", "/ops/api/auth-config", "", "", "", nil); !strings.Contains(r.Body.String(), fmt.Sprintf(`"totpRequired":%t`, !disableTOTP)) {
		t.Fatal("incorrect auth policy")
	}
	bad, _ := json.Marshal(map[string]string{"email": admin.Email, "password": "wrong-password", "otp": otp})
	if r := call("POST", "/ops/api/login", string(bad), "http://ops.test", "", nil); r.Code != 401 {
		t.Fatal("wrong password admitted")
	}
	userBody, _ := json.Marshal(map[string]string{"email": p.Email, "password": "fixture-password-only"})
	if r := call("POST", "/ops/api/login", string(userBody), "http://ops.test", "", nil); r.Code != 403 {
		t.Fatal("ordinary user admitted to operations")
	}
	body, _ := json.Marshal(map[string]string{"email": admin.Email, "password": "fixture-password-only", "otp": otp})
	if r := call("POST", "/ops/api/login", string(body), "http://foreign.test", "", nil); r.Code != 403 {
		t.Fatal("cross-site login admitted")
	}
	r := call("POST", "/ops/api/login", string(body), "http://ops.test", "", nil)
	if r.Code != 200 {
		t.Fatal("MFA login failed", r.Code)
	}
	cookies := r.Result().Cookies()
	if len(cookies) != 2 {
		t.Fatal("cookies missing")
	}
	for _, c := range cookies {
		if !c.HttpOnly || c.SameSite != http.SameSiteStrictMode {
			t.Fatal("insecure ops cookie")
		}
	}
	if disableTOTP {
		var token string
		for _, c := range cookies {
			if c.Name == "mx_ops" {
				token = c.Value
			}
		}
		principal, e := ident.Authenticate(ctx, token)
		if e != nil || principal.MFA {
			t.Fatal("password-only session falsely marked as MFA", e)
		}
		target, e := ident.CreateAccount(ctx, "ops-target@example.invalid", "Target", "fixture-password-only", "user", "")
		if e != nil {
			t.Fatal(e)
		}
		if _, e = ident.SetStatus(ctx, principal, target.ID, "suspended", "fixture status check", "local-status-key", target.Version); e != nil {
			t.Fatal("password-only admin mutation blocked", e)
		}
	}
	var login struct {
		CSRF string `json:"csrf"`
	}
	json.Unmarshal(r.Body.Bytes(), &login)
	if r := call("GET", "/ops/api/pending", "", "", "", cookies); r.Code != 200 {
		t.Fatal("admin queue blocked", r.Code)
	}
	if r := call("POST", "/ops/api/reconcile", "{}", "http://foreign.test", login.CSRF, cookies); r.Code != 403 {
		t.Fatal("cross-site mutation admitted")
	}
	if r := call("POST", "/ops/api/reconcile", "{}", "http://ops.test", "wrong", cookies); r.Code != 403 {
		t.Fatal("CSRF ignored")
	}
	if r := call("GET", "/v1/admin/billing/pending", "", "", "", nil); r.Code != 401 {
		t.Fatal("anonymous admin admitted")
	}
	verifier := newID()
	flow, _ := ident.Start(ctx, identity.StartInput{DeviceName: "ops-user", Challenge: identity.Challenge(verifier), Method: "S256", Redirect: "http://127.0.0.1:40123/auth/callback"})
	_, nonce, _ := ident.BrowserFlow(ctx, flow.ID)
	_, code, _ := ident.Approve(ctx, flow.ID, nonce, p.Email, "fixture-password-only", "")
	tokens, _ := ident.Exchange(ctx, flow.ID, code, verifier)
	req := httptest.NewRequest("GET", "http://ops.test/v1/admin/billing/pending", nil)
	req.Header.Set("Authorization", "Bearer "+tokens.AccessToken)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Fatal("user accessed billing operations")
	}
	if r := call("GET", "/ops/api/verify", "", "", "", cookies); r.Code != 200 {
		t.Fatal("ledger verification failed")
	}
	if r := call("POST", "/ops/api/logout", "{}", "http://ops.test", login.CSRF, cookies); r.Code != 200 {
		t.Fatal("logout failed")
	}
	if r := call("GET", "/ops/api/pending", "", "", "", cookies); r.Code != 401 {
		t.Fatal("revoked ops session usable")
	}
}

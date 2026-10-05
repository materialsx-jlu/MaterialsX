package identity

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestPostgresHTTPBrowserAuthorizationAndBoundaries(t *testing.T) {
	s := testService(t)
	u := account(t, s, "http@example.invalid", false)
	b := account(t, s, "foreign@example.invalid", false)
	var handler http.Handler
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { handler.ServeHTTP(w, r) }))
	defer server.Close()
	handler = NewHTTP(s, server.URL, false)
	client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	call := func(method, path, body, token string) *http.Response {
		t.Helper()
		req, _ := http.NewRequest(method, server.URL+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		res, e := client.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		t.Cleanup(func() { res.Body.Close() })
		return res
	}
	expect := func(res *http.Response, status int) {
		t.Helper()
		if res.StatusCode != status {
			data, _ := io.ReadAll(res.Body)
			t.Fatalf("status %d, expected %d; %s", res.StatusCode, status, data)
		}
	}
	verifier := randomID()
	input := StartInput{"<script>alert(1)</script>", Challenge(verifier), "S256", "http://127.0.0.1:40123/auth/callback"}
	raw, _ := json.Marshal(input)
	// Forged account/role cannot enter the public auth contract.
	expect(call("POST", "/v1/auth/desktop/start", strings.TrimSuffix(string(raw), "}")+`,"accountId":"foreign"}`, ""), 400)
	res := call("POST", "/v1/auth/desktop/start", string(raw), "")
	expect(res, 200)
	var flow struct {
		FlowID string `json:"flowId"`
		State  string `json:"state"`
	}
	json.NewDecoder(res.Body).Decode(&flow)
	path := "/auth/desktop/" + flow.FlowID
	res = call("GET", path, "", "")
	expect(res, 200)
	html, _ := io.ReadAll(res.Body)
	if strings.Contains(string(html), "<script>alert") || !strings.Contains(string(html), "&lt;script&gt;") {
		t.Fatal("device name not escaped")
	}
	if res.Header.Get("Cache-Control") != "no-store" || res.Header.Get("Content-Security-Policy") == "" {
		t.Fatal("browser headers missing")
	}
	if res.Header.Get("Referrer-Policy") != "same-origin" {
		t.Fatal("native login form must preserve its same-origin Origin header")
	}
	if res.Header.Get("Content-Security-Policy") != "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' "+input.Redirect+"; frame-ancestors 'none'; base-uri 'none'" {
		t.Fatal("login form must allow only self and its exact validated callback")
	}
	cookies := res.Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatal("login cookie flags")
	}
	match := regexp.MustCompile(`name="csrf" value="([^"]+)"`).FindStringSubmatch(string(html))
	if len(match) != 2 {
		t.Fatal("CSRF missing")
	}
	form := url.Values{"csrf": {match[1]}, "email": {u.Email}, "password": {fixturePassword}, "approve": {"yes"}}
	approve := func(origin, csrf string) *http.Response {
		t.Helper()
		form.Set("csrf", csrf)
		req, _ := http.NewRequest("POST", server.URL+path, strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.Header.Set("Origin", origin)
		req.AddCookie(cookies[0])
		res, e := client.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		t.Cleanup(func() { res.Body.Close() })
		return res
	}
	expect(approve("https://foreign.invalid", match[1]), 403)
	expect(approve("null", match[1]), 403)
	expect(approve("", match[1]), 403)
	expect(approve(server.URL, "wrong"), 403)
	res = approve(server.URL, match[1])
	expect(res, 303)
	if res.Header.Get("Referrer-Policy") != "no-referrer" {
		t.Fatal("authorization redirect must not disclose its flow URL")
	}
	callback, _ := url.Parse(res.Header.Get("Location"))
	if callback.Query().Get("state") != flow.State {
		t.Fatal("state not preserved")
	}
	exchange := map[string]string{"flowId": flow.FlowID, "authorizationCode": callback.Query().Get("code"), "codeVerifier": verifier}
	raw, _ = json.Marshal(exchange)
	res = call("POST", "/v1/auth/desktop/exchange", string(raw), "")
	expect(res, 200)
	var tok Tokens
	json.NewDecoder(res.Body).Decode(&tok)
	expect(call("POST", "/v1/auth/desktop/exchange", string(raw), ""), 401)
	res = call("GET", "/v1/me?accountId="+b.ID, "", tok.AccessToken)
	expect(res, 200)
	var p Principal
	json.NewDecoder(res.Body).Decode(&p)
	if p.ID != u.ID {
		t.Fatal("forged owner accepted")
	}
	expect(call("GET", "/v1/admin/users", "", tok.AccessToken), 403)
	foreign, _ := login(t, s, b)
	expect(call("POST", "/v1/devices/"+foreign.DeviceID+"/revoke", "{}", tok.AccessToken), 404)
	// M3's unauthenticated developer billing shortcuts are absent from M5.1.
	expect(call("POST", "/v1/dev/subscription", "{}", tok.AccessToken), 404)
	expect(call("GET", "/v1/accounts/"+b.ID, "", tok.AccessToken), 404)
	// Multiple devices are traversable without exposing another account's devices.
	_, _ = login(t, s, u)
	res = call("GET", "/v1/devices?limit=1", "", tok.AccessToken)
	expect(res, 200)
	var page struct {
		Items []Device `json:"items"`
		Next  *string  `json:"nextCursor"`
	}
	json.NewDecoder(res.Body).Decode(&page)
	if len(page.Items) != 1 || page.Next == nil {
		t.Fatal("pagination omitted")
	}
	res = call("GET", "/v1/devices?limit=1&cursor="+url.QueryEscape(*page.Next), "", tok.AccessToken)
	expect(res, 200)
	var next struct {
		Items []Device `json:"items"`
	}
	json.NewDecoder(res.Body).Decode(&next)
	if len(next.Items) != 1 || next.Items[0].ID == page.Items[0].ID {
		t.Fatal("pagination repeats")
	}
	req, _ := http.NewRequest("GET", server.URL+"/health", nil)
	req.Host = "attacker.invalid"
	res, e := client.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	expect(res, 400)
	res.Body.Close()
	expect(call("POST", "/v1/auth/logout", "{}", tok.AccessToken), 200)
	expect(call("GET", "/v1/me", "", tok.AccessToken), 401)
	for i := 0; i < 20; i++ {
		s.Limit(context.Background(), "auth-start:127.0.0.1", 20)
	}
	res = call("POST", "/v1/auth/desktop/start", string(raw), "")
	expect(res, 429)
	if res.Header.Get("Retry-After") == "" {
		t.Fatal("rate limit lacks retry header")
	}
}

func TestTrustedProxyCannotBeSpoofed(t *testing.T) {
	_, loopback, _ := net.ParseCIDR("127.0.0.1/32")
	trusted := []*net.IPNet{loopback}
	if clientIP("203.0.113.9", "198.51.100.9", trusted) != "203.0.113.9" {
		t.Fatal("untrusted socket spoofed IP")
	}
	if clientIP("127.0.0.1", "attacker,198.51.100.9", trusted) != "198.51.100.9" {
		t.Fatal("accepted attacker prefix")
	}
	if clientIP("127.0.0.1", "garbage", trusted) != "127.0.0.1" {
		t.Fatal("malformed IP accepted")
	}
}

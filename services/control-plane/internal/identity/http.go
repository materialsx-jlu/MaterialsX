package identity

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"html/template"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type HTTP struct {
	EmailEnabled      bool
	SignupEnabled     bool
	S                 *Service
	PublicURL         string
	BillingPublicURL  string
	BillingProxyToken string
	Production        bool
	mux               *http.ServeMux
	TrustedProxies    []*net.IPNet
}

func NewHTTP(s *Service, publicURL string, production bool, trusted ...*net.IPNet) *HTTP {
	h := &HTTP{S: s, PublicURL: publicURL, Production: production, mux: http.NewServeMux(), TrustedProxies: trusted}
	h.mux.HandleFunc("GET /health", h.health)
	h.mux.HandleFunc("POST /v1/auth/desktop/start", h.start)
	h.mux.HandleFunc("GET /auth/desktop/{id}", h.loginPage)
	h.mux.HandleFunc("POST /auth/desktop/{id}", h.approve)
	h.mux.HandleFunc("POST /v1/auth/desktop/exchange", h.exchange)
	h.mux.HandleFunc("POST /v1/auth/refresh", h.refresh)
	h.mux.HandleFunc("GET /v1/me", h.me)
	h.mux.HandleFunc("GET /v1/devices", h.devices)
	h.mux.HandleFunc("POST /v1/devices/{id}/revoke", h.revoke)
	h.mux.HandleFunc("POST /v1/auth/logout", h.logout)
	h.mux.HandleFunc("GET /v1/admin/users", h.users)
	h.mux.HandleFunc("POST /v1/admin/users/{id}/status", h.status)
	h.mux.HandleFunc("GET /v1/admin/audit-events", h.audit)
	return h
}
func (h *HTTP) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if h.Production {
		w.Header().Set("Strict-Transport-Security", "max-age=31536000")
	}
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
	// The billing console is a distinct host and requires the private web
	// service credential before its routes can be reached.
	publicURL := h.PublicURL
	if strings.HasPrefix(r.URL.Path, "/v1/admin/billing-console/") && h.BillingPublicURL != "" {
		publicURL = h.BillingPublicURL
		if len(h.BillingProxyToken) < 32 || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-MX-Billing-Proxy-Key")), []byte(h.BillingProxyToken)) != 1 {
			h.fail(w, ErrForbidden)
			return
		}
	}
	// Public URLs are configured, never inferred from forwarded headers.
	u, _ := url.Parse(publicURL)
	if r.Host != u.Host {
		h.fail(w, ErrValidation)
		return
	}
	h.mux.ServeHTTP(w, r)
}
func (h *HTTP) health(w http.ResponseWriter, r *http.Request) {
	if h.S.Pool.Ping(r.Context()) != nil {
		h.fail(w, errors.New("database_unavailable"))
		return
	}
	h.json(w, 200, map[string]any{"status": "ok", "service": "materialsx-identity", "production": h.Production})
}
func (h *HTTP) json(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func (h *HTTP) fail(w http.ResponseWriter, e error) {
	code, status := "UPSTREAM_ERROR", 503
	for _, p := range []struct {
		e error
		s int
	}{{ErrValidation, 400}, {ErrUnauthenticated, 401}, {ErrForbidden, 403}, {ErrNotFound, 404}, {ErrConflict, 409}, {ErrIdempotency, 409}, {ErrRateLimited, 429}} {
		if errors.Is(e, p.e) {
			code = e.Error()
			status = p.s
			break
		}
	}
	if status == 429 {
		w.Header().Set("Retry-After", "60")
	}
	h.json(w, status, map[string]any{"error": map[string]any{"code": code, "message": code, "requestId": randomID(), "retryable": status == 429 || status == 503}})
}
func (h *HTTP) decode(w http.ResponseWriter, r *http.Request, target any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		h.fail(w, ErrValidation)
		return false
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024))
	d.DisallowUnknownFields()
	if e := d.Decode(target); e != nil {
		h.fail(w, ErrValidation)
		return false
	}
	if d.Decode(new(any)) != io.EOF {
		h.fail(w, ErrValidation)
		return false
	}
	return true
}
func (h *HTTP) limit(w http.ResponseWriter, r *http.Request, surface string, max int) bool {
	host, _, e := net.SplitHostPort(r.RemoteAddr)
	if e != nil {
		host = r.RemoteAddr
	}
	host = clientIP(host, r.Header.Get("X-Forwarded-For"), h.TrustedProxies)
	if e = h.S.Limit(r.Context(), surface+":"+host, max); e != nil {
		h.fail(w, e)
		return false
	}
	return true
}

// Only an explicitly trusted socket peer can supply a forwarded chain.
func clientIP(peer, forwarded string, trusted []*net.IPNet) string {
	isTrusted := func(raw string) bool {
		ip := net.ParseIP(strings.TrimSpace(raw))
		for _, prefix := range trusted {
			if prefix.Contains(ip) {
				return true
			}
		}
		return false
	}
	if !isTrusted(peer) || len(forwarded) > 1024 || forwarded == "" {
		return peer
	}
	chain := strings.Split(forwarded, ",")
	if len(chain) > 10 {
		return peer
	}
	current := peer
	for i := len(chain) - 1; i >= 0; i-- {
		if !isTrusted(current) {
			break
		}
		ip := net.ParseIP(strings.TrimSpace(chain[i]))
		if ip == nil {
			return peer
		}
		current = ip.String()
	}
	return current
}
func (h *HTTP) principal(w http.ResponseWriter, r *http.Request, admin bool) (Principal, bool) {
	var p Principal
	if !h.limit(w, r, "api", 300) {
		return p, false
	}
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		h.fail(w, ErrUnauthenticated)
		return p, false
	}
	p, e := h.S.Authenticate(r.Context(), strings.TrimPrefix(header, "Bearer "))
	if e != nil {
		h.fail(w, e)
		return p, false
	}
	if admin && !h.S.AdminAllowed(p) {
		h.fail(w, ErrForbidden)
		return p, false
	}
	return p, true
}
func (h *HTTP) start(w http.ResponseWriter, r *http.Request) {
	if !h.limit(w, r, "auth-start", 20) {
		return
	}
	var in StartInput
	if !h.decode(w, r, &in) {
		return
	}
	f, e := h.S.Start(r.Context(), in)
	if e != nil {
		h.fail(w, e)
		return
	}
	h.json(w, 200, map[string]any{"flowId": f.ID, "state": f.State, "authorizationUrl": h.PublicURL + "/auth/desktop/" + f.ID, "expiresAt": f.ExpiresAt})
}

var loginTemplate = template.Must(template.New("login").Parse(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MaterialsX · 账户授权</title><style>body{font:16px system-ui;background:#f6f6f4;color:#222;margin:0}main{max-width:440px;margin:8vh auto;background:white;padding:32px;border:1px solid #ddd;border-radius:14px}label{display:block;margin:18px 0}input{box-sizing:border-box;width:100%;padding:12px;margin-top:8px;border:1px solid #ccc;border-radius:8px}input[type=checkbox]{width:auto}button{background:#252525;color:#fff;border:0;border-radius:8px;padding:12px;width:100%}small,p{color:#666;line-height:1.6}</style><main><h1>MaterialsX</h1><p>登录并授权设备：<strong>{{.DeviceName}}</strong></p><form method="post"><input type="hidden" name="csrf" value="{{.Nonce}}"><label>邮箱 / Email<input type="email" name="email" autocomplete="username" required maxlength="254"></label><label>密码 / Password<input type="password" name="password" autocomplete="current-password" required minlength="12" maxlength="128"></label>{{if .TOTPRequired}}<label>管理员验证码 / Admin MFA<input name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="普通账户留空"></label>{{end}}<label><input type="checkbox" name="approve" value="yes" required> 我正在 MaterialsX 发起登录，同意授权此设备</label><button>登录并返回 MaterialsX</button></form>{{if .EmailEnabled}}<p><a href="/auth/selfserve?kind=reset" target="_blank" rel="noreferrer">找回密码</a>{{if .SignupEnabled}} · <a href="/auth/selfserve?kind=register" target="_blank" rel="noreferrer">注册账户</a>{{end}}</p>{{end}}<p>请确认这是你刚刚发起的登录。此操作不会授予付费权益。</p><small>© 2026 吉林大学 AI-DAOS 团队</small></main></html>`))

func (h *HTTP) loginPage(w http.ResponseWriter, r *http.Request) {
	if !h.limit(w, r, "login-page", 30) {
		return
	}
	f, nonce, e := h.S.BrowserFlow(r.Context(), r.PathValue("id"))
	if e != nil {
		h.fail(w, e)
		return
	}
	// Restrict the browser's permitted redirect to this flow's validated callback;
	// Chrome also applies form-action to the redirect after a native form POST.
	if !callbackRE.MatchString(f.Redirect) {
		h.fail(w, ErrValidation)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "mx_flow", Value: nonce, Path: "/auth/desktop/" + f.ID, HttpOnly: true, Secure: h.Production, SameSite: http.SameSiteStrictMode, MaxAge: 300})
	// Native form POSTs under no-referrer can carry Origin: null. Preserve the
	// same-origin form's Origin without sending its flow URL to other origins.
	// Redirects/API responses keep ServeHTTP's no-referrer policy.
	w.Header().Set("Referrer-Policy", "same-origin")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' "+f.Redirect+"; frame-ancestors 'none'; base-uri 'none'")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = loginTemplate.Execute(w, map[string]any{"TOTPRequired": !h.S.DisableAdminTOTP, "DeviceName": f.DeviceName, "Nonce": nonce, "EmailEnabled": h.EmailEnabled, "SignupEnabled": h.SignupEnabled})
}
func (h *HTTP) approve(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Origin") != h.PublicURL || !h.limit(w, r, "login", 30) {
		if r.Header.Get("Origin") != h.PublicURL {
			h.fail(w, ErrForbidden)
		}
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	if r.ParseForm() != nil {
		h.fail(w, ErrValidation)
		return
	}
	cookie, e := r.Cookie("mx_flow")
	csrf := r.PostForm.Get("csrf")
	if e != nil || csrf == "" || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(csrf)) != 1 || r.PostForm.Get("approve") != "yes" {
		h.fail(w, ErrForbidden)
		return
	}
	if e = h.S.Limit(r.Context(), "login-email:"+strings.ToLower(strings.TrimSpace(r.PostForm.Get("email"))), 8); e != nil {
		h.fail(w, e)
		return
	}
	f, code, e := h.S.Approve(r.Context(), r.PathValue("id"), csrf, r.PostForm.Get("email"), r.PostForm.Get("password"), r.PostForm.Get("otp"))
	if e != nil {
		h.fail(w, e)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "mx_flow", Value: "", Path: "/auth/desktop/" + f.ID, HttpOnly: true, Secure: h.Production, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	u, _ := url.Parse(f.Redirect)
	q := u.Query()
	q.Set("flowId", f.ID)
	q.Set("code", code)
	q.Set("state", f.State)
	u.RawQuery = q.Encode()
	http.Redirect(w, r, u.String(), http.StatusSeeOther)
}
func (h *HTTP) exchange(w http.ResponseWriter, r *http.Request) {
	if !h.limit(w, r, "exchange", 30) {
		return
	}
	var in struct {
		FlowID   string `json:"flowId"`
		Code     string `json:"authorizationCode"`
		Verifier string `json:"codeVerifier"`
	}
	if !h.decode(w, r, &in) {
		return
	}
	t, e := h.S.Exchange(r.Context(), in.FlowID, in.Code, in.Verifier)
	if e != nil {
		h.fail(w, e)
		return
	}
	h.json(w, 200, t)
}
func (h *HTTP) refresh(w http.ResponseWriter, r *http.Request) {
	if !h.limit(w, r, "refresh", 60) {
		return
	}
	var in struct {
		Token string `json:"refreshToken"`
	}
	if !h.decode(w, r, &in) {
		return
	}
	t, e := h.S.Refresh(r.Context(), in.Token)
	if e != nil {
		h.fail(w, e)
		return
	}
	h.json(w, 200, t)
}
func (h *HTTP) me(w http.ResponseWriter, r *http.Request) {
	p, ok := h.principal(w, r, false)
	if ok {
		h.json(w, 200, p)
	}
}
func (h *HTTP) devices(w http.ResponseWriter, r *http.Request) {
	p, ok := h.principal(w, r, false)
	if !ok {
		return
	}
	limit, cursor, e := page(r)
	if e != nil {
		h.fail(w, e)
		return
	}
	out, e := h.S.Devices(r.Context(), p, cursor, limit+1)
	if e != nil {
		h.fail(w, e)
		return
	}
	var next any
	if len(out) > limit {
		out = out[:limit]
		next = base64.RawURLEncoding.EncodeToString([]byte(out[len(out)-1].ID))
	}
	h.json(w, 200, map[string]any{"items": out, "nextCursor": next})
}
func (h *HTTP) revoke(w http.ResponseWriter, r *http.Request) {
	p, ok := h.principal(w, r, false)
	if !ok {
		return
	}
	if e := h.S.Revoke(r.Context(), p, r.PathValue("id")); e != nil {
		h.fail(w, e)
		return
	}
	h.json(w, 200, map[string]any{"revoked": true})
}
func (h *HTTP) logout(w http.ResponseWriter, r *http.Request) {
	p, ok := h.principal(w, r, false)
	if !ok {
		return
	}
	if e := h.S.Revoke(r.Context(), p, p.DeviceID); e != nil {
		h.fail(w, e)
		return
	}
	h.json(w, 200, map[string]any{"revoked": true})
}
func page(r *http.Request) (int, string, error) {
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		n, e := strconv.Atoi(v)
		if e != nil || n < 1 || n > 200 {
			return 0, "", ErrValidation
		}
		limit = n
	}
	raw := r.URL.Query().Get("cursor")
	if len(raw) > 512 {
		return 0, "", ErrValidation
	}
	if raw == "" {
		return limit, "", nil
	}
	b, e := base64.RawURLEncoding.DecodeString(raw)
	if e != nil {
		return 0, "", ErrValidation
	}
	return limit, string(b), nil
}
func (h *HTTP) users(w http.ResponseWriter, r *http.Request) {
	p, ok := h.principal(w, r, true)
	if !ok {
		return
	}
	limit, cursor, e := page(r)
	if e != nil {
		h.fail(w, e)
		return
	}
	out, e := h.S.Users(r.Context(), p, cursor, limit+1)
	if e != nil {
		h.fail(w, e)
		return
	}
	var next *string
	if len(out) > limit {
		out = out[:limit]
		n := base64.RawURLEncoding.EncodeToString([]byte(out[len(out)-1].ID))
		next = &n
	}
	h.json(w, 200, map[string]any{"items": out, "nextCursor": next})
}
func (h *HTTP) status(w http.ResponseWriter, r *http.Request) {
	p, ok := h.principal(w, r, true)
	if !ok {
		return
	}
	var in struct {
		Status  string `json:"status"`
		Reason  string `json:"reason"`
		Version string `json:"expectedVersion"`
	}
	if !h.decode(w, r, &in) {
		return
	}
	v, e := strconv.ParseInt(in.Version, 10, 64)
	if e != nil || v < 1 || strconv.FormatInt(v, 10) != in.Version {
		h.fail(w, ErrValidation)
		return
	}
	out, e := h.S.SetStatus(r.Context(), p, r.PathValue("id"), in.Status, in.Reason, r.Header.Get("Idempotency-Key"), v)
	if e != nil {
		h.fail(w, e)
		return
	}
	h.json(w, 200, out)
}
func (h *HTTP) audit(w http.ResponseWriter, r *http.Request) {
	p, ok := h.principal(w, r, true)
	if !ok {
		return
	}
	limit, cursor, e := page(r)
	if e != nil {
		h.fail(w, e)
		return
	}
	var n int64
	if cursor != "" {
		n, e = strconv.ParseInt(cursor, 10, 64)
		if e != nil || n < 1 {
			h.fail(w, ErrValidation)
			return
		}
	}
	out, e := h.S.Audit(r.Context(), p, n, limit+1)
	if e != nil {
		h.fail(w, e)
		return
	}
	var next *string
	if len(out) > limit {
		out = out[:limit]
		v := base64.RawURLEncoding.EncodeToString([]byte(stringInt(out[len(out)-1].ID)))
		next = &v
	}
	h.json(w, 200, map[string]any{"items": out, "nextCursor": next})
}

// Quiet server timeouts: body or header errors never include credential payloads.
func NewServer(address string, handler http.Handler) *http.Server {
	return &http.Server{Addr: address, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 * 1024}
}

// Mount routes inside the same configured Host and security middleware.
func (h *HTTP) Mount(pattern string, handler http.HandlerFunc) { h.mux.HandleFunc(pattern, handler) }

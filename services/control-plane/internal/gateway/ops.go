package gateway

import (
	"crypto/subtle"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

func (h *HTTP) opsPage(w http.ResponseWriter, r *http.Request) {
	if h.AdminAssets != nil {
		w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		f, e := h.AdminAssets.Open("index.html")
		if e != nil {
			http.Error(w, "Admin bundle unavailable", 503)
			return
		}
		defer f.Close()
		_, _ = io.Copy(w, f)
		return
	}
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	page := opsHTML
	if h.Identity.S.DisableAdminTOTP {
		page = strings.ReplaceAll(page, `<input name="otp" placeholder="6 位 TOTP" pattern="[0-9]{6}" required autocomplete="one-time-code">`, "")
		page = strings.ReplaceAll(page, "仅管理员且须 MFA。", "本机管理员使用邮箱和密码登录。")
	}
	_, _ = w.Write([]byte(page))
}
func (h *HTTP) opsScript(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	_, _ = w.Write([]byte(opsJS))
}
func (h *HTTP) sameOrigin(w http.ResponseWriter, r *http.Request) bool {
	if r.Header.Get("Origin") != h.Identity.PublicURL {
		fail(w, ErrForbidden)
		return false
	}
	return true
}
func (h *HTTP) opsLogin(w http.ResponseWriter, r *http.Request) {
	if !h.sameOrigin(w, r) {
		return
	}
	host, _, e := net.SplitHostPort(r.RemoteAddr)
	if e != nil {
		host = r.RemoteAddr
	}
	if e = h.Identity.S.Limit(r.Context(), "ops-login:"+host, 6); e != nil {
		fail(w, e)
		return
	}
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		OTP      string `json:"otp"`
	}
	if !decode(w, r, &in) {
		return
	}
	verifier := newID()
	flow, e := h.Identity.S.Start(r.Context(), identity.StartInput{DeviceName: "MaterialsX operations browser", Challenge: identity.Challenge(verifier), Method: "S256", Redirect: "http://127.0.0.1:40123/auth/callback"})
	if e != nil {
		fail(w, e)
		return
	}
	_, nonce, e := h.Identity.S.BrowserFlow(r.Context(), flow.ID)
	if e != nil {
		fail(w, e)
		return
	}
	_, code, e := h.Identity.S.Approve(r.Context(), flow.ID, nonce, in.Email, in.Password, in.OTP)
	if e != nil {
		fail(w, e)
		return
	}
	tokens, e := h.Identity.S.Exchange(r.Context(), flow.ID, code, verifier)
	if e != nil {
		fail(w, e)
		return
	}
	p, e := h.Identity.S.Authenticate(r.Context(), tokens.AccessToken)
	if e != nil {
		fail(w, e)
		return
	}
	if !h.Identity.S.AdminAllowed(p) {
		_ = h.Identity.S.Revoke(r.Context(), p, p.DeviceID)
		fail(w, ErrForbidden)
		return
	}
	csrf := newID()
	for name, value := range map[string]string{"mx_ops": tokens.AccessToken, "mx_ops_csrf": csrf} {
		http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/ops", HttpOnly: true, Secure: h.Identity.Production, SameSite: http.SameSiteStrictMode, MaxAge: tokens.ExpiresIn})
	}
	// No refresh token enters the browser. Expiry requires a fresh password + TOTP login.
	writeJSON(w, 200, map[string]any{"csrf": csrf, "expiresIn": tokens.ExpiresIn})
}
func (h *HTTP) opsAuthorized(w http.ResponseWriter, r *http.Request) (*http.Request, bool) {
	cookie, e := r.Cookie("mx_ops")
	if e != nil {
		fail(w, identity.ErrUnauthenticated)
		return r, false
	}
	if r.Method != "GET" {
		if !h.sameOrigin(w, r) {
			return r, false
		}
		csrf, e := r.Cookie("mx_ops_csrf")
		if e != nil || len(csrf.Value) != 43 || subtle.ConstantTimeCompare([]byte(csrf.Value), []byte(r.Header.Get("X-CSRF-Token"))) != 1 {
			fail(w, ErrForbidden)
			return r, false
		}
	}
	clone := r.Clone(r.Context())
	clone.Header = r.Header.Clone()
	clone.Header.Set("Authorization", "Bearer "+cookie.Value)
	if _, ok := h.admin(w, clone); !ok {
		return clone, false
	}
	return clone, true
}
func (h *HTTP) opsSession(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.opsAuthorized(w, r); !ok {
		return
	}
	csrf, e := r.Cookie("mx_ops_csrf")
	if e != nil {
		fail(w, identity.ErrUnauthenticated)
		return
	}
	writeJSON(w, 200, map[string]any{"csrf": csrf.Value})
}
func (h *HTTP) opsLogout(w http.ResponseWriter, r *http.Request) {
	clone, ok := h.opsAuthorized(w, r)
	if !ok {
		return
	}
	p, ok := h.admin(w, clone)
	if !ok {
		return
	}
	if e := h.Identity.S.Revoke(r.Context(), p, p.DeviceID); e != nil {
		fail(w, e)
		return
	}
	for _, name := range []string{"mx_ops", "mx_ops_csrf"} {
		http.SetCookie(w, &http.Cookie{Name: name, Path: "/ops", HttpOnly: true, Secure: h.Identity.Production, SameSite: http.SameSiteStrictMode, MaxAge: -1, Expires: time.Unix(0, 0)})
	}
	writeJSON(w, 200, map[string]bool{"loggedOut": true})
}
func (h *HTTP) opsPending(w http.ResponseWriter, r *http.Request) {
	clone, ok := h.opsAuthorized(w, r)
	if ok {
		h.pendingBilling(w, clone)
	}
}
func (h *HTTP) opsReconcile(w http.ResponseWriter, r *http.Request) {
	clone, ok := h.opsAuthorized(w, r)
	if ok {
		h.reconcile(w, clone)
	}
}
func (h *HTTP) opsPreview(w http.ResponseWriter, r *http.Request) {
	clone, ok := h.opsAuthorized(w, r)
	if ok {
		h.previewBilling(w, clone)
	}
}
func (h *HTTP) opsVerify(w http.ResponseWriter, r *http.Request) {
	clone, ok := h.opsAuthorized(w, r)
	if ok {
		h.billingVerify(w, clone)
	}
}
func (h *HTTP) opsOverview(w http.ResponseWriter, r *http.Request) {
	clone, ok := h.opsAuthorized(w, r)
	if ok {
		h.billingOverview(w, clone)
	}
}
func (h *HTTP) billingOverview(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.admin(w, r); !ok {
		return
	}
	var requests, pending, unknown int
	var cost, paidCharged, paidHeld string
	e := h.S.Pool.QueryRow(r.Context(), `SELECT count(*),count(*) FILTER(WHERE r.settlement='reconciliation_pending'),count(*) FILTER(WHERE l.request_id IS NULL AND (c.state IS NULL OR c.state='unknown')),COALESCE(sum(CASE WHEN l.request_id IS NOT NULL THEN (l.cost_microfen+999999)/1000000 WHEN c.state='verified' THEN c.cost_fen ELSE NULL END),0)::text FROM gateway_requests r LEFT JOIN procurement_costs c ON c.request_id=r.id LEFT JOIN procurement_statement_lines l ON l.request_id=r.id`).Scan(&requests, &pending, &unknown, &cost)
	if e != nil {
		fail(w, e)
		return
	}
	e = h.S.Pool.QueryRow(r.Context(), `SELECT COALESCE(sum(charged),0)::text,COALESCE(sum(reserved) FILTER(WHERE status IN ('reserved','reconciliation_pending')),0)::text FROM credit_reservations WHERE precision=10000`).Scan(&paidCharged, &paidHeld)
	if e != nil {
		fail(w, e)
		return
	}
	a, e := metering.Amount(paidCharged)
	if e != nil {
		fail(w, e)
		return
	}
	b, e := metering.Amount(paidHeld)
	if e != nil {
		fail(w, e)
		return
	}
	paidCharged = metering.Display(a, metering.PaidPrecision)
	paidHeld = metering.Display(b, metering.PaidPrecision)
	writeJSON(w, 200, map[string]any{"requests": requests, "pendingRequests": pending, "procurementUnknownRequests": unknown, "knownProcurementFen": cost, "formalSalesEnabled": h.Payments != nil && h.Payments.FormalEnabled, "paidChargedCredits": paidCharged, "paidHeldCredits": paidHeld})
}

const opsHTML = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MaterialsX · 运营用量</title><style>body{font:15px system-ui;background:#f6f7f8;color:#222;max-width:1100px;margin:32px auto;padding:20px}section{background:white;border:1px solid #ddd;border-radius:14px;padding:22px;margin:18px 0}input,textarea,button{font:inherit;padding:10px;margin:6px;border:1px solid #ccc;border-radius:8px}textarea{width:90%;height:180px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}button{cursor:pointer}small{color:#666}#status{min-height:1.5em}</style><h1>MaterialsX · 运营用量与核对</h1><p>真实积分与 test-credit 独立计量；正式售卖尚未开启。© 2026 吉林大学 AI-DAOS 团队</p><section id="login"><h2>管理员登录</h2><form><input name="email" type="email" placeholder="管理员邮箱" required autocomplete="username"><input name="password" type="password" placeholder="密码" required autocomplete="current-password"><input name="otp" placeholder="6 位 TOTP" pattern="[0-9]{6}" required autocomplete="one-time-code"><button>登录</button></form><small>仅管理员且须 MFA。会话到期重新登录。</small></section><p id="status" role="status"></p><section id="work" hidden><button id="refresh">刷新用量与待核对队列</button><button id="verify">重建并校验账本</button><button id="logout">退出</button><h2>用量 / 采购成本</h2><pre id="overview"></pre><h2>待核对请求</h2><pre id="pending"></pre><h2>核对证据</h2><p>先复制队列里的 requestId 和 version。输入 usage、no-call 或 waiver 结论、证据编号和原因；提交会追加审计记录。usage 不改变原执行结果或科学质量。waiver 由平台承担，采购成本仍未知。</p><textarea id="evidence" aria-label="核对证据 JSON" placeholder='{"requestId":"请求编号","expectedVersion":2,"resolution":"usage","sourceRef":"供应商账单编号","reason":"核对原因","usage":{"source":"responses","inputTokens":10,"outputTokens":4,"cachedInputTokens":2,"uncachedInputTokens":8,"reasoningTokens":1}}'></textarea><button id="submit">提交核对证据</button></section><script src="/ops/app.js" defer></script><script src="/ops/finance.js" defer></script></html>`
const opsJS = `let csrf="";const $=id=>document.getElementById(id);const show=msg=>$("status").textContent=msg;async function api(path,body,key){const r=await fetch("/ops/api/"+path,{credentials:"same-origin",method:body?"POST":"GET",headers:{"Content-Type":"application/json",...(body?{"X-CSRF-Token":csrf}:{}),...(key?{"Idempotency-Key":key}:{})},...(body?{body:JSON.stringify(body)}:{})});let v;try{v=await r.json()}catch{throw Error("服务暂不可用")};if(!r.ok){if(r.status===401){$("login").hidden=false;$("work").hidden=true;csrf=""}throw Error(v.error?.code??"操作失败")};return v}async function refresh(){const overview=await api("overview");const pending=await api("pending");$("overview").textContent=JSON.stringify(overview,null,2);$("pending").textContent=JSON.stringify(pending,null,2)}async function action(fn){try{await fn();show("操作完成")}catch{show("操作被拒绝或连接失败；请检查会话、证据编号和版本。")}}$("login").querySelector("form").onsubmit=e=>{e.preventDefault();action(async()=>{const f=new FormData(e.target);const v=await api("login",Object.fromEntries(f));csrf=v.csrf;e.target.reset();$("login").hidden=true;$("work").hidden=false;await refresh()})};$("refresh").onclick=()=>action(refresh);$("verify").onclick=()=>action(async()=>show(JSON.stringify(await api("verify"))));$("logout").onclick=()=>action(async()=>{await api("logout",{});csrf="";$("work").hidden=true;$("login").hidden=false});$("submit").onclick=()=>action(async()=>{const v=JSON.parse($("evidence").value);const preview=await api("preview",v);if(!confirm("确认核对？\n"+JSON.stringify(preview,null,2)+"\n将追加账本与审计记录。"))return;await api("reconcile",v,v.requestId);await refresh();$("evidence").value=""});(async()=>{try{csrf=(await api("session")).csrf;$("login").hidden=true;$("work").hidden=false;await refresh()}catch{}})();`

func (h *HTTP) opsAuthConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, map[string]bool{"totpRequired": !h.Identity.S.DisableAdminTOTP})
}

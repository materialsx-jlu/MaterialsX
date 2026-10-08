package identity

import (
	"context"
	"crypto/subtle"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/delivery"
	"html/template"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
)

type EmailOptions struct {
	Enabled      bool
	Signup       bool
	TermsVersion string
	TermsURL     string
}

// Disabled unless a deployment explicitly enables email and supplies approved terms.
func (h *HTTP) ConfigureEmail(o EmailOptions) error {
	if !o.Enabled {
		return nil
	}
	if o.Signup {
		u, e := url.Parse(o.TermsURL)
		if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || len(o.TermsVersion) < 1 || len(o.TermsVersion) > 100 {
			return ErrValidation
		}
	}
	h.EmailEnabled = true
	h.SignupEnabled = o.Signup
	h.Mount("GET /auth/selfserve", h.emailForm(o))
	h.Mount("POST /auth/selfserve", h.emailSubmit(o))
	return nil
}
func (s *Service) RequestEmail(ctx context.Context, kind, email, name, password, terms, origin string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	addr, e := mail.ParseAddress(email)
	if e != nil || addr.Address != email || len(email) > 254 || (kind != "register" && kind != "reset") {
		return ErrValidation
	}
	// Per-address throttling is independent of whether an account exists.
	if e = s.Limit(ctx, "email:"+digest(email), 3); e != nil {
		return e
	}
	hash := ""
	if kind == "register" {
		if len(strings.TrimSpace(name)) < 1 || len(name) > 100 || len(terms) == 0 {
			return ErrValidation
		}
		hash, e = passwordHash(password)
		if e != nil {
			return e
		}
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var exists, resettable bool
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM accounts WHERE email=$1),EXISTS(SELECT 1 FROM accounts WHERE email=$1 AND role='user' AND status='active')`, email).Scan(&exists, &resettable)
	if e != nil {
		return e
	}
	// Both paths return the same public response. Administrators use host-side MFA recovery.
	if (kind == "register" && exists) || (kind == "reset" && !resettable) {
		return nil
	}
	token := randomID()
	hashed := digest(token)
	var storedHash any
	if hash != "" {
		storedHash = hash
	}
	if _, e = tx.Exec(ctx, `INSERT INTO email_challenges(token_hash,kind,email,display_name,password_hash,terms_version,expires_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '30 minutes')`, hashed, kind, email, name, storedHash, terms); e != nil {
		return e
	}
	link := origin + "/auth/selfserve?kind=" + kind + "&token=" + url.QueryEscape(token)
	if e = (delivery.Store{Pool: s.Pool, Key: s.key}).Enqueue(ctx, tx, "email:"+hashed, delivery.Message{To: email, Subject: "MaterialsX 邮箱验证", Text: "请打开下面的链接，并在页面确认操作。链接 30 分钟内有效，只能使用一次。\n\n" + link + "\n\n若不是您本人发起，请忽略。"}); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Service) ConsumeEmail(ctx context.Context, token, password string) error {
	if !challengeRE.MatchString(token) {
		return ErrValidation
	}
	var kind string
	e := s.Pool.QueryRow(ctx, `SELECT kind FROM email_challenges WHERE token_hash=$1`, digest(token)).Scan(&kind)
	if e != nil {
		return ErrValidation
	}
	var hash any
	if kind == "reset" {
		h, e := passwordHash(password)
		if e != nil {
			return e
		}
		hash = h
	}
	var uid *string
	e = s.Pool.QueryRow(ctx, `SELECT consume_email_challenge($1,$2,$3)`, digest(token), hash, randomID()).Scan(&uid)
	if e != nil {
		return e
	}
	if uid == nil {
		return ErrValidation
	}
	return nil
}

var emailTemplate = template.Must(template.New("email").Parse(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MaterialsX 账户</title><style>body{font:14px system-ui;background:#f6f6f4;color:#222;margin:0}main{max-width:440px;margin:6vh auto;background:white;padding:28px;border:1px solid #ddd;border-radius:12px}form{display:grid;gap:18px}label{display:block;line-height:1.6}input:not([type=checkbox]){box-sizing:border-box;width:100%;padding:11px;margin-top:6px;border:1px solid #ccc;border-radius:7px}button{background:#252525;color:white;border:0;border-radius:7px;padding:12px;cursor:pointer}p{line-height:1.65;color:#666}a{color:#315caa}</style><body><main><h1>MaterialsX 账户</h1>{{if .Message}}<p role="status">{{.Message}}</p>{{else}}<form method="post" action="/auth/selfserve"><input type="hidden" name="csrf" value="{{.CSRF}}"><input type="hidden" name="kind" value="{{.Kind}}"><input type="hidden" name="token" value="{{.Token}}">{{if .Token}}<p>确认{{if eq .Kind "register"}}验证邮箱并创建账户{{else}}重置密码（将退出所有旧设备）{{end}}。</p>{{else}}<label>邮箱 <input type="email" name="email" required maxlength="254" autocomplete="email"></label>{{if eq .Kind "register"}}<label>显示名称 <input name="name" required maxlength="100"></label>{{end}}{{end}}{{if or (eq .Kind "register") (and .Token (eq .Kind "reset"))}}{{if not (and .Token (eq .Kind "register"))}}<label>密码（12–128 字符）<input type="password" name="password" required minlength="12" maxlength="128" autocomplete="new-password"></label>{{end}}{{end}}{{if and (eq .Kind "register") (not .Token)}}<label><input type="checkbox" name="consent" value="yes" required>我已阅读并同意 <a href="{{.TermsURL}}" rel="noreferrer">账户条款与隐私说明</a>（{{.TermsVersion}}）</label>{{end}}<button type="submit">{{if .Token}}确认操作{{else}}发送验证邮件{{end}}</button></form>{{end}}<p><a href="/auth/selfserve?kind=reset">找回密码</a>{{if .Signup}} · <a href="/auth/selfserve?kind=register">注册账户</a>{{end}}</p><p>© 2026 吉林大学 AI-DAOS 团队</p></main></body></html>`))

func (h *HTTP) emailForm(o EmailOptions) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !h.limit(w, r, "email-form", 30) {
			return
		}
		kind := r.URL.Query().Get("kind")
		if kind != "register" {
			kind = "reset"
		}
		if kind == "register" && !o.Signup {
			h.fail(w, ErrForbidden)
			return
		}
		token := r.URL.Query().Get("token")
		if token != "" && !challengeRE.MatchString(token) {
			h.fail(w, ErrValidation)
			return
		}
		csrf := randomID()
		http.SetCookie(w, &http.Cookie{Name: "mx_email_csrf", Value: csrf, Path: "/auth/selfserve", HttpOnly: true, Secure: h.Production, SameSite: http.SameSiteStrictMode, MaxAge: 1800})
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_ = emailTemplate.Execute(w, map[string]any{"Kind": kind, "Token": token, "CSRF": csrf, "Signup": o.Signup, "TermsURL": o.TermsURL, "TermsVersion": o.TermsVersion})
	}
}
func (h *HTTP) emailSubmit(o EmailOptions) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !h.limit(w, r, "email-submit", 6) {
			return
		}
		if r.Header.Get("Origin") != h.PublicURL {
			h.fail(w, ErrForbidden)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 8192)
		if e := r.ParseForm(); e != nil {
			h.fail(w, ErrValidation)
			return
		}
		cookie, e := r.Cookie("mx_email_csrf")
		csrf := r.PostFormValue("csrf")
		if e != nil || len(csrf) != 43 || subtle.ConstantTimeCompare([]byte(csrf), []byte(cookie.Value)) != 1 {
			h.fail(w, ErrForbidden)
			return
		}
		kind := r.PostFormValue("kind")
		if kind != "register" && kind != "reset" || (kind == "register" && !o.Signup) {
			h.fail(w, ErrValidation)
			return
		}
		token := r.PostFormValue("token")
		message := "如该邮箱符合条件，验证邮件将发送到您的邮箱。"
		if token != "" {
			e = h.S.ConsumeEmail(r.Context(), token, r.PostFormValue("password"))
			message = "操作完成。请返回 MaterialsX 重新登录。"
		} else {
			if kind == "register" && r.PostFormValue("consent") != "yes" {
				h.fail(w, ErrValidation)
				return
			}
			e = h.S.RequestEmail(r.Context(), kind, r.PostFormValue("email"), r.PostFormValue("name"), r.PostFormValue("password"), o.TermsVersion, h.PublicURL)
		}
		if e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				e = ErrValidation
			}
			h.fail(w, e)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_ = emailTemplate.Execute(w, map[string]any{"Message": message, "Signup": o.Signup})
	}
}

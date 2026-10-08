package identity

import (
	"context"
	"crypto/subtle"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/mail"
	"regexp"
	"strings"
	"time"
)

var (
	ErrValidation      = errors.New("VALIDATION_ERROR")
	ErrUnauthenticated = errors.New("UNAUTHENTICATED")
	ErrForbidden       = errors.New("FORBIDDEN")
	ErrNotFound        = errors.New("NOT_FOUND")
	ErrConflict        = errors.New("OPERATION_CONFLICT")
	ErrIdempotency     = errors.New("IDEMPOTENCY_CONFLICT")
	ErrRateLimited     = errors.New("RATE_LIMITED")
)
var callbackRE = regexp.MustCompile(`^http://127\.0\.0\.1:([1-9][0-9]{0,4})/auth/callback$`)
var challengeRE = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
var verifierRE = regexp.MustCompile(`^[A-Za-z0-9._~-]{43,128}$`)

type Service struct {
	DisableAdminTOTP bool
	Pool             *pgxpool.Pool
	key              []byte
	dummyHash        string
	now              func() time.Time
}

func New(pool *pgxpool.Pool, key []byte) (*Service, error) {
	if len(key) != 32 {
		return nil, ErrValidation
	}
	h, e := passwordHash(randomID())
	if e != nil {
		return nil, e
	}
	return &Service{Pool: pool, key: append([]byte(nil), key...), dummyHash: h, now: func() time.Time { return time.Now().UTC() }}, nil
}

type User struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	Status      string `json:"status"`
	Version     int64  `json:"version,string"`
}
type Principal struct {
	User
	DeviceID  string `json:"deviceId"`
	SessionID string `json:"-"`
	MFA       bool   `json:"mfaVerified"`
}
type Device struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	CreatedAt time.Time  `json:"createdAt"`
	RevokedAt *time.Time `json:"revokedAt"`
	Current   bool       `json:"current"`
}
type Tokens struct {
	TokenType    string `json:"tokenType"`
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresIn    int    `json:"expiresIn"`
	DeviceID     string `json:"deviceId"`
}
type StartInput struct {
	DeviceName string `json:"deviceName"`
	Challenge  string `json:"codeChallenge"`
	Method     string `json:"codeChallengeMethod"`
	Redirect   string `json:"redirectUri"`
}
type Flow struct {
	ID, State, Challenge, Redirect, DeviceName string
	ExpiresAt                                  time.Time
}

func audit(ctx context.Context, tx pgx.Tx, actor *string, action, target, result, reason string) error {
	_, e := tx.Exec(ctx, `INSERT INTO audit_events(actor_id,action,target_id,result,reason) VALUES($1,$2,$3,$4,$5)`, actor, action, target, result, reason)
	return e
}
func (s *Service) CreateAccount(ctx context.Context, email, name, password, role, totp string) (User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	address, e := mail.ParseAddress(email)
	if e != nil || address.Address != email || len(email) > 254 || len(name) < 1 || len(name) > 100 || (role != "user" && role != "admin" && role != "billing_staff") {
		return User{}, ErrValidation
	}
	h, e := passwordHash(password)
	if e != nil {
		return User{}, e
	}
	u := User{randomID(), email, name, role, "active", 1}
	var secret []byte
	if role == "admin" || role == "billing_staff" {
		if _, e = TOTP(totp, 1); e != nil {
			return User{}, ErrValidation
		}
		secret, e = encryptSecret(s.key, u.ID, totp)
		if e != nil {
			return User{}, e
		}
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return User{}, e
	}
	defer tx.Rollback(ctx)
	// Only one initial administrator. Role grants are deploy operations, not signup input.
	if role == "admin" {
		if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(51201002)`); e != nil {
			return User{}, e
		}
		var exists bool
		if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM accounts WHERE role='admin')`).Scan(&exists); e != nil {
			return User{}, e
		}
		if exists {
			return User{}, ErrConflict
		}
	}
	if _, e = tx.Exec(ctx, `INSERT INTO accounts(id,email,display_name,password_hash,role,mfa_cipher) VALUES($1,$2,$3,$4,$5,$6)`, u.ID, email, name, h, role, secret); e != nil {
		return User{}, ErrConflict
	}
	if role == "admin" {
		if _, e = tx.Exec(ctx, `INSERT INTO billing_staff_roles(account_id,role) VALUES($1,'billing.admin')`, u.ID); e != nil {
			return User{}, e
		}
	}
	if e = audit(ctx, tx, nil, "account.provision", u.ID, "succeeded", "deployment CLI"); e != nil {
		return User{}, e
	}
	return u, tx.Commit(ctx)
}
func (s *Service) Start(ctx context.Context, in StartInput) (Flow, error) {
	matches := callbackRE.FindStringSubmatch(in.Redirect)
	var port int
	if len(matches) == 2 {
		for _, c := range matches[1] {
			port = port*10 + int(c-'0')
		}
	}
	if in.Method != "S256" || !challengeRE.MatchString(in.Challenge) || port < 1 || port > 65535 || len(strings.TrimSpace(in.DeviceName)) < 1 || len(in.DeviceName) > 100 {
		return Flow{}, ErrValidation
	}
	f := Flow{randomID(), randomID(), in.Challenge, in.Redirect, in.DeviceName, s.now().Add(5 * time.Minute)}
	_, e := s.Pool.Exec(ctx, `INSERT INTO auth_flows(id,state,challenge,redirect_uri,device_name,expires_at) VALUES($1,$2,$3,$4,$5,$6)`, f.ID, f.State, f.Challenge, f.Redirect, f.DeviceName, f.ExpiresAt)
	return f, e
}
func (s *Service) BrowserFlow(ctx context.Context, id string) (Flow, string, error) {
	nonce := randomID()
	f := Flow{ID: id}
	e := s.Pool.QueryRow(ctx, `UPDATE auth_flows SET nonce_hash=$2 WHERE id=$1 AND approved_at IS NULL AND consumed_at IS NULL AND expires_at>$3 RETURNING state,challenge,redirect_uri,device_name,expires_at`, id, digest(nonce), s.now()).Scan(&f.State, &f.Challenge, &f.Redirect, &f.DeviceName, &f.ExpiresAt)
	if errors.Is(e, pgx.ErrNoRows) {
		return f, "", ErrNotFound
	}
	return f, nonce, e
}
func (s *Service) Approve(ctx context.Context, id, nonce, email, password, otp string) (Flow, string, error) {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Flow{}, "", e
	}
	defer tx.Rollback(ctx)
	f := Flow{ID: id}
	var nonceHash string
	e = tx.QueryRow(ctx, `SELECT state,challenge,redirect_uri,device_name,expires_at,COALESCE(nonce_hash,'') FROM auth_flows WHERE id=$1 AND approved_at IS NULL AND consumed_at IS NULL FOR UPDATE`, id).Scan(&f.State, &f.Challenge, &f.Redirect, &f.DeviceName, &f.ExpiresAt, &nonceHash)
	if e != nil || !f.ExpiresAt.After(s.now()) || nonceHash == "" || subtle.ConstantTimeCompare([]byte(nonceHash), []byte(digest(nonce))) != 1 {
		return f, "", ErrUnauthenticated
	}
	var u User
	var encoded string
	var cipher []byte
	var last int64
	e = tx.QueryRow(ctx, `SELECT id,email,display_name,role,status,password_hash,mfa_cipher,last_totp_step FROM accounts WHERE email=$1 FOR UPDATE`, strings.ToLower(strings.TrimSpace(email))).Scan(&u.ID, &u.Email, &u.DisplayName, &u.Role, &u.Status, &encoded, &cipher, &last)
	exists := e == nil
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		return f, "", e
	}
	if !exists {
		encoded = s.dummyHash
	}
	valid := passwordMatches(encoded, password) && exists && u.Status == "active"
	mfa := false
	if valid && (u.Role == "admin" || u.Role == "billing_staff") && !s.DisableAdminTOTP {
		secret, err := decryptSecret(s.key, u.ID, cipher)
		step, ok := matchTOTP(secret, otp, s.now(), last)
		valid = err == nil && ok
		mfa = valid
		if valid {
			if _, e = tx.Exec(ctx, `UPDATE accounts SET last_totp_step=$2 WHERE id=$1`, u.ID, step); e != nil {
				return f, "", e
			}
		}
	}
	if !valid {
		var actor *string
		if exists {
			actor = &u.ID
		}
		if e = audit(ctx, tx, actor, "auth.login", id, "denied", ""); e != nil {
			return f, "", e
		}
		if e = tx.Commit(ctx); e != nil {
			return f, "", e
		}
		return f, "", ErrUnauthenticated
	}
	code := "mx_code_" + randomID()
	_, e = tx.Exec(ctx, `UPDATE auth_flows SET account_id=$2,code_hash=$3,approved_at=$4,mfa_verified=$5,expires_at=LEAST(expires_at,$4::timestamptz+interval '60 seconds') WHERE id=$1`, id, u.ID, digest(code), s.now(), mfa)
	if e != nil {
		return f, "", e
	}
	if e = audit(ctx, tx, &u.ID, "auth.approve", id, "succeeded", ""); e != nil {
		return f, "", e
	}
	return f, code, tx.Commit(ctx)
}
func (s *Service) issue(ctx context.Context, tx pgx.Tx, session, device string, expires time.Time) (Tokens, error) {
	t := Tokens{"Bearer", "mx_at_" + randomID(), "mx_rt_" + randomID(), 900, device}
	if _, e := tx.Exec(ctx, `INSERT INTO access_tokens(token_hash,session_id,expires_at) VALUES($1,$2,$3)`, digest(t.AccessToken), session, s.now().Add(15*time.Minute)); e != nil {
		return Tokens{}, e
	}
	if _, e := tx.Exec(ctx, `INSERT INTO refresh_tokens(token_hash,session_id,expires_at) VALUES($1,$2,$3)`, digest(t.RefreshToken), session, expires); e != nil {
		return Tokens{}, e
	}
	return t, nil
}
func (s *Service) Exchange(ctx context.Context, id, code, verifier string) (Tokens, error) {
	if len(code) > 512 || !verifierRE.MatchString(verifier) {
		return Tokens{}, ErrUnauthenticated
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Tokens{}, e
	}
	defer tx.Rollback(ctx)
	var account, name, challenge, hash string
	var expires time.Time
	var mfa bool
	e = tx.QueryRow(ctx, `SELECT account_id,device_name,challenge,code_hash,expires_at,mfa_verified FROM auth_flows WHERE id=$1 AND approved_at IS NOT NULL AND consumed_at IS NULL FOR UPDATE`, id).Scan(&account, &name, &challenge, &hash, &expires, &mfa)
	if e != nil || !expires.After(s.now()) || subtle.ConstantTimeCompare([]byte(hash), []byte(digest(code))) != 1 || subtle.ConstantTimeCompare([]byte(challenge), []byte(Challenge(verifier))) != 1 {
		return Tokens{}, ErrUnauthenticated
	}
	var status, role string
	if e = tx.QueryRow(ctx, `SELECT status,role FROM accounts WHERE id=$1 FOR UPDATE`, account).Scan(&status, &role); e != nil || status != "active" || ((role == "admin" || role == "billing_staff") && !mfa && !s.DisableAdminTOTP) {
		return Tokens{}, ErrUnauthenticated
	}
	device, session := randomID(), randomID()
	expiry := s.now().Add(30 * 24 * time.Hour)
	if role == "admin" || role == "billing_staff" {
		expiry = s.now().Add(12 * time.Hour)
	}
	var mfaAt *time.Time
	if mfa {
		now := s.now()
		mfaAt = &now
		expiry = now.Add(12 * time.Hour)
	}
	if _, e = tx.Exec(ctx, `INSERT INTO devices(id,account_id,name) VALUES($1,$2,$3)`, device, account, name); e != nil {
		return Tokens{}, e
	}
	if _, e = tx.Exec(ctx, `INSERT INTO sessions(id,account_id,device_id,expires_at,mfa_verified_at) VALUES($1,$2,$3,$4,$5)`, session, account, device, expiry, mfaAt); e != nil {
		return Tokens{}, e
	}
	if _, e = tx.Exec(ctx, `UPDATE auth_flows SET consumed_at=$2 WHERE id=$1`, id, s.now()); e != nil {
		return Tokens{}, e
	}
	result, e := s.issue(ctx, tx, session, device, expiry)
	if e != nil {
		return Tokens{}, e
	}
	if e = audit(ctx, tx, &account, "auth.exchange", device, "succeeded", ""); e != nil {
		return Tokens{}, e
	}
	return result, tx.Commit(ctx)
}
func (s *Service) Refresh(ctx context.Context, token string) (Tokens, error) {
	if len(token) > 2048 || !strings.HasPrefix(token, "mx_rt_") {
		return Tokens{}, ErrUnauthenticated
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Tokens{}, e
	}
	defer tx.Rollback(ctx)
	var session, account string
	e = tx.QueryRow(ctx, `SELECT r.session_id,s.account_id FROM refresh_tokens r JOIN sessions s ON s.id=r.session_id WHERE r.token_hash=$1`, digest(token)).Scan(&session, &account)
	if e != nil {
		return Tokens{}, ErrUnauthenticated
	}
	var status string
	if e = tx.QueryRow(ctx, `SELECT status FROM accounts WHERE id=$1 FOR UPDATE`, account).Scan(&status); e != nil || status != "active" {
		return Tokens{}, ErrUnauthenticated
	}
	var device string
	var expiry time.Time
	var revoked *time.Time
	e = tx.QueryRow(ctx, `SELECT device_id,expires_at,revoked_at FROM sessions WHERE id=$1 FOR UPDATE`, session).Scan(&device, &expiry, &revoked)
	if e != nil || revoked != nil || !expiry.After(s.now()) {
		return Tokens{}, ErrUnauthenticated
	}
	var used *time.Time
	var tokenExpiry time.Time
	e = tx.QueryRow(ctx, `SELECT used_at,expires_at FROM refresh_tokens WHERE token_hash=$1 FOR UPDATE`, digest(token)).Scan(&used, &tokenExpiry)
	if e != nil || !tokenExpiry.After(s.now()) {
		return Tokens{}, ErrUnauthenticated
	}
	if used != nil {
		if _, e = tx.Exec(ctx, `UPDATE sessions SET revoked_at=$2 WHERE id=$1`, session, s.now()); e != nil {
			return Tokens{}, e
		}
		if e = audit(ctx, tx, &account, "auth.refresh_replay", device, "denied", ""); e != nil {
			return Tokens{}, e
		}
		if e = tx.Commit(ctx); e != nil {
			return Tokens{}, e
		}
		return Tokens{}, ErrUnauthenticated
	}
	if _, e = tx.Exec(ctx, `UPDATE refresh_tokens SET used_at=$2 WHERE token_hash=$1`, digest(token), s.now()); e != nil {
		return Tokens{}, e
	}
	result, e := s.issue(ctx, tx, session, device, expiry)
	if e != nil {
		return Tokens{}, e
	}
	if e = audit(ctx, tx, &account, "auth.refresh", device, "succeeded", ""); e != nil {
		return Tokens{}, e
	}
	return result, tx.Commit(ctx)
}
func (s *Service) Authenticate(ctx context.Context, token string) (Principal, error) {
	var p Principal
	if len(token) > 4096 || !strings.HasPrefix(token, "mx_at_") {
		return p, ErrUnauthenticated
	}
	e := s.Pool.QueryRow(ctx, `SELECT a.id,a.email,a.display_name,a.role,a.status,a.version,d.id,s.id,(s.mfa_verified_at IS NOT NULL AND s.mfa_verified_at>$2::timestamptz-interval '12 hours')
 FROM access_tokens t JOIN sessions s ON s.id=t.session_id JOIN devices d ON d.id=s.device_id JOIN accounts a ON a.id=s.account_id
 WHERE t.token_hash=$1 AND t.expires_at>$2 AND s.expires_at>$2 AND s.revoked_at IS NULL AND d.revoked_at IS NULL AND a.status='active'`, digest(token), s.now()).Scan(&p.ID, &p.Email, &p.DisplayName, &p.Role, &p.Status, &p.Version, &p.DeviceID, &p.SessionID, &p.MFA)
	if e != nil {
		return p, ErrUnauthenticated
	}
	return p, nil
}
func (s *Service) Devices(ctx context.Context, p Principal, cursor string, limit int) ([]Device, error) {
	rows, e := s.Pool.Query(ctx, `SELECT id,name,created_at,revoked_at FROM devices WHERE account_id=$1 AND id>$2 ORDER BY id LIMIT $3`, p.ID, cursor, limit)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Device{}
	for rows.Next() {
		var d Device
		if e = rows.Scan(&d.ID, &d.Name, &d.CreatedAt, &d.RevokedAt); e != nil {
			return nil, e
		}
		d.Current = d.ID == p.DeviceID
		d.CreatedAt = d.CreatedAt.UTC()
		if d.RevokedAt != nil {
			v := d.RevokedAt.UTC()
			d.RevokedAt = &v
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
func (s *Service) Revoke(ctx context.Context, p Principal, device string) error {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	tag, e := tx.Exec(ctx, `UPDATE devices SET revoked_at=COALESCE(revoked_at,$3) WHERE id=$1 AND account_id=$2`, device, p.ID, s.now())
	if e != nil {
		return e
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if _, e = tx.Exec(ctx, `UPDATE sessions SET revoked_at=COALESCE(revoked_at,$2) WHERE device_id=$1`, device, s.now()); e != nil {
		return e
	}
	if e = audit(ctx, tx, &p.ID, "device.revoke", device, "succeeded", ""); e != nil {
		return e
	}
	return tx.Commit(ctx)
}

// Limit is shared across processes; keys contain hashes, never IP/email plaintext.
func (s *Service) Limit(ctx context.Context, key string, max int) error {
	var n int
	e := s.Pool.QueryRow(ctx, `INSERT INTO rate_limits(key_hash,window_start,attempts) VALUES($1,date_trunc('minute',clock_timestamp()),1)
 ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN rate_limits.window_start=EXCLUDED.window_start THEN rate_limits.attempts+1 ELSE 1 END,window_start=EXCLUDED.window_start RETURNING attempts`, digest(key)).Scan(&n)
	if e != nil {
		return e
	}
	if n > max {
		return ErrRateLimited
	}
	return nil
}

// AdminAllowed preserves the role check when local development disables TOTP.
func (s *Service) AdminAllowed(p Principal) bool {
	return p.Role == "admin" && (p.MFA || s.DisableAdminTOTP)
}

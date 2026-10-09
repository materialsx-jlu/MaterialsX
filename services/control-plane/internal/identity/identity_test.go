package identity

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jamip/materialsx/control-plane/migrations"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const fixturePassword = "synthetic-fixture-password-only"
const fixtureTOTP = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

func testPool(t *testing.T) (*pgxpool.Pool, string) {
	t.Helper()
	dsn := os.Getenv("MATERIALSX_IDENTITY_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("PostgreSQL integration requires isolated MATERIALSX_IDENTITY_TEST_DATABASE_URL")
	}
	u, e := url.Parse(dsn)
	if e != nil || !strings.Contains(u.Path, "test") {
		t.Fatal("integration DSN must name a test database")
	}
	ctx := context.Background()
	owner, e := pgx.Connect(ctx, dsn)
	if e != nil {
		t.Fatal("test PostgreSQL unavailable")
	}
	db := "mx_id_test_" + strings.ToLower(randomID()[:12])
	db = strings.ReplaceAll(db, "-", "a")
	db = strings.ReplaceAll(db, "_", "b")
	if _, e = owner.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{db}.Sanitize()); e != nil {
		t.Fatal("test role needs CREATEDB")
	}
	u.Path = "/" + db
	pool, e := OpenPool(ctx, Config{Environment: "development", DatabaseURL: u.String()})
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = owner.Exec(ctx, "DROP DATABASE "+pgx.Identifier{db}.Sanitize()+" WITH (FORCE)")
		owner.Close(ctx)
	})
	if e = migrations.Apply(ctx, pool); e != nil {
		t.Fatal(e)
	}
	return pool, u.String()
}
func testService(t *testing.T) *Service {
	t.Helper()
	pool, _ := testPool(t)
	s, e := New(pool, []byte(strings.Repeat("K", 32)))
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func account(t *testing.T, s *Service, email string, admin bool) User {
	t.Helper()
	role, secret := "user", ""
	if admin {
		role = "admin"
		secret = fixtureTOTP
	}
	u, e := s.CreateAccount(context.Background(), email, "Synthetic user", fixturePassword, role, secret)
	if e != nil {
		t.Fatal(e)
	}
	return u
}
func login(t *testing.T, s *Service, u User) (Tokens, string) {
	t.Helper()
	ctx := context.Background()
	v := randomID()
	f, e := s.Start(ctx, StartInput{"Fixture desktop", Challenge(v), "S256", "http://127.0.0.1:40123/auth/callback"})
	if e != nil {
		t.Fatal(e)
	}
	_, nonce, e := s.BrowserFlow(ctx, f.ID)
	if e != nil {
		t.Fatal(e)
	}
	otp := ""
	if u.Role == "admin" {
		otp, _ = TOTP(fixtureTOTP, s.now().Unix()/30)
	}
	_, code, e := s.Approve(ctx, f.ID, nonce, u.Email, fixturePassword, otp)
	if e != nil {
		t.Fatal(e)
	}
	tokens, e := s.Exchange(ctx, f.ID, code, v)
	if e != nil {
		t.Fatal(e)
	}
	return tokens, code
}
func TestCryptoPasswordMFAAndCipher(t *testing.T) {
	h, e := passwordHash(fixturePassword)
	if e != nil || !passwordMatches(h, fixturePassword) || passwordMatches(h, "wrong") {
		t.Fatal("password hashing failed")
	}
	if passwordMatches("$argon2id$v=19$m=99999999,t=2,p=1$invalid$invalid", fixturePassword) {
		t.Fatal("unbounded hash accepted")
	}
	code, e := TOTP(fixtureTOTP, 1)
	if e != nil || code != "287082" {
		t.Fatal("RFC 6238 vector mismatch")
	}
	if _, ok := matchTOTP(fixtureTOTP, code, time.Unix(59, 0), 1); ok {
		t.Fatal("MFA replay accepted")
	}
	key := []byte(strings.Repeat("K", 32))
	body, e := encryptSecret(key, "account", fixtureTOTP)
	if e != nil {
		t.Fatal(e)
	}
	if strings.Contains(string(body), fixtureTOTP) {
		t.Fatal("plaintext MFA stored")
	}
	if _, e = decryptSecret(key, "another-account", body); e == nil {
		t.Fatal("cipher swapped to another account")
	}
}
func TestEnvironmentIsolation(t *testing.T) {
	t.Setenv("MATERIALSX_IDENTITY_MASTER_KEY", "S0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0s=")
	t.Setenv("MATERIALSX_DATABASE_URL", "postgres://fixture@127.0.0.1/test")
	t.Setenv("MATERIALSX_ENV", "production")
	t.Setenv("MATERIALSX_IDENTITY_PUBLIC_URL", "http://127.0.0.1:8788")
	if _, e := ConfigFromEnv(); e == nil {
		t.Fatal("production accepted HTTP")
	}
	t.Setenv("MATERIALSX_IDENTITY_PUBLIC_URL", "https://platform.example.invalid")
	t.Setenv("MATERIALSX_DEV_MODE", "1")
	if _, e := ConfigFromEnv(); e == nil {
		t.Fatal("production accepted dev routes")
	}
	t.Setenv("MATERIALSX_DEV_MODE", "")
	c, e := ConfigFromEnv()
	if e != nil {
		t.Fatal(e)
	}
	if _, e = OpenPool(context.Background(), c); e == nil {
		t.Fatal("production accepted unverified database transport")
	}
	t.Setenv("MATERIALSX_ENV", "development")
	t.Setenv("MATERIALSX_IDENTITY_ADDR", "0.0.0.0:8788")
	t.Setenv("MATERIALSX_IDENTITY_PUBLIC_URL", "http://127.0.0.1:8788")
	if _, e = ConfigFromEnv(); e == nil {
		t.Fatal("development identity exposed publicly")
	}
}
func TestPostgresPKCEExpiryAndTokenStorage(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	u := account(t, s, "user@example.invalid", false)
	if _, e := s.Start(ctx, StartInput{"desktop", "A", "plain", "https://evil.invalid"}); e == nil {
		t.Fatal("invalid callback accepted")
	}
	v := randomID()
	f, _ := s.Start(ctx, StartInput{"desktop", Challenge(v), "S256", "http://127.0.0.1:40123/auth/callback"})
	_, nonce, _ := s.BrowserFlow(ctx, f.ID)
	if _, _, e := s.Approve(ctx, f.ID, "wrong nonce", u.Email, fixturePassword, ""); !errors.Is(e, ErrUnauthenticated) {
		t.Fatal("nonce not checked")
	}
	_, code, e := s.Approve(ctx, f.ID, nonce, u.Email, fixturePassword, "")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Exchange(ctx, f.ID, code, randomID()); !errors.Is(e, ErrUnauthenticated) {
		t.Fatal("wrong verifier accepted")
	}
	tok, e := s.Exchange(ctx, f.ID, code, v)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Exchange(ctx, f.ID, code, v); !errors.Is(e, ErrUnauthenticated) {
		t.Fatal("code replay accepted")
	}
	p, e := s.Authenticate(ctx, tok.AccessToken)
	if e != nil || p.ID != u.ID {
		t.Fatal("principal not owned")
	}
	var hash string
	s.Pool.QueryRow(ctx, `SELECT token_hash FROM access_tokens LIMIT 1`).Scan(&hash)
	if hash == tok.AccessToken || hash != digest(tok.AccessToken) {
		t.Fatal("access token stored plaintext")
	}
	initial := s.now
	s.now = func() time.Time { return initial().Add(16 * time.Minute) }
	if _, e = s.Authenticate(ctx, tok.AccessToken); !errors.Is(e, ErrUnauthenticated) {
		t.Fatal("expired access accepted")
	}
	rotated, e := s.Refresh(ctx, tok.RefreshToken)
	if e != nil {
		t.Fatal("refresh expired access failed")
	}
	if _, e = s.Authenticate(ctx, rotated.AccessToken); e != nil {
		t.Fatal(e)
	}
}
func TestPostgresRefreshRotationAndConcurrentReplay(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	u := account(t, s, "refresh@example.invalid", false)
	tok, _ := login(t, s, u)
	var wg sync.WaitGroup
	results := make(chan Tokens, 2)
	rejected := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, e := s.Refresh(ctx, tok.RefreshToken)
			if e != nil {
				rejected <- e
			} else {
				results <- r
			}
		}()
	}
	wg.Wait()
	close(results)
	close(rejected)
	if len(results) != 1 || len(rejected) != 1 {
		t.Fatal("concurrent refresh not serialized")
	}
	fresh := <-results
	if _, e := s.Authenticate(ctx, fresh.AccessToken); !errors.Is(e, ErrUnauthenticated) {
		t.Fatal("refresh replay did not revoke entire session")
	}
	if _, e := s.Refresh(ctx, fresh.RefreshToken); !errors.Is(e, ErrUnauthenticated) {
		t.Fatal("rotated session survived replay")
	}
}
func TestPostgresDeviceOwnershipAndImmediateRevocation(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	a := account(t, s, "a@example.invalid", false)
	b := account(t, s, "b@example.invalid", false)
	ta, _ := login(t, s, a)
	tb, _ := login(t, s, b)
	pa, _ := s.Authenticate(ctx, ta.AccessToken)
	if e := s.Revoke(ctx, pa, tb.DeviceID); !errors.Is(e, ErrNotFound) {
		t.Fatal("other account device revoked")
	}
	if _, e := s.Authenticate(ctx, tb.AccessToken); e != nil {
		t.Fatal("other account touched")
	}
	if e := s.Revoke(ctx, pa, ta.DeviceID); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Authenticate(ctx, ta.AccessToken); !errors.Is(e, ErrUnauthenticated) {
		t.Fatal("revoked access accepted")
	}
	if _, e := s.Refresh(ctx, ta.RefreshToken); !errors.Is(e, ErrUnauthenticated) {
		t.Fatal("revoked refresh accepted")
	}
}
func TestPostgresAdminMFAStatusIdempotencyAndAudit(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	admin := account(t, s, "admin@example.invalid", true)
	u := account(t, s, "subject@example.invalid", false)
	userTokens, _ := login(t, s, u)
	userP, _ := s.Authenticate(ctx, userTokens.AccessToken)
	if _, e := s.Users(ctx, userP, "", 10); !errors.Is(e, ErrForbidden) {
		t.Fatal("user escalated to admin")
	}
	v := randomID()
	f, _ := s.Start(ctx, StartInput{"admin", Challenge(v), "S256", "http://127.0.0.1:40123/auth/callback"})
	_, nonce, _ := s.BrowserFlow(ctx, f.ID)
	if _, _, e := s.Approve(ctx, f.ID, nonce, admin.Email, fixturePassword, "000000"); !errors.Is(e, ErrUnauthenticated) {
		t.Fatal("admin without MFA approved")
	}
	adminTokens, _ := login(t, s, admin)
	p, e := s.Authenticate(ctx, adminTokens.AccessToken)
	if e != nil || !p.MFA {
		t.Fatal("MFA session not marked")
	}
	r, e := s.SetStatus(ctx, p, u.ID, "suspended", "Synthetic acceptance", "op-1", 1)
	if e != nil || r.Version != 2 {
		t.Fatal(e)
	}
	repeated, e := s.SetStatus(ctx, p, u.ID, "suspended", "Synthetic acceptance", "op-1", 1)
	if e != nil || repeated != r {
		t.Fatal("idempotency replay failed")
	}
	if _, e = s.SetStatus(ctx, p, u.ID, "active", "different", "op-1", 1); !errors.Is(e, ErrIdempotency) {
		t.Fatal("key conflict accepted")
	}
	if _, e = s.SetStatus(ctx, p, u.ID, "active", "stale", "op-2", 1); !errors.Is(e, ErrConflict) {
		t.Fatal("stale version accepted")
	}
	if _, e = s.Authenticate(ctx, userTokens.AccessToken); !errors.Is(e, ErrUnauthenticated) {
		t.Fatal("suspended account kept access")
	}
	if _, e = s.SetStatus(ctx, p, u.ID, "active", "Restore synthetic user", "op-3", 2); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Authenticate(ctx, userTokens.AccessToken); !errors.Is(e, ErrUnauthenticated) {
		t.Fatal("reactivation revived revoked token")
	}
	if _, e = s.Pool.Exec(ctx, `UPDATE audit_events SET reason='tampered'`); e == nil {
		t.Fatal("audit mutation allowed")
	}
	events, e := s.Audit(ctx, p, 0, 200)
	if e != nil || len(events) == 0 {
		t.Fatal("audit missing")
	}
	for _, a := range events {
		if strings.Contains(a.Reason, fixturePassword) || strings.Contains(a.Reason, adminTokens.AccessToken) {
			t.Fatal("audit contains credentials")
		}
	}
}
func TestPostgresMigrationsRoleAndBackupRestore(t *testing.T) {
	pool, dsn := testPool(t)
	ctx := context.Background()
	if e := migrations.Apply(ctx, pool); e != nil {
		t.Fatal("migration not idempotent")
	}
	if CheckRuntimeRole(ctx, pool) == nil {
		t.Fatal("owner passed production runtime check")
	}
	s, _ := New(pool, []byte(strings.Repeat("K", 32)))
	u := account(t, s, "restore@example.invalid", false)
	tok, _ := login(t, s, u)
	bin := os.Getenv("MATERIALSX_POSTGRES_BIN")
	if bin == "" {
		path, e := exec.LookPath("pg_dump")
		if e != nil {
			t.Fatal("backup validation requires pg_dump")
		}
		bin = filepath.Dir(path)
	}
	target := filepath.Join(t.TempDir(), "identity.dump")
	urlDSN, _ := url.Parse(dsn)
	cmd := exec.Command(filepath.Join(bin, "pg_dump"), "--format=custom", "--no-owner", "--file", target)
	password, _ := urlDSN.User.Password()
	cmd.Env = append(os.Environ(), "PGPASSWORD="+password, "PGHOST="+urlDSN.Hostname(), "PGPORT="+urlDSN.Port(), "PGUSER="+urlDSN.User.Username(), "PGDATABASE="+strings.TrimPrefix(urlDSN.Path, "/"))
	if _, e := cmd.CombinedOutput(); e != nil {
		t.Fatal("pg_dump failed")
	}
	restored, restoreDSN := testPool(t)
	restoreURL, _ := url.Parse(restoreDSN)
	// The restore target is disposable and empty except for migrations applied by setup.
	if _, e := restored.Exec(ctx, `DROP SCHEMA mx_identity CASCADE`); e != nil {
		t.Fatal(e)
	}
	cmd = exec.Command(filepath.Join(bin, "pg_restore"), "--exit-on-error", "--no-owner", "--dbname", strings.TrimPrefix(restoreURL.Path, "/"), target)
	cmd.Env = append(os.Environ(), "PGPASSWORD="+password, "PGHOST="+restoreURL.Hostname(), "PGPORT="+restoreURL.Port(), "PGUSER="+restoreURL.User.Username())
	if _, e := cmd.CombinedOutput(); e != nil {
		t.Fatal("pg_restore failed")
	}
	if e := migrations.Check(ctx, restored); e != nil {
		t.Fatal("restored migrations invalid")
	}
	r, _ := New(restored, []byte(strings.Repeat("K", 32)))
	p, e := r.Authenticate(ctx, tok.AccessToken)
	if e != nil || p.ID != u.ID {
		t.Fatal("restored identity missing")
	}
	if _, e = r.Refresh(ctx, tok.RefreshToken); e != nil {
		t.Fatal("restored refresh failed")
	}
	if e = InvalidateSessions(ctx, restored); e != nil {
		t.Fatal(e)
	}
	if _, e = r.Authenticate(ctx, tok.AccessToken); !errors.Is(e, ErrUnauthenticated) {
		t.Fatal("restored sessions survive recovery")
	}
	if _, e = r.Refresh(ctx, tok.RefreshToken); !errors.Is(e, ErrUnauthenticated) {
		t.Fatal("restored refresh survives recovery")
	}
}

func TestPostgresRestrictedRuntimeRole(t *testing.T) {
	pool, dsn := testPool(t)
	ctx := context.Background()
	owner, _ := New(pool, []byte(strings.Repeat("K", 32)))
	u := account(t, owner, "runtime@example.invalid", false)
	role := "mx_runtime_" + strings.ReplaceAll(strings.ReplaceAll(strings.ToLower(randomID()[:12]), "-", "a"), "_", "b")
	if _, e := pool.Exec(ctx, `CREATE ROLE `+pgx.Identifier{role}.Sanitize()+` LOGIN PASSWORD 'synthetic-runtime-test-only'`); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DROP OWNED BY `+pgx.Identifier{role}.Sanitize())
		pool.Exec(ctx, `DROP ROLE `+pgx.Identifier{role}.Sanitize())
	})
	if e := GrantRuntime(ctx, pool, role); e != nil {
		t.Fatal(e)
	}
	parsed, _ := url.Parse(dsn)
	parsed.User = url.UserPassword(role, "synthetic-runtime-test-only")
	runtime, e := OpenPool(ctx, Config{Environment: "development", DatabaseURL: parsed.String()})
	if e != nil {
		t.Fatal(e)
	}
	defer runtime.Close()
	if e = CheckRuntimeRole(ctx, runtime); e != nil {
		t.Fatal(e)
	}
	if e = migrations.Check(ctx, runtime); e != nil {
		t.Fatal(e)
	}
	service, _ := New(runtime, []byte(strings.Repeat("K", 32)))
	tok, _ := login(t, service, u)
	if _, e = service.Authenticate(ctx, tok.AccessToken); e != nil {
		t.Fatal(e)
	}
	if _, e = service.Refresh(ctx, tok.RefreshToken); e != nil {
		t.Fatal(e)
	}
	var deployJob string
	if e = runtime.QueryRow(ctx, `INSERT INTO mx_model_deploy_jobs(actor_id,idempotency_key,expected_revision,snapshot)
	 VALUES($1,'runtime-grant-probe',repeat('a',64),'{}'::jsonb) RETURNING id::text`, u.ID).Scan(&deployJob); e != nil {
		t.Fatalf("runtime cannot enqueue deployment: %v", e)
	}
	if _, e = runtime.Exec(ctx, `UPDATE mx_model_deploy_jobs SET state='running',started_at=clock_timestamp() WHERE id=$1`, deployJob); e != nil {
		t.Fatalf("runtime cannot claim deployment: %v", e)
	}
	if _, e = runtime.Exec(ctx, `UPDATE mx_model_deploy_jobs SET state='failed',receipt='{"reason":"test"}'::jsonb,finished_at=clock_timestamp() WHERE id=$1`, deployJob); e != nil {
		t.Fatalf("runtime cannot write deployment receipt: %v", e)
	}
	for _, sql := range []string{`UPDATE accounts SET role='admin'`, `DELETE FROM audit_events`, `CREATE TABLE forbidden(id text)`, `UPDATE sales_price_versions SET body='{}'`, `UPDATE mx_retail_price_versions SET status='approved'`, `UPDATE mx_model_deploy_jobs SET snapshot='{}'::jsonb`, `DELETE FROM mx_point_ledger`, `UPDATE credit_grants SET credits=1`, `UPDATE research_tasks SET max_credits=1`, `UPDATE credit_reservations SET reserved=1`, `UPDATE reservation_allocations SET credits=1`, `DELETE FROM credit_ledger`, `INSERT INTO credit_limits(account_id,daily_limit,monthly_limit) SELECT id,1,1 FROM accounts LIMIT 1`} {
		if _, e = runtime.Exec(ctx, sql); e == nil {
			t.Fatal("runtime can mutate restricted object")
		}
	}
	if e = InvalidateSessions(ctx, pool); e != nil {
		t.Fatal(e)
	}
	if _, e = service.Authenticate(ctx, tok.AccessToken); !errors.Is(e, ErrUnauthenticated) {
		t.Fatal("recovery did not revoke")
	}
}

func TestPostgresExpiryAndAdminRecovery(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	admin := account(t, s, "admin-recovery@example.invalid", true)
	if _, e := s.CreateAccount(ctx, "second-admin@example.invalid", "Second", fixturePassword, "admin", fixtureTOTP); !errors.Is(e, ErrConflict) {
		t.Fatal("second administrator allowed")
	}
	tok, _ := login(t, s, admin)
	initial := s.now
	s.now = func() time.Time { return initial().Add(13 * time.Hour) }
	if _, e := s.Authenticate(ctx, tok.AccessToken); !errors.Is(e, ErrUnauthenticated) {
		t.Fatal("expired admin token accepted")
	}
	if _, e := s.Refresh(ctx, tok.RefreshToken); !errors.Is(e, ErrUnauthenticated) {
		t.Fatal("admin refresh extends absolute MFA expiry")
	}
	s.now = initial
	const newSecret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
	if e := s.ResetAdmin(ctx, admin.Email, "new-synthetic-fixture-password", newSecret); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Authenticate(ctx, tok.AccessToken); !errors.Is(e, ErrUnauthenticated) {
		t.Fatal("admin recovery did not revoke old session")
	}
	v := randomID()
	f, _ := s.Start(ctx, StartInput{"Recovery", Challenge(v), "S256", "http://127.0.0.1:40123/auth/callback"})
	_, nonce, _ := s.BrowserFlow(ctx, f.ID)
	otp, _ := TOTP(newSecret, s.now().Unix()/30)
	if _, _, e := s.Approve(ctx, f.ID, nonce, admin.Email, fixturePassword, otp); !errors.Is(e, ErrUnauthenticated) {
		t.Fatal("old password accepted after recovery")
	}
	_, code, e := s.Approve(ctx, f.ID, nonce, admin.Email, "new-synthetic-fixture-password", otp)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Exchange(ctx, f.ID, code, v); e != nil {
		t.Fatal(e)
	}
	// The same TOTP step cannot authorize a second admin session.
	f, _ = s.Start(ctx, StartInput{"Replay", Challenge(v), "S256", "http://127.0.0.1:40123/auth/callback"})
	_, nonce, _ = s.BrowserFlow(ctx, f.ID)
	if _, _, e = s.Approve(ctx, f.ID, nonce, admin.Email, "new-synthetic-fixture-password", otp); !errors.Is(e, ErrUnauthenticated) {
		t.Fatal("MFA code replay accepted")
	}
	s.now = func() time.Time { return initial().Add(6 * time.Minute) }
	if _, _, e = s.BrowserFlow(ctx, f.ID); !errors.Is(e, ErrNotFound) {
		t.Fatal("expired authorization flow accepted")
	}
}

func TestLocalTOTPConfiguration(t *testing.T) {
	t.Setenv("MATERIALSX_IDENTITY_MASTER_KEY", "S0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0s=")
	t.Setenv("MATERIALSX_DATABASE_URL", "postgres://fixture@127.0.0.1/test")
	t.Setenv("MATERIALSX_ENV", "development")
	t.Setenv("MATERIALSX_IDENTITY_ADDR", "127.0.0.1:8788")
	t.Setenv("MATERIALSX_IDENTITY_PUBLIC_URL", "http://127.0.0.1:8788")
	t.Setenv("MATERIALSX_LOCAL_DISABLE_ADMIN_TOTP", "1")
	c, e := ConfigFromEnv()
	if e != nil || !c.DisableAdminTOTP {
		t.Fatal("local password-only configuration rejected", e)
	}
	t.Setenv("MATERIALSX_ENV", "production")
	t.Setenv("MATERIALSX_IDENTITY_PUBLIC_URL", "https://platform.example.invalid")
	if _, e = ConfigFromEnv(); e == nil {
		t.Fatal("production accepted TOTP bypass")
	}
}

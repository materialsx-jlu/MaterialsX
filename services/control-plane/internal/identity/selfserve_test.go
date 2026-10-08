package identity

import (
	"context"
	"encoding/json"
	"github.com/jamip/materialsx/control-plane/internal/delivery"
	"strings"
	"testing"
)

func emailToken(t *testing.T, s *Service) string {
	t.Helper()
	var id string
	var cipher []byte
	if e := s.Pool.QueryRow(context.Background(), `SELECT id,payload FROM notification_outbox ORDER BY created_at DESC LIMIT 1`).Scan(&id, &cipher); e != nil {
		t.Fatal(e)
	}
	raw, e := delivery.Open(s.key, id, cipher)
	if e != nil {
		t.Fatal(e)
	}
	var m delivery.Message
	if json.Unmarshal(raw, &m) != nil {
		t.Fatal("message")
	}
	start := strings.Index(m.Text, "&token=")
	if start < 0 {
		t.Fatal("token missing")
	}
	return strings.Split(m.Text[start+7:], "\n")[0]
}
func TestEmailRegistrationResetSingleUseAndAdminProtection(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	if e := s.RequestEmail(ctx, "register", "new@example.test", "New user", fixturePassword, "approved-fixture-v1", "http://localhost"); e != nil {
		t.Fatal(e)
	}
	token := emailToken(t, s)
	if e := s.ConsumeEmail(ctx, token, ""); e != nil {
		t.Fatal(e)
	}
	if e := s.ConsumeEmail(ctx, token, ""); e == nil {
		t.Fatal("token replay")
	}
	var u User
	if e := s.Pool.QueryRow(ctx, `SELECT id,email,display_name,role,status,version FROM accounts WHERE email='new@example.test'`).Scan(&u.ID, &u.Email, &u.DisplayName, &u.Role, &u.Status, &u.Version); e != nil {
		t.Fatal(e)
	}
	if u.Role != "user" {
		t.Fatal("role")
	}
	tokens, _ := login(t, s, u)
	if e := s.RequestEmail(ctx, "reset", u.Email, "", "", "", "http://localhost"); e != nil {
		t.Fatal(e)
	}
	token = emailToken(t, s)
	if e := s.ConsumeEmail(ctx, token, "new-synthetic-password-only"); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Authenticate(ctx, tokens.AccessToken); e == nil {
		t.Fatal("reset left old session alive")
	}
	admin := account(t, s, "admin@example.test", true)
	var before, after int
	s.Pool.QueryRow(ctx, `SELECT count(*) FROM notification_outbox`).Scan(&before)
	if e := s.RequestEmail(ctx, "reset", admin.Email, "", "", "", "http://localhost"); e != nil {
		t.Fatal(e)
	}
	s.Pool.QueryRow(ctx, `SELECT count(*) FROM notification_outbox`).Scan(&after)
	if before != after {
		t.Fatal("admin browser reset allowed")
	}
}
func TestExpiredEmailAndApprovalGates(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	s.RequestEmail(ctx, "register", "expire@example.test", "New", fixturePassword, "v1", "http://localhost")
	token := emailToken(t, s)
	s.Pool.Exec(ctx, `UPDATE email_challenges SET expires_at=clock_timestamp()-interval '1 second'`)
	if e := s.ConsumeEmail(ctx, token, ""); e == nil {
		t.Fatal("expired token accepted")
	}
	h := NewHTTP(s, "http://localhost", false)
	if h.ConfigureEmail(EmailOptions{Enabled: true, Signup: true, TermsVersion: "v1", TermsURL: "http://untrusted.example"}) == nil {
		t.Fatal("non-HTTPS terms")
	}
}

func TestConcurrentEmailLinksHaveOnlyOneWinner(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	if e := s.RequestEmail(ctx, "register", "race@example.test", "Race", fixturePassword, "v1", "http://localhost"); e != nil {
		t.Fatal(e)
	}
	first := emailToken(t, s)
	if e := s.RequestEmail(ctx, "register", "race@example.test", "Race", fixturePassword, "v1", "http://localhost"); e != nil {
		t.Fatal(e)
	}
	second := emailToken(t, s)
	results := make(chan error, 2)
	go func() { results <- s.ConsumeEmail(ctx, first, "") }()
	go func() { results <- s.ConsumeEmail(ctx, second, "") }()
	wins := 0
	for i := 0; i < 2; i++ {
		if <-results == nil {
			wins++
		}
	}
	if wins != 1 {
		t.Fatal("verification winners", wins)
	}
	var n int
	if e := s.Pool.QueryRow(ctx, `SELECT count(*) FROM accounts WHERE email='race@example.test'`).Scan(&n); e != nil || n != 1 {
		t.Fatal(n, e)
	}
}

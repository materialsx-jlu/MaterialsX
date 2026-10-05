package gateway

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/migrations"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type fixtureProvider struct {
	calls   atomic.Int32
	kind    string
	started chan struct{}
	payload map[string]any
}

func (p *fixtureProvider) Open(ctx context.Context, in map[string]any) (*http.Response, error) {
	p.calls.Add(1)
	p.payload = in
	if p.started != nil {
		close(p.started)
	}
	if p.kind == "wait" {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	if p.kind == "error" {
		return &http.Response{StatusCode: 503, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"error":"upstream-secret-fixture"}`))}, nil
	}
	body := `data: {"type":"response.output_text.delta","delta":"硅是14"}` + "\n\n"
	if p.kind != "interrupted" {
		usage := `{"input_tokens":10,"output_tokens":4,"input_tokens_details":{"cached_tokens":2},"output_tokens_details":{"reasoning_tokens":1}}`
		if p.kind == "too-output" {
			usage = `{"input_tokens":10,"output_tokens":1000}`
		}
		if p.kind == "missing-usage" {
			usage = "null"
		}
		if p.kind == "invalid-usage" {
			usage = `{"input_tokens":1,"output_tokens":2,"input_tokens_details":{"cached_tokens":4}}`
		}
		body += `data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message"}],"usage":` + usage + `}}` + "\n\n"
	}
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
}
func poolFixture(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("MATERIALSX_IDENTITY_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires isolated test PostgreSQL")
	}
	u, e := url.Parse(dsn)
	if e != nil || !strings.Contains(u.Path, "test") {
		t.Fatal("test DSN required")
	}
	ctx := context.Background()
	owner, e := pgx.Connect(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	db := "mx_gateway_test_" + strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(newID()[:10], "-", "a"), "_", "b"))
	if _, e = owner.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{db}.Sanitize()); e != nil {
		t.Fatal(e)
	}
	u.Path = "/" + db
	pool, e := identity.OpenPool(ctx, identity.Config{Environment: "development", DatabaseURL: u.String()})
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		pool.Close()
		owner.Exec(ctx, "DROP DATABASE "+pgx.Identifier{db}.Sanitize()+" WITH (FORCE)")
		owner.Close(ctx)
	})
	if e = migrations.Apply(ctx, pool); e != nil {
		t.Fatal(e)
	}
	return pool
}
func principal(t *testing.T, s *identity.Service) (identity.Principal, string) {
	t.Helper()
	ctx := context.Background()
	u, e := s.CreateAccount(ctx, newID()+"@example.invalid", "Gateway fixture", "fixture-password-only", "user", "")
	if e != nil {
		t.Fatal(e)
	}
	verifier := newID()
	f, e := s.Start(ctx, identity.StartInput{DeviceName: "Fixture", Challenge: identity.Challenge(verifier), Method: "S256", Redirect: "http://127.0.0.1:40123/auth/callback"})
	if e != nil {
		t.Fatal(e)
	}
	_, nonce, e := s.BrowserFlow(ctx, f.ID)
	if e != nil {
		t.Fatal(e)
	}
	_, code, e := s.Approve(ctx, f.ID, nonce, u.Email, "fixture-password-only", "")
	if e != nil {
		t.Fatal(e)
	}
	tokens, e := s.Exchange(ctx, f.ID, code, verifier)
	if e != nil {
		t.Fatal(e)
	}
	p, e := s.Authenticate(ctx, tokens.AccessToken)
	if e != nil {
		t.Fatal(e)
	}
	return p, tokens.AccessToken
}
func taskInput() CreateTask {
	return CreateTask{newID(), ModelAlias, "alpha-test", Limits{MaxRequests: 2, MaxOutput: 256, MaxDuration: 30}, Consent{ConsentVersion, true, "platform-only", 1, 0}}
}
func native() map[string]any {
	return map[string]any{"model": ModelAlias, "stream": true, "max_output_tokens": float64(256), "input": "Synthetic silicon only"}
}
func TestValidationAndFrameBoundaries(t *testing.T) {
	for _, edit := range []func(map[string]any){func(p map[string]any) { p["model"] = "gpt-5.6" }, func(p map[string]any) { p["base_url"] = "https://foreign.invalid" }, func(p map[string]any) { p["max_output_tokens"] = float64(9000) }, func(p map[string]any) { p["tools"] = []any{map[string]any{"type": "web_search"}} }, func(p map[string]any) {
		p["input"] = []any{map[string]any{"role": "user", "content": []any{map[string]any{"type": "input_image", "image_url": "file:///private"}}}}
	}} {
		p := native()
		edit(p)
		if ValidateNative(p, 1024) == nil {
			t.Fatal("unsafe payload admitted")
		}
	}
	ch := make(chan frame, 4)
	go frames(context.Background(), strings.NewReader("event: test\r\ndata: {\"type\":\r\ndata: \"中文\"}\r\n\r\n"), ch)
	f := <-ch
	var parsed map[string]any
	if json.Unmarshal(f.Data, &parsed) != nil || parsed["type"] != "中文" {
		t.Fatal("multiline/UTF8 framing")
	}
	_, _, _, e := terminal([]byte(`{"type":"response.completed","response":{"status":"completed","output":[{}],"usage":{"input_tokens":1,"output_tokens":2,"input_tokens_details":{"cached_tokens":4}}}}`))
	if e == nil {
		t.Fatal("invalid usage accepted")
	}
	ch = make(chan frame, 2)
	go frames(context.Background(), strings.NewReader("data: "+strings.Repeat("x", 256*1024)+"\n\n"), ch)
	if (<-ch).Err == nil {
		t.Fatal("unbounded frame")
	}
}
func TestGatewayPostgres(t *testing.T) {
	pool := poolFixture(t)
	ctx := context.Background()
	ident, e := identity.New(pool, []byte(strings.Repeat("G", 32)))
	if e != nil {
		t.Fatal(e)
	}
	cfg := Config{Enabled: true, MaxRequests: 6, MaxOutputTokens: 1024, MaxDurationSeconds: 180, MaxConcurrent: 8}
	store := &Store{pool, cfg}
	fresh := func() (identity.Principal, string, Task) {
		p, token := principal(t, ident)
		if e = store.Grant(ctx, p.ID, 20, time.Now().Add(time.Hour)); e != nil {
			t.Fatal(e)
		}
		in := taskInput()
		task, e := store.Create(ctx, p, in, newID())
		if e != nil {
			t.Fatal(e)
		}
		return p, token, task
	}

	t.Run("runtime role can consume but cannot expand alpha grants", func(t *testing.T) {
		p, _, _ := fresh()
		role := "mx_gw_runtime_" + strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(newID()[:8], "-", "a"), "_", "b"))
		roleSQL := pgx.Identifier{role}.Sanitize()
		if _, e := pool.Exec(ctx, "CREATE ROLE "+roleSQL); e != nil {
			t.Fatal(e)
		}
		defer func() { pool.Exec(ctx, "DROP OWNED BY "+roleSQL); pool.Exec(ctx, "DROP ROLE "+roleSQL) }()
		if e := identity.GrantRuntime(ctx, pool, role); e != nil {
			t.Fatal(e)
		}
		c, e := pool.Acquire(ctx)
		if e != nil {
			t.Fatal(e)
		}
		defer c.Release()
		if _, e = c.Exec(ctx, "SET ROLE "+roleSQL); e != nil {
			t.Fatal(e)
		}
		defer c.Exec(ctx, "RESET ROLE")
		if _, e = c.Exec(ctx, `UPDATE cloud_access SET request_count=request_count+1 WHERE account_id=$1`, p.ID); e != nil {
			t.Fatal(e)
		}
		if _, e = c.Exec(ctx, `UPDATE cloud_access SET request_limit=10000 WHERE account_id=$1`, p.ID); e == nil {
			t.Fatal("runtime expanded grant")
		}
		if _, e = c.Exec(ctx, `INSERT INTO cloud_access(account_id,request_limit,expires_at) VALUES($1,10000,clock_timestamp()+interval '1 day')`, p.ID); e == nil {
			t.Fatal("runtime created grant")
		}
	})
	t.Run("ownership idempotency and quota", func(t *testing.T) {
		p, _, task := fresh()
		other, _, _ := fresh()
		if _, e = store.Task(ctx, other.ID, task.ID); e != ErrNotFound {
			t.Fatal("task disclosure")
		}
		in := taskInput()
		key := newID()
		one, e := store.Create(ctx, p, in, key)
		if e != nil {
			t.Fatal(e)
		}
		two, e := store.Create(ctx, p, in, key)
		if e != nil || one.ID != two.ID {
			t.Fatal("task replay")
		}
		in.Budget.MaxRequests++
		if _, e = store.Create(ctx, p, in, key); e != ErrIdempotency {
			t.Fatal("changed replay")
		}
		id := newID()
		if _, _, e = store.Claim(ctx, p, task.ID, id, id, native()); e != nil {
			t.Fatal(e)
		}
		if _, _, e = store.Claim(ctx, p, task.ID, id, id, native()); e != ErrConflict {
			t.Fatal("generation replay")
		}
		if _, _, e = store.Claim(ctx, p, one.ID, id, id, native()); e != ErrIdempotency {
			t.Fatal("task swapping")
		}
		if _, e = store.Request(ctx, other.ID, id); e != ErrNotFound {
			t.Fatal("usage disclosure")
		}
		if e = store.Finish(ctx, id, "unknown", "STREAM_INTERRUPTED", 0, false, nil); e != nil {
			t.Fatal(e)
		}
		if _, _, e = store.Claim(ctx, p, task.ID, newID(), newID(), native()); e != ErrConflict {
			t.Fatal("uncertain task retried")
		}
		if _, e = store.EndTask(ctx, p.ID, task.ID, "completed"); e != ErrConflict {
			t.Fatal("fake completion")
		}
		pool.Exec(ctx, `UPDATE cloud_access SET request_limit=request_count WHERE account_id=$1`, p.ID)
		if _, e = store.Create(ctx, p, taskInput(), newID()); e != ErrForbidden {
			t.Fatal("quota bypass")
		}
	})
	t.Run("one active request under concurrency", func(t *testing.T) {
		p, _, task := fresh()
		var wg sync.WaitGroup
		var admitted atomic.Int32
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				id := newID()
				if _, _, err := store.Claim(ctx, p, task.ID, id, id, native()); err == nil {
					admitted.Add(1)
				}
			}()
		}
		wg.Wait()
		if admitted.Load() != 1 {
			t.Fatal("multiple concurrent claims")
		}
		pool.Exec(ctx, `UPDATE gateway_requests SET execution='unknown' WHERE account_id=$1`, p.ID)
	})
	t.Run("restart lease and task cancellation", func(t *testing.T) {
		p, _, task := fresh()
		id := newID()
		store.Claim(ctx, p, task.ID, id, id, native())
		pool.Exec(ctx, `UPDATE gateway_requests SET deadline=clock_timestamp()-interval '1 second' WHERE id=$1`, id)
		r, e := store.Request(ctx, p.ID, id)
		if e != nil || r.Execution != "unknown" || r.Usage != nil {
			t.Fatal("restart did not preserve uncertainty")
		}
		store.CancelTask(ctx, p.ID, task.ID)
		if _, _, e = store.Claim(ctx, p, task.ID, newID(), newID(), native()); e == nil {
			t.Fatal("cancelled task admitted")
		}
	})
	t.Run("HTTP streaming and redacted errors", func(t *testing.T) {
		for _, kind := range []string{"normal", "missing-usage", "invalid-usage", "interrupted", "error", "too-output"} {
			t.Run(kind, func(t *testing.T) {
				p, token, task := fresh()
				provider := &fixtureProvider{kind: kind}
				local := &Store{pool, cfg}
				local.Config.Provider = provider
				server := httptest.NewUnstartedServer(nil)
				parent := identity.NewHTTP(ident, "http://"+server.Listener.Addr().String(), false)
				Mount(parent, local)
				server.Config.Handler = parent
				server.Start()
				defer server.Close()
				id := newID()
				body, _ := json.Marshal(native())
				request, _ := http.NewRequest("POST", server.URL+"/v1/model-gateway/responses", strings.NewReader(string(body)))
				request.Header.Set("Authorization", "Bearer "+token)
				request.Header.Set("Content-Type", "application/json")
				request.Header.Set("X-Materialsx-Task-Id", task.ID)
				request.Header.Set("X-Materialsx-Request-Id", id)
				request.Header.Set("Idempotency-Key", id)
				response, e := server.Client().Do(request)
				if e != nil {
					t.Fatal(e)
				}
				b, e := io.ReadAll(response.Body)
				response.Body.Close()
				if e != nil {
					t.Fatal(e)
				}
				if strings.Contains(string(b), "upstream-secret-fixture") || provider.payload["model"] != "gpt-5.6-sol" {
					t.Fatal("redaction/route failure")
				}
				r, e := local.Request(ctx, p.ID, id)
				if e != nil {
					t.Fatal(e)
				}
				if kind == "normal" {
					if r.Execution != "completed" || r.Settlement != "not_billed" || r.Usage == nil || *r.Usage.Uncached != 8 || !strings.Contains(string(b), "硅是14") {
						t.Fatal("stream/usage lost")
					}
					if _, e = local.EndTask(ctx, p.ID, task.ID, "completed"); e != nil {
						t.Fatal(e)
					}
				}
				if kind == "missing-usage" && (r.Execution != "completed" || r.Settlement != "reconciliation_pending" || r.Usage.Input != nil) {
					t.Fatal("unknown usage became zero")
				}
				if (kind == "interrupted" || kind == "invalid-usage") && (r.Execution != "unknown" || r.Terminal) {
					t.Fatal("missing/invalid terminal treated as complete")
				}
				if kind == "too-output" && (r.Execution != "failed" || r.Usage == nil || *r.Usage.Output != 1000 || r.Error == nil || *r.Error != "TASK_BUDGET_EXCEEDED") {
					t.Fatal("provider output overrun was not recorded")
				}
				if kind == "error" && r.Execution != "failed" {
					t.Fatal("upstream rejection not stored")
				}
				// Replay of the POST never dispatches a second supplier request.
				request, _ = http.NewRequest("POST", server.URL+"/v1/model-gateway/responses", strings.NewReader(string(body)))
				request.Header.Set("Authorization", "Bearer "+token)
				request.Header.Set("Content-Type", "application/json")
				request.Header.Set("X-Materialsx-Task-Id", task.ID)
				request.Header.Set("X-Materialsx-Request-Id", id)
				request.Header.Set("Idempotency-Key", id)
				again, _ := server.Client().Do(request)
				if again.StatusCode != 409 {
					t.Fatal("replay was admitted")
				}
				again.Body.Close()
				if provider.calls.Load() != 1 {
					t.Fatal("supplier billed twice")
				}
			})
		}
	})
	t.Run("cancel and revocation during opening", func(t *testing.T) {
		for _, kind := range []string{"cancel", "revoke", "disconnect"} {
			t.Run(kind, func(t *testing.T) {
				p, token, task := fresh()
				provider := &fixtureProvider{kind: "wait", started: make(chan struct{})}
				local := &Store{pool, cfg}
				local.Config.Provider = provider
				server := httptest.NewUnstartedServer(nil)
				parent := identity.NewHTTP(ident, "http://"+server.Listener.Addr().String(), false)
				Mount(parent, local)
				server.Config.Handler = parent
				server.Start()
				defer server.Close()
				id := newID()
				body, _ := json.Marshal(native())
				callctx, stop := context.WithCancel(ctx)
				defer stop()
				request, _ := http.NewRequestWithContext(callctx, "POST", server.URL+"/v1/model-gateway/responses", strings.NewReader(string(body)))
				request.Header.Set("Authorization", "Bearer "+token)
				request.Header.Set("Content-Type", "application/json")
				request.Header.Set("X-Materialsx-Task-Id", task.ID)
				request.Header.Set("X-Materialsx-Request-Id", id)
				request.Header.Set("Idempotency-Key", id)
				done := make(chan struct{})
				go func() {
					defer close(done)
					v, _ := server.Client().Do(request)
					if v != nil {
						v.Body.Close()
					}
				}()
				select {
				case <-provider.started:
				case <-time.After(3 * time.Second):
					t.Fatal("provider did not start")
				}
				switch kind {
				case "cancel":
					local.CancelTask(ctx, p.ID, task.ID)
				case "revoke":
					pool.Exec(ctx, `UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1`, p.SessionID)
				case "disconnect":
					stop()
				}
				select {
				case <-done:
				case <-time.After(4 * time.Second):
					t.Fatal("not stopped")
				}
				for i := 0; i < 30; i++ {
					r, _ := local.Request(ctx, p.ID, id)
					if r.Execution == "unknown" && r.Settlement == "reconciliation_pending" {
						return
					}
					time.Sleep(20 * time.Millisecond)
				}
				t.Fatal("lost interruption record")
			})
		}
	})

}

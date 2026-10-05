// Test harness only. Production startup cannot load this package or its synthetic provider.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/gateway"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"github.com/jamip/materialsx/control-plane/internal/payments"
	"github.com/jamip/materialsx/control-plane/migrations"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func main() {
	if e := run(); e != nil {
		log.Print("isolated payment fixture failed")
		os.Exit(1)
	}
}
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	dsn := os.Getenv("MATERIALSX_IDENTITY_TEST_DATABASE_URL")
	u, e := url.Parse(dsn)
	if e != nil || !strings.Contains(u.Path, "test") {
		return payments.ErrDisabled
	}
	owner, e := pgx.Connect(ctx, dsn)
	if e != nil {
		return e
	}
	defer owner.Close(context.Background())
	var random [12]byte
	_, e = rand.Read(random[:])
	if e != nil {
		return e
	}
	db := "mx_payment_fixture_" + hex.EncodeToString(random[:])
	if _, e = owner.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{db}.Sanitize()); e != nil {
		return e
	}
	defer owner.Exec(context.Background(), "DROP DATABASE "+pgx.Identifier{db}.Sanitize()+" WITH (FORCE)")
	u.Path = "/" + db
	pool, e := identity.OpenPool(ctx, identity.Config{Environment: "development", DatabaseURL: u.String()})
	if e != nil {
		return e
	}
	defer pool.Close()
	if e = migrations.Apply(ctx, pool); e != nil {
		return e
	}
	key := make([]byte, 32)
	if _, e = rand.Read(key); e != nil {
		return e
	}
	ident, e := identity.New(pool, key)
	if e != nil {
		return e
	}

	password := "synthetic-" + hex.EncodeToString(random[:])
	email := "payment-fixture@example.invalid"
	adminEmail := "admin-payment-fixture@example.invalid"
	secret := "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
	if _, e = ident.CreateAccount(ctx, email, "Payment fixture", password, "user", ""); e != nil {
		return e
	}
	if _, e = ident.CreateAccount(ctx, adminEmail, "Administrator fixture", password, "admin", secret); e != nil {
		return e
	}
	tx, e := pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	for _, kind := range []string{"pack", "subscription"} {
		name := "测试积分包"
		if kind == "subscription" {
			name = "测试月度订阅"
		}
		p := payments.Product{ID: "test-" + kind, Name: name, Kind: kind, Currency: "CNY", PriceFen: "100", Credits: "1000", ValidDays: 30, RefundPolicyVersion: "test-policy-v1", RefundRule: "unused-proportional-v1", TestOnly: true, DailyLimit: "1000000", MonthlyLimit: "1000000", RequestLimit: 1000}
		if os.Getenv("MATERIALSX_WORKSPACE_FIXTURE") == "1" {
			p.Credits = "100000"
		}
		if e = payments.PutProduct(ctx, tx, p); e != nil {
			return e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return e
	}
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		return e
	}
	origin := "http://" + listener.Addr().String()
	parent := identity.NewHTTP(ident, origin, false)
	pay := &payments.Store{Pool: pool, Mode: "test", Merchant: "synthetic-merchant", AppID: "synthetic-app", Provider: payments.NewTestProvider("synthetic-merchant", "synthetic-app")}
	config := gateway.Config{MaxRequests: 6, MaxOutputTokens: 256, MaxDurationSeconds: 180, MaxConcurrent: 8}
	if os.Getenv("MATERIALSX_WORKSPACE_FIXTURE") == "1" {
		config.Enabled = true
		config.SalesPriceVersion = "test-sales-v1"
		config.Provider = workspaceProvider{}
		tx, err := pool.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx)
		price := metering.Price{ID: "test-sales-v1", Model: gateway.ModelAlias, Route: gateway.RouteVersion, TestOnly: true, Unit: "test-credit", Tiers: []metering.Tier{{MinInput: 0, Input: "1000000", Cached: "1000000", Output: "1000000"}}, MaxInput: 100000, InputPolicy: "utf8-byte-test-estimate-v1", Evidence: "synthetic-workspace-fixture"}
		if e = metering.PutPrice(ctx, tx, price); e != nil {
			return e
		}
		if e = tx.Commit(ctx); e != nil {
			return e
		}
	}
	workspace := gateway.Mount(parent, &gateway.Store{Pool: pool, Config: config})
	gateway.MountPayments(workspace, pay)
	workspace.ConfigureLifecycle(key, "")
	if os.Getenv("MATERIALSX_WORKSPACE_FIXTURE") == "1" {
		dir, e := filepath.Abs("../../dist/apps/admin")
		if e != nil {
			return e
		}
		if e = workspace.ConfigureWorkspace(dir, ""); e != nil {
			return e
		}
		defer workspace.AdminAssets.Close()
	}
	server := &http.Server{Handler: parent, ReadHeaderTimeout: 5 * time.Second}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }() // Private pipe to the harness, never inherited into terminal output or saved.
	if e = json.NewEncoder(os.Stdout).Encode(map[string]any{"ready": true, "origin": origin, "email": email, "password": password, "adminEmail": adminEmail, "totpSecret": secret}); e != nil {
		return e
	}
	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			shutdown, c := context.WithTimeout(context.Background(), 5*time.Second)
			defer c()
			return server.Shutdown(shutdown)
		case e := <-done:
			return e
		case <-ticker.C:
			call, c := context.WithTimeout(ctx, 5*time.Second)
			_, e = pay.Tick(call, 10)
			c()
			if e != nil {
				return e
			}
		}
	}
}

// Synthetic SSE only, used by M5.5 UI acceptance. No network or real model invocation.
type workspaceProvider struct{}

func (workspaceProvider) Open(_ context.Context, _ map[string]any) (*http.Response, error) {
	text := "硅的原子序数是 14。"
	item := map[string]any{"id": "msg_test", "type": "message", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": text, "annotations": []any{}}}}
	response := map[string]any{"id": "resp_test", "model": "gpt-5.6-sol", "status": "completed", "output": []any{item}, "usage": map[string]any{"input_tokens": 10, "output_tokens": 4, "input_tokens_details": map[string]any{"cached_tokens": 2}, "output_tokens_details": map[string]any{"reasoning_tokens": 1}}}
	first := map[string]any{"id": "resp_test", "model": "gpt-5.6-sol", "status": "in_progress", "output": []any{}, "usage": nil}
	added := map[string]any{"id": "msg_test", "type": "message", "role": "assistant", "status": "in_progress", "content": []any{}}
	events := []any{map[string]any{"type": "response.created", "response": first}, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": added}, map[string]any{"type": "response.content_part.added", "output_index": 0, "content_index": 0, "part": map[string]any{"type": "output_text", "text": "", "annotations": []any{}}}, map[string]any{"type": "response.output_text.delta", "output_index": 0, "content_index": 0, "delta": text}, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item}, map[string]any{"type": "response.completed", "response": response}}
	var body strings.Builder
	for _, event := range events {
		b, _ := json.Marshal(event)
		body.WriteString("data: ")
		body.Write(b)
		body.WriteString("\n\n")
	}
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(body.String()))}, nil
}

// Restricted callback listener and historic import. Never exposes account/admin routes.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"github.com/jamip/materialsx/control-plane/internal/payments"
	"github.com/jamip/materialsx/control-plane/migrations"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if e := run(); e != nil {
		log.Print("WeChat pilot failed (configuration, database or verified evidence); details suppressed")
		os.Exit(1)
	}
}
func run() error {
	imported := flag.String("import-order", "", "query and import one previously paid diagnostic order; do not charge")
	publish := flag.Bool("publish", false, "publish fixed pilot products as deployment owner; do not charge")
	verify := flag.Bool("verify", false, "query paid pilot orders, verify ledger and emit sanitized receipt")
	flag.Parse()
	cfg, e := identity.ConfigFromEnv()
	if e != nil {
		return e
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, e := identity.OpenPool(ctx, cfg)
	if e != nil {
		return e
	}
	defer pool.Close()
	if e = migrations.Check(ctx, pool); e != nil {
		return e
	}
	s := &payments.Store{Pool: pool}
	if e = payments.FromEnv(ctx, s, cfg.Environment, cfg.DatabaseURL, cfg.PublicURL); e != nil || s.Mode != "wechat-pilot" {
		return payments.ErrDisabled
	}
	if *publish {
		tx, e := pool.Begin(ctx)
		if e != nil {
			return e
		}
		defer tx.Rollback(ctx)
		for _, p := range []payments.Product{payments.PilotSubscription(), payments.PilotDiagnosticPack()} {
			if e = payments.PutProduct(ctx, tx, p); e != nil {
				return e
			}
		}
		return tx.Commit(ctx)
	}
	if e = identity.CheckRuntimeRole(ctx, pool); e != nil {
		return e
	}
	if *verify {
		orders, _, e := s.Orders(ctx, s.PilotAccount, "")
		if e != nil {
			return e
		}
		cash := int64(0)
		proofs := []map[string]any{}
		for _, o := range orders {
			if o.Channel != "wechat" || o.State != "paid" {
				continue
			}
			call, c := context.WithTimeout(ctx, 10*time.Second)
			v, e := s.Provider.Query(call, o)
			if e == nil && v.State != "SUCCESS" {
				e = payments.ErrEvidence
			}
			if e == nil {
				e = s.ApplyPayment(call, v)
			}
			c()
			if e != nil {
				return e
			}
			cash += v.Total
			var query, notification bool
			if e = s.Pool.QueryRow(ctx, `SELECT COALESCE(bool_or(source='query'),false),COALESCE(bool_or(source='notification'),false) FROM payment_evidence WHERE order_id=$1 AND body->>'state'='SUCCESS'`, o.ID).Scan(&query, &notification); e != nil {
				return e
			}
			proofs = append(proofs, map[string]any{"amountFen": o.AmountFen, "credits": o.Product.Credits, "kind": o.Product.Kind, "state": o.State, "queryVerified": query, "notificationVerified": notification})
		}
		meter := &metering.Store{Pool: pool}
		grants, e := meter.Verify(ctx)
		if e != nil {
			return e
		}
		wallet, e := meter.Wallet(ctx, s.PilotAccount)
		if e != nil {
			return e
		}
		periods, e := s.Periods(ctx, s.PilotAccount)
		if e != nil {
			return e
		}
		safePeriods := []map[string]any{}
		for _, v := range periods {
			safePeriods = append(safePeriods, map[string]any{"state": v.State, "startsAt": v.Starts, "endsAt": v.Ends})
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"account": "developer@materialsx.local", "verifiedCashInFen": fmt.Sprint(cash), "payments": proofs, "wallet": wallet, "subscriptionPeriods": safePeriods, "ledgerVerified": true, "grantsVerified": grants, "formalSalesEnabled": false, "paidModelUsageEnabled": false, "generatedAt": time.Now().UTC()})
	}
	if *imported != "" {
		call, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()
		o, e := s.ImportPaidDiagnostic(call, *imported)
		if e != nil {
			return e
		}
		fmt.Printf("Verified historic payment imported: state=%s; paid-credit=10\n", o.State)
		return nil
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /live", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	mux.HandleFunc("POST /v1/payments/wechat/notify", func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		v, e := s.Provider.(*payments.Wechat).Notification(r.Context(), r)
		if e == nil {
			e = s.ApplyPayment(r.Context(), v)
		}
		if e != nil {
			http.Error(w, "notification rejected", 400)
			return
		}
		w.WriteHeader(204)
	})
	server := &http.Server{Addr: "127.0.0.1:8899", Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second}
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				call, c := context.WithTimeout(ctx, 10*time.Second)
				if _, e := s.Tick(call, 1); e != nil {
					log.Print("pilot recovery pending")
				}
				c()
			}
		}
	}()
	go func() {
		<-ctx.Done()
		shutdown, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = server.Shutdown(shutdown)
	}()
	log.Print("Callback-only WeChat pilot listener ready on loopback:8899; no account or admin routes")
	e = server.ListenAndServe()
	if errors.Is(e, http.ErrServerClosed) {
		return nil
	}
	return e
}

// Isolated, one-shot merchant probe. No database, account, credits or public
// create/refund endpoint. A new private directory is required for each run.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/jamip/materialsx/control-plane/internal/payments"
)

type journal struct {
	OrderID              string    `json:"orderId"`
	AmountFen            string    `json:"amountFen"`
	Currency             string    `json:"currency"`
	State                string    `json:"state"`
	CodeURL              string    `json:"codeUrl,omitempty"`
	Expires              time.Time `json:"expiresAt"`
	Updated              time.Time `json:"updatedAt"`
	QueryVerified        bool      `json:"queryVerified"`
	NotificationVerified bool      `json:"notificationVerified"`
	TransactionID        string    `json:"transactionId,omitempty"`
	PaidAt               time.Time `json:"paidAt,omitempty"`
	DiagnosticCode       string    `json:"diagnosticCode,omitempty"`
	FormalSalesEnabled   bool      `json:"formalSalesEnabled"`
}

type probe struct {
	mu       sync.Mutex
	state    journal
	path     string
	provider *payments.Wechat
}

func (p *probe) saveLocked() error {
	p.state.Updated = time.Now().UTC()
	b, e := json.MarshalIndent(p.state, "", "  ")
	if e != nil {
		return e
	}
	f, e := os.OpenFile(p.path+".tmp", os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if e != nil {
		return e
	}
	_, e = f.Write(append(b, '\n'))
	if e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e == nil {
		e = ce
	}
	if e != nil {
		return e
	}
	return os.Rename(p.path+".tmp", p.path)
}

func (p *probe) apply(v payments.Evidence) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if e := p.provider.MatchProbe(p.state.OrderID, v); e != nil {
		return e
	}
	if p.state.TransactionID != "" && v.State == "SUCCESS" && p.state.TransactionID != v.TransactionID {
		return payments.ErrEvidence
	}
	if v.Source == "notification" {
		p.state.NotificationVerified = true
	}
	if v.Source == "query" && v.State == "SUCCESS" {
		p.state.QueryVerified = true
	}
	// A late query snapshot must never erase an already verified payment.
	if p.state.State != "SUCCESS" || v.State == "SUCCESS" {
		p.state.State = v.State
	}
	if v.State == "SUCCESS" {
		p.state.TransactionID = v.TransactionID
		p.state.PaidAt = v.PaidAt
	}
	return p.saveLocked()
}

func (p *probe) notify(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
	v, e := p.provider.Notification(r.Context(), r)
	if e == nil {
		e = p.apply(v)
	}
	if e != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}

func run() error {
	origin := flag.String("origin", "", "Explicit ngrok HTTPS origin")
	dir := flag.String("dir", "", "New absolute private output directory")
	ack := flag.Bool("create-one-fen", false, "Authorize exactly one real 0.01 CNY diagnostic order")
	flag.Parse()
	if !*ack || flag.NArg() != 0 || !filepath.IsAbs(*dir) {
		return fmt.Errorf("explicit one-fen authorization and new absolute directory required")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	w, e := payments.NewWechat(ctx, *origin)
	if e != nil {
		return fmt.Errorf("merchant configuration invalid")
	}
	listener, e := net.Listen("tcp", "127.0.0.1:8899")
	if e != nil {
		return fmt.Errorf("probe port unavailable; existing process unchanged")
	}
	defer listener.Close()
	if e = os.Mkdir(*dir, 0700); e != nil {
		return fmt.Errorf("new private directory required; no existing order retried")
	}
	var random [12]byte
	if _, e = rand.Read(random[:]); e != nil {
		return fmt.Errorf("random unavailable")
	}
	p := &probe{state: journal{OrderID: "mxp" + hex.EncodeToString(random[:]), AmountFen: "1", Currency: "CNY", State: "submitting", Expires: time.Now().UTC().Add(20 * time.Minute)}, path: filepath.Join(*dir, "order.json"), provider: w}
	if e = p.saveLocked(); e != nil {
		return fmt.Errorf("cannot persist diagnostic intent; no order submitted")
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/payments/wechat/notify", p.notify)
	mux.HandleFunc("GET /live", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","scope":"one-fen-diagnostic"}`))
	})
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16 * 1024}
	go func() { _ = server.Serve(listener) }()
	defer func() {
		c, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = server.Shutdown(c)
	}()
	// Submit once after journal commit. Ambiguous errors never create another
	// order; subsequent operations query only the original merchant order ID.
	call, cancel := context.WithTimeout(ctx, 8*time.Second)
	code, diagnostic, createErr := w.CreateOneFenProbe(call, p.state.OrderID, p.state.Expires)
	cancel()
	p.mu.Lock()
	if createErr == nil {
		p.state.CodeURL = code
		p.state.State = "NOTPAY"
	} else {
		p.state.State = "creation_unresolved"
		p.state.DiagnosticCode = diagnostic
	}
	e = p.saveLocked()
	p.mu.Unlock()
	if e != nil {
		return fmt.Errorf("cannot save creation result; original order ID retained; do not resubmit")
	}
	if createErr != nil {
		fmt.Println("One-fen order unresolved:", diagnostic, "; querying original order only")
	} else {
		fmt.Println("One-fen Native order created; private order.json contains checkout URL")
	}
	o := payments.Order{ID: p.state.OrderID, AmountFen: "1", Currency: "CNY", Channel: "wechat"}
	poll := time.NewTicker(15 * time.Second)
	defer poll.Stop()
	deadline := time.NewTimer(25 * time.Minute)
	defer deadline.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-deadline.C:
			// Query before attempting closure. Successful orders are never closed.
			q, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			v, err := w.Query(q, o)
			if err == nil && p.apply(v) == nil && (v.State == "NOTPAY" || v.State == "USERPAYING") {
				_ = w.Close(q, o)
			}
			cancel()
			return nil
		case <-poll.C:
			q, cancel := context.WithTimeout(ctx, 8*time.Second)
			v, err := w.Query(q, o)
			cancel()
			if err == nil {
				if e = p.apply(v); e != nil {
					fmt.Println("Query evidence not accepted")
				}
			}
		}
	}
}

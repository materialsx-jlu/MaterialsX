package main

import (
	"context"
	"flag"
	"github.com/jamip/materialsx/control-plane/internal/delivery"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/lifecycle"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"github.com/jamip/materialsx/control-plane/internal/payments"
	"github.com/jamip/materialsx/control-plane/migrations"
	"log"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

func main() {
	once := flag.Bool("once", false, "process at most 100 due outbox jobs and exit")
	flag.Parse()
	cfg, e := identity.ConfigFromEnv()
	if e != nil {
		log.Fatal("billing worker: invalid configuration")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	startup, cancel := context.WithTimeout(ctx, 15*time.Second)
	pool, e := identity.OpenPool(startup, cfg)
	if e != nil {
		log.Fatal("billing worker: database unavailable")
	}
	defer pool.Close()
	if migrations.Check(startup, pool) != nil {
		log.Fatal("billing worker: migrations not current")
	}
	if cfg.Environment == "production" && identity.CheckRuntimeRole(startup, pool) != nil {
		log.Fatal("billing worker: restricted role required")
	}
	pay := &payments.Store{Pool: pool}
	if e = payments.FromEnv(startup, pay, cfg.Environment, cfg.DatabaseURL, cfg.PublicURL); e != nil {
		log.Fatal("payment worker: invalid configuration")
	}
	cancel()
	sender, e := delivery.FromEnv(cfg.Environment == "production")
	if e != nil {
		log.Fatal("worker: invalid mail configuration")
	}
	dailyCost := int64(0)
	if raw := os.Getenv("MATERIALSX_COST_ALERT_DAILY_MICROFEN"); raw != "" {
		dailyCost, e = strconv.ParseInt(raw, 10, 64)
		if e != nil || dailyCost < 0 {
			log.Fatal("worker: invalid cost alert policy")
		}
	}
	lifecycleStore := lifecycle.Store{Pool: pool, Key: cfg.MasterKey}
	notifications := delivery.Store{Pool: pool, Key: cfg.MasterKey}
	s := metering.Store{Pool: pool}
	tick := func() bool {
		call, c := context.WithTimeout(ctx, 10*time.Second)
		defer c()
		n, e := s.Tick(call, 100)
		if e != nil {
			log.Print("billing worker: recovery transaction failed")
			return false
		} else if n > 0 {
			log.Printf("billing worker: processed=%d", n)
		}
		return true
	}
	paymentsTick := func() bool {
		call, c := context.WithTimeout(ctx, 10*time.Second)
		defer c()
		if _, e := pay.Tick(call, 1); e != nil {
			log.Print("payment worker: recovery transaction failed")
			return false
		}
		return true
	}
	run := func() {
		paymentOK := paymentsTick()
		billingOK := tick()
		call, c := context.WithTimeout(ctx, 15*time.Second)
		defer c()
		if paymentOK && billingOK {
			if e := lifecycleStore.Tick(call, os.Getenv("MATERIALSX_ALERT_EMAIL"), dailyCost); e != nil {
				log.Print("worker: lifecycle transaction failed")
			}
		}
		if _, e := notifications.Tick(call, sender); e != nil {
			log.Print("worker: notification state update failed")
		}
	}
	run()
	if *once {
		return
	}
	timer := time.NewTicker(15 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			run()
		}
	}
}

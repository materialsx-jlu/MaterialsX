package main

import (
	"context"
	"errors"
	"github.com/jamip/materialsx/control-plane/internal/delivery"
	"github.com/jamip/materialsx/control-plane/internal/gateway"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/mxpoints"
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
	cfg, e := identity.ConfigFromEnv()
	if e != nil {
		log.Fatal("identity startup: invalid configuration")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	startup, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	pool, e := identity.OpenPool(startup, cfg)
	if e != nil {
		log.Fatal("identity startup: database unavailable or insecure")
	}
	defer pool.Close()
	if migrations.Check(startup, pool) != nil {
		log.Fatal("identity startup: apply migrations with identityctl first")
	}
	if cfg.Environment == "production" && identity.CheckRuntimeRole(startup, pool) != nil {
		log.Fatal("identity startup: use a restricted runtime database role")
	}
	service, e := identity.New(pool, cfg.MasterKey)
	if e != nil {
		log.Fatal("identity startup: invalid master key")
	}
	service.DisableAdminTOTP = cfg.DisableAdminTOTP
	cloud, e := gateway.ConfigFromEnv()
	if e != nil {
		log.Fatal("gateway startup: invalid configuration")
	}
	handler := identity.NewHTTP(service, cfg.PublicURL, cfg.Environment == "production", cfg.TrustedProxies...)
	mailSender, mailError := delivery.FromEnv(cfg.Environment == "production")
	if mailError != nil {
		log.Fatal("email startup: invalid configuration")
	}
	emailEnabled := os.Getenv("MATERIALSX_EMAIL_ENABLED") == "1"
	if emailEnabled && mailSender == nil {
		log.Fatal("email startup: sender required")
	}
	if e = handler.ConfigureEmail(identity.EmailOptions{Enabled: emailEnabled, Signup: os.Getenv("MATERIALSX_SIGNUP_ENABLED") == "1", TermsVersion: os.Getenv("MATERIALSX_TERMS_VERSION"), TermsURL: os.Getenv("MATERIALSX_TERMS_URL")}); e != nil {
		log.Fatal("email startup: approved terms required")
	}
	billing := &payments.Store{Pool: pool}
	if e = payments.FromEnv(startup, billing, cfg.Environment, cfg.DatabaseURL, cfg.PublicURL); e != nil {
		log.Fatal("payment startup: invalid configuration")
	}
	workspace := gateway.Mount(handler, &gateway.Store{Pool: pool, Config: cloud})
	gateway.MountPayments(workspace, billing)
	mx, e := mxpoints.FromPayments(pool, billing, cfg.Environment)
	if e != nil {
		log.Fatal("MX payment startup: sales mode unavailable")
	}
	gateway.MountMXPoints(workspace, mx)
	workspace.ConfigureLifecycle(cfg.MasterKey, os.Getenv("MATERIALSX_BETA_APPROVALS_FILE"))
	if e = workspace.ConfigureWorkspace(os.Getenv("MATERIALSX_ADMIN_ASSET_DIR"), os.Getenv("MATERIALSX_RELEASE_APPROVALS_FILE")); e != nil {
		log.Fatal("workspace startup: invalid deployment configuration")
	}
	if workspace.AdminAssets != nil {
		defer workspace.AdminAssets.Close()
	}
	server := identity.NewServer(cfg.Address, handler)
	go func() {
		<-ctx.Done()
		shutdown, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = server.Shutdown(shutdown)
	}()
	log.Printf("MaterialsX identity service: environment=%s; migrations verified", cfg.Environment)
	if e = server.ListenAndServe(); e != nil && !errors.Is(e, http.ErrServerClosed) {
		log.Fatal("identity service stopped unexpectedly")
	}
}

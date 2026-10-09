package main

import (
	"context"
	"errors"
	"github.com/jamip/materialsx/control-plane/internal/billingadmin"
	"github.com/jamip/materialsx/control-plane/internal/delivery"
	"github.com/jamip/materialsx/control-plane/internal/gateway"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/mxpoints"
	"github.com/jamip/materialsx/control-plane/internal/observability"
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
	if (cloud.MXReleaseID != "" || billing.MXOnly || mx.Mode == "wechat-production") &&
		(cloud.MXReleaseID == "" || cloud.MXReleaseID != billing.MXReleaseID || cloud.MXReleaseID != mx.ReleaseID || cloud.MXAPIOrigin != billing.MXAPIOrigin || cloud.MXAPIOrigin != mx.APIOrigin) {
		log.Fatal("MX production startup: release state mismatch")
	}
	gateway.MountMXPoints(workspace, mx)
	handler.ClientFeatures = identity.ClientFeatures{
		Account: true, Models: cloud.Enabled || cloud.MX03Wallet,
		Research: false, Payments: mx.Mode != "disabled" || billing.Mode != "disabled",
	}
	workspace.ConfigureLifecycle(cfg.MasterKey, os.Getenv("MATERIALSX_BETA_APPROVALS_FILE"))
	if e = workspace.ConfigureWorkspace(os.Getenv("MATERIALSX_ADMIN_ASSET_DIR"), os.Getenv("MATERIALSX_RELEASE_APPROVALS_FILE")); e != nil {
		log.Fatal("workspace startup: invalid deployment configuration")
	}
	if workspace.AdminAssets != nil {
		defer workspace.AdminAssets.Close()
	}
	billingOrigin := os.Getenv("MATERIALSX_BILLING_ADMIN_PUBLIC_URL")
	billingProxyToken := os.Getenv("MATERIALSX_BILLING_PROXY_TOKEN")
	if billingOrigin != "" || billingProxyToken != "" {
		billingConsole, err := billingadmin.New(pool, service, billingOrigin, billingProxyToken, cfg.Environment == "production")
		if err != nil {
			log.Fatal("billing console startup: invalid host or proxy credential")
		}
		billingConsole.CloudEnabled = cloud.Enabled
		billingConsole.MXWallet = cloud.MX03Wallet
		billingConsole.MXMode = mx.Mode
		billingConsole.PaymentMode = billing.Mode
		billingConsole.LiteLLMOrigin = os.Getenv("MATERIALSX_LITELLM_URL")
		billingConsole.Mount(handler)
	}
	metricsToken := os.Getenv("MATERIALSX_METRICS_TOKEN")
	monitor := observability.New(metricsToken)
	monitor.Probe = func(ctx context.Context) (map[string]int64, error) {
		var pending, bytes, orders, notifications int64
		err := pool.QueryRow(ctx, `SELECT
		 (SELECT count(*) FROM gateway_requests WHERE settlement='reconciliation_pending'),
		 pg_database_size(current_database()),
		 (SELECT count(*) FROM mx_point_orders WHERE state='pending' AND created_at<clock_timestamp()-interval '15 minutes'),
		 (SELECT count(*) FROM mx_point_evidence WHERE source='notification' AND created_at>clock_timestamp()-interval '1 hour')`).Scan(&pending, &bytes, &orders, &notifications)
		return map[string]int64{"reconciliationPending": pending, "databaseBytes": bytes, "agedPendingOrders": orders, "paymentNotificationsLastHour": notifications}, err
	}
	server := identity.NewServer(cfg.Address, monitor.Wrap(handler))
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

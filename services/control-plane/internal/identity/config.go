package identity

import (
	"context"
	"encoding/base64"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
)

func stringInt(n int64) string { return strconv.FormatInt(n, 10) }

type Config struct {
	Environment, Address, PublicURL, DatabaseURL string
	DisableAdminTOTP                             bool
	MasterKey                                    []byte
	TrustedProxies                               []*net.IPNet
}

func ConfigFromEnv() (Config, error) {
	c := Config{Environment: os.Getenv("MATERIALSX_ENV"), Address: os.Getenv("MATERIALSX_IDENTITY_ADDR"), PublicURL: os.Getenv("MATERIALSX_IDENTITY_PUBLIC_URL"), DatabaseURL: os.Getenv("MATERIALSX_DATABASE_URL")}
	if c.Environment == "" {
		c.Environment = "development"
	}
	if c.Address == "" {
		c.Address = "127.0.0.1:8788"
	}
	if c.PublicURL == "" {
		c.PublicURL = "http://127.0.0.1:8788"
	}
	key, e := base64.StdEncoding.DecodeString(os.Getenv("MATERIALSX_IDENTITY_MASTER_KEY"))
	if e != nil || len(key) != 32 {
		return c, errors.New("identity_master_key_required")
	}
	c.MasterKey = key
	mode := os.Getenv("MATERIALSX_LOCAL_DISABLE_ADMIN_TOTP")
	if mode != "" && mode != "0" && mode != "1" {
		return c, errors.New("invalid_local_totp_setting")
	}
	c.DisableAdminTOTP = mode == "1"
	if c.DisableAdminTOTP && c.Environment != "development" {
		return c, errors.New("totp_bypass_requires_loopback_development")
	}
	if c.Environment != "development" && c.Environment != "production" {
		return c, errors.New("invalid_identity_environment")
	}
	u, e := url.Parse(c.PublicURL)
	if e != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || u.Host == "" {
		return c, errors.New("invalid_public_url")
	}
	c.PublicURL = strings.TrimRight(c.PublicURL, "/")
	host, _, e := net.SplitHostPort(c.Address)
	if e != nil {
		return c, errors.New("invalid_identity_address")
	}
	if c.Environment == "production" {
		if u.Scheme != "https" || os.Getenv("MATERIALSX_DEV_MODE") == "1" {
			return c, errors.New("production_requires_https_and_no_dev_routes")
		}
	} else if u.Scheme != "http" || u.Hostname() != "127.0.0.1" || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		return c, errors.New("development_identity_must_be_loopback")
	}
	if c.DatabaseURL == "" {
		return c, errors.New("identity_database_required")
	}
	for _, raw := range strings.Split(os.Getenv("MATERIALSX_TRUSTED_PROXY_CIDRS"), ",") {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		_, prefix, e := net.ParseCIDR(strings.TrimSpace(raw))
		if e != nil {
			return c, errors.New("invalid_trusted_proxy_cidr")
		}
		ones, _ := prefix.Mask.Size()
		if ones == 0 {
			return c, errors.New("trusted_proxy_cidr_too_broad")
		}
		c.TrustedProxies = append(c.TrustedProxies, prefix)
	}
	return c, nil
}
func OpenPool(ctx context.Context, c Config) (*pgxpool.Pool, error) {
	cfg, e := pgxpool.ParseConfig(c.DatabaseURL)
	if e != nil {
		return nil, errors.New("invalid_database_configuration")
	}
	if c.Environment == "production" && (cfg.ConnConfig.TLSConfig == nil || cfg.ConnConfig.TLSConfig.InsecureSkipVerify || cfg.ConnConfig.TLSConfig.ServerName == "" || len(cfg.ConnConfig.Fallbacks) > 0) {
		return nil, errors.New("production_database_requires_verify_full_tls")
	}
	if c.Environment == "development" && !strings.HasPrefix(cfg.ConnConfig.Host, "/") {
		ip := net.ParseIP(cfg.ConnConfig.Host)
		if ip == nil || !ip.IsLoopback() {
			return nil, errors.New("development_database_must_be_loopback")
		}
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = "mx_identity,pg_catalog"
	cfg.MaxConns = 8
	pool, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		return nil, errors.New("identity_database_unavailable")
	}
	if e = pool.Ping(ctx); e != nil {
		pool.Close()
		return nil, errors.New("identity_database_unavailable")
	}
	return pool, nil
}
func CheckRuntimeRole(ctx context.Context, pool *pgxpool.Pool) error {
	var elevated bool
	e := pool.QueryRow(ctx, `SELECT rolsuper OR rolcreatedb OR rolcreaterole OR has_schema_privilege(current_user,'mx_identity','CREATE') FROM pg_roles WHERE rolname=current_user`).Scan(&elevated)
	if e != nil || elevated {
		return errors.New("identity_runtime_role_must_not_be_migration_owner")
	}
	return nil
}

package payments

import (
	"context"
	"crypto/rsa"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/wechatpay-apiv3/wechatpay-go/utils"
	"gopkg.in/yaml.v3"
)

// Credentials never leave the server. The sidecar's database, notify URL and
// order_sync settings are deliberately not inherited by the direct SDK adapter.
type wechatConfig struct {
	merchant, app, serial, keyID, apiKey           string
	privatePath, publicPath, privatePEM, publicPEM string
	source                                         string
	sidecarProtected, sidecarSanitized             bool
}

type weixinYAML struct {
	Payment struct {
		Providers []string `yaml:"providers"`
		Weixin    struct {
			BaseURL     string `yaml:"base_url"`
			Merchant    string `yaml:"mchid"`
			App         string `yaml:"appid"`
			Serial      string `yaml:"serial_no"`
			APIKey      string `yaml:"apiv3_key"`
			KeyID       string `yaml:"wechat_pay_public_key_id"`
			PrivatePath string `yaml:"private_key_pem_path"`
			PrivateEnv  string `yaml:"private_key_pem_env"`
			PublicPath  string `yaml:"wechat_pay_public_key_path"`
			PublicEnv   string `yaml:"wechat_pay_public_key_pem_env"`
		} `yaml:"weixin"`
	} `yaml:"payment"`
	Security struct {
		BusinessAuth struct {
			Enabled bool   `yaml:"enabled"`
			Key     string `yaml:"api_key"`
		} `yaml:"business_auth"`
		RequestSign struct {
			Enabled bool   `yaml:"enabled"`
			Secret  string `yaml:"secret"`
		} `yaml:"request_sign"`
		ReplayProtect struct {
			Enabled bool `yaml:"enabled"`
		} `yaml:"replay_protect"`
		Sanitize *bool `yaml:"sanitize_api_errors"`
	} `yaml:"security"`
}

func placeholder(s string) bool {
	s = strings.ToUpper(strings.TrimSpace(s))
	return s == "" || strings.Contains(s, "${") || strings.Contains(s, "<") || strings.Contains(s, "REPLACE") || strings.Contains(s, "YOUR_") || strings.Contains(s, "CHANGE_ME")
}

// Bound reads and redact every error: YAML parse diagnostics can contain secrets.
func wechatRead(path string, private bool) ([]byte, error) {
	if !filepath.IsAbs(path) {
		return nil, ErrValidation
	}
	f, e := os.Open(path)
	if e != nil {
		return nil, ErrValidation
	}
	defer f.Close()
	s, e := f.Stat()
	if e != nil || !s.Mode().IsRegular() || s.Size() > 64*1024 || (private && runtime.GOOS != "windows" && s.Mode().Perm()&0077 != 0) {
		return nil, ErrValidation
	}
	b, e := io.ReadAll(io.LimitReader(f, 64*1024+1))
	if e != nil || len(b) > 64*1024 {
		return nil, ErrValidation
	}
	return b, nil
}

func loadWechatConfig(get func(string) string) (wechatConfig, error) {
	c := wechatConfig{merchant: get("WECHAT_PAY_MCH_ID"), app: get("WECHAT_PAY_APP_ID"), serial: get("WECHAT_PAY_CERT_SERIAL"), keyID: get("WECHAT_PAY_PUBLIC_KEY_ID"), apiKey: get("WECHAT_PAY_API_V3_KEY"), privatePath: get("WECHAT_PAY_PRIVATE_KEY_PATH"), publicPath: get("WECHAT_PAY_PUBLIC_KEY_PATH"), source: "environment"}
	path := get("MATERIALSX_WECHAT_CONFIG_PATH")
	if path == "" {
		return c, nil
	}
	b, e := wechatRead(path, true)
	if e != nil {
		return wechatConfig{}, ErrValidation
	}
	var doc weixinYAML
	if yaml.Unmarshal(b, &doc) != nil {
		return wechatConfig{}, ErrValidation
	}
	enabled := false
	for _, p := range doc.Payment.Providers {
		if p == "weixin" {
			enabled = true
		}
	}
	w := doc.Payment.Weixin
	if !enabled || (w.BaseURL != "" && strings.TrimRight(w.BaseURL, "/") != "https://api.mch.weixin.qq.com") {
		return wechatConfig{}, ErrValidation
	}
	// Do not silently combine two merchants. Only the public key ID can be
	// supplied separately because the older sidecar schema does not contain it.
	for _, name := range []string{"WECHAT_PAY_MCH_ID", "WECHAT_PAY_APP_ID", "WECHAT_PAY_CERT_SERIAL", "WECHAT_PAY_API_V3_KEY", "WECHAT_PAY_PRIVATE_KEY_PATH", "WECHAT_PAY_PUBLIC_KEY_PATH"} {
		if get(name) != "" {
			return wechatConfig{}, ErrValidation
		}
	}
	base := get("MATERIALSX_WECHAT_RUNTIME_DIR")
	if base == "" {
		base = filepath.Dir(path)
	}
	if !filepath.IsAbs(base) {
		return wechatConfig{}, ErrValidation
	}
	resolve := func(p string) string {
		if p == "" || filepath.IsAbs(p) {
			return p
		}
		return filepath.Join(base, p)
	}
	id := w.KeyID
	if c.keyID != "" {
		if id != "" && id != c.keyID {
			return wechatConfig{}, ErrValidation
		}
		id = c.keyID
	}
	c = wechatConfig{merchant: w.Merchant, app: w.App, serial: w.Serial, keyID: id, apiKey: w.APIKey, privatePath: resolve(w.PrivatePath), publicPath: resolve(w.PublicPath), source: "weixin-runtime-yaml"}
	if w.PrivateEnv != "" {
		c.privatePEM = get(w.PrivateEnv)
	}
	if w.PublicEnv != "" {
		c.publicPEM = get(w.PublicEnv)
	}
	c.sidecarProtected = doc.Security.BusinessAuth.Enabled && !placeholder(doc.Security.BusinessAuth.Key) && doc.Security.RequestSign.Enabled && !placeholder(doc.Security.RequestSign.Secret) && doc.Security.ReplayProtect.Enabled
	c.sidecarSanitized = doc.Security.Sanitize == nil || *doc.Security.Sanitize
	return c, nil
}

func (c wechatConfig) identifiersValid() bool {
	return !placeholder(c.merchant) && identifier.MatchString(c.merchant) && !placeholder(c.app) && identifier.MatchString(c.app) && !placeholder(c.serial) && identifier.MatchString(c.serial) && !placeholder(c.keyID) && identifier.MatchString(c.keyID) && strings.HasPrefix(c.keyID, "PUB_KEY_ID_") && len(c.keyID) > len("PUB_KEY_ID_") && len(c.apiKey) == 32 && !placeholder(c.apiKey)
}

func (c wechatConfig) privateKey() (*rsa.PrivateKey, error) {
	b := []byte(c.privatePEM)
	if len(b) == 0 {
		var e error
		b, e = wechatRead(c.privatePath, true)
		if e != nil {
			return nil, ErrValidation
		}
	}
	if len(b) > 64*1024 {
		return nil, ErrValidation
	}
	k, e := utils.LoadPrivateKey(string(b))
	if e != nil || k.N.BitLen() < 2048 || k.Validate() != nil {
		return nil, ErrValidation
	}
	return k, nil
}

func (c wechatConfig) publicKey() (*rsa.PublicKey, error) {
	b := []byte(c.publicPEM)
	if len(b) == 0 {
		var e error
		b, e = wechatRead(c.publicPath, false)
		if e != nil {
			return nil, ErrValidation
		}
	}
	if len(b) > 64*1024 {
		return nil, ErrValidation
	}
	k, e := utils.LoadPublicKey(string(b))
	if e != nil || k.N.BitLen() < 2048 {
		return nil, ErrValidation
	}
	return k, nil
}

func wechatOriginValid(origin string) bool {
	u, e := url.Parse(origin)
	return e == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && u.RawQuery == "" && !u.ForceQuery && u.Fragment == "" && u.Path == "" && u.Opaque == ""
}

type WechatCheck struct {
	Code string `json:"code"`
	OK   bool   `json:"ok"`
}
type WechatReadiness struct {
	Adapter             string        `json:"adapter"`
	Source              string        `json:"source"`
	Checks              []WechatCheck `json:"checks"`
	Warnings            []string      `json:"warnings"`
	OfflineConfigReady  bool          `json:"offlineConfigReady"`
	MerchantConfigReady bool          `json:"merchantConfigReady"`
	FormalSalesEnabled  bool          `json:"formalSalesEnabled"`
	RealPaymentVerified bool          `json:"realPaymentVerified"`
}

// Offline only: no DNS, database, sidecar request, order, refund or SDK API call.
// This validates format, not merchant ownership, binding, Native activation or TLS.
func WechatPreflight(get func(string) string, origin string) WechatReadiness {
	r := WechatReadiness{Adapter: "wechat-native-official-sdk", Checks: []WechatCheck{}, Warnings: []string{"native_activation_app_binding_and_public_callback_unverified", "formal_metering_prices_and_refund_terms_pending"}}
	add := func(code string, ok bool) { r.Checks = append(r.Checks, WechatCheck{code, ok}) }
	c, e := loadWechatConfig(get)
	r.Source = c.source
	add("source_config_readable_and_unambiguous", e == nil)
	if e == nil {
		add("merchant_id_present", !placeholder(c.merchant) && identifier.MatchString(c.merchant))
		add("app_id_present", !placeholder(c.app) && identifier.MatchString(c.app))
		add("merchant_certificate_serial_present", !placeholder(c.serial) && identifier.MatchString(c.serial))
		add("api_v3_key_32_bytes", len(c.apiKey) == 32 && !placeholder(c.apiKey))
		add("wechat_public_key_id_present", !placeholder(c.keyID) && identifier.MatchString(c.keyID) && strings.HasPrefix(c.keyID, "PUB_KEY_ID_") && len(c.keyID) > len("PUB_KEY_ID_"))
		_, e = c.privateKey()
		add("private_rsa_key_valid_and_private_permissions", e == nil)
		_, e = c.publicKey()
		add("platform_rsa_public_key_valid", e == nil)
		if c.source == "weixin-runtime-yaml" {
			if !c.sidecarProtected {
				r.Warnings = append(r.Warnings, "source_sidecar_business_auth_signing_or_replay_protection_disabled_or_placeholder")
			}
			if !c.sidecarSanitized {
				r.Warnings = append(r.Warnings, "source_sidecar_api_error_sanitization_disabled")
			}
		}
	}
	r.MerchantConfigReady = true
	for _, check := range r.Checks {
		if !check.OK {
			r.MerchantConfigReady = false
		}
	}
	if r.MerchantConfigReady {
		// Public-key mode constructs both SDK and decryptor locally; it does
		// not fetch certificates. The synthetic URL is never sent anywhere.
		_, e = newWechat(context.Background(), c, "https://offline-check.invalid")
		add("official_sdk_initialized_offline", e == nil)
		r.MerchantConfigReady = e == nil
	}
	u, _ := url.Parse(origin)
	public := wechatOriginValid(origin) && u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1" && !strings.HasSuffix(u.Hostname(), ".invalid") && !strings.HasSuffix(u.Hostname(), ".example") && u.Hostname() != "example.com"
	add("materialsx_independent_https_origin_configured", public)
	r.OfflineConfigReady = true
	for _, check := range r.Checks {
		if !check.OK {
			r.OfflineConfigReady = false
		}
	}
	return r
}

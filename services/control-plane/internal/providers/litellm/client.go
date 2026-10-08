package litellm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
)

// Client is a single-hop, no-retry proxy client. The caller chooses a fixed
// model alias; this transport never accepts a target URL from a request.
type Client struct {
	base string
	key  string
	http *http.Client
}

func NewClient(base, key string) (*Client, error) {
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/" && u.Path != "/v1") {
		return nil, errors.New("invalid_litellm_url")
	}
	host := u.Hostname()
	if u.Scheme != "https" {
		ip := net.ParseIP(host)
		if u.Scheme != "http" || ip == nil || !ip.IsLoopback() {
			return nil, errors.New("litellm_requires_https_or_loopback")
		}
	}
	if !strings.HasPrefix(key, "sk-") || strings.ContainsAny(key, "\r\n") {
		return nil, errors.New("invalid_litellm_key")
	}
	u.Path = "/v1"
	return &Client{base: strings.TrimRight(u.String(), "/"), key: key, http: &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirect_refused") }}}, nil
}

func (c *Client) Open(ctx context.Context, payload map[string]any) (*http.Response, error) {
	return c.open(ctx, "/responses", payload)
}

func (c *Client) OpenChat(ctx context.Context, payload map[string]any) (*http.Response, error) {
	return c.open(ctx, "/chat/completions", payload)
}

func (c *Client) open(ctx context.Context, path string, payload map[string]any) (*http.Response, error) {
	body, err := json.Marshal(payload)
	if err != nil || len(body) > 256*1024 {
		return nil, errors.New("invalid_proxy_payload")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, bytes.NewReader(body))
	if err != nil {
		return nil, errors.New("invalid_proxy_request")
	}
	req.Header.Set("Authorization", "Bearer "+c.key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	return c.http.Do(req)
}

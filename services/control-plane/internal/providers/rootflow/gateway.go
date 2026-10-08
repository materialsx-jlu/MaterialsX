package rootflow

import (
	"context"
	"net/http"
)

// Open streams the native protocol to MaterialsX's observer. It never retries or forwards client auth.
func (c *Client) Open(ctx context.Context, payload map[string]any) (*http.Response, error) {
	reqClient := *c
	transport := *c.http
	transport.Timeout = 0 // bounded by the gateway's per-task deadline, not the probe's 60 seconds.
	reqClient.http = &transport
	return reqClient.request(ctx, "POST", "/responses", payload)
}

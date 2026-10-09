package identity

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPublicClientConfigRevisionAndETag(t *testing.T) {
	s := testService(t)
	h := NewHTTP(s, "http://127.0.0.1:8788", false)
	h.ClientFeatures = ClientFeatures{Account: true, Models: true, Payments: true}
	request := func(etag string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8788/v1/client-config", nil)
		if etag != "" {
			r.Header.Set("If-None-Match", etag)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	first := request("")
	if first.Code != 200 || !strings.Contains(first.Header().Get("Cache-Control"), "no-cache") {
		t.Fatalf("public config response: %d %s", first.Code, first.Body.String())
	}
	var body struct {
		SchemaVersion   int            `json:"schemaVersion"`
		CatalogRevision string         `json:"catalogRevision"`
		Features        ClientFeatures `json:"features"`
		Availability    map[string]struct {
			Status string `json:"status"`
			Reason string `json:"reason"`
		} `json:"availability"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &body); err != nil || body.SchemaVersion != 1 || len(body.CatalogRevision) != 64 || !body.Features.Account {
		t.Fatalf("invalid public config: %v %+v", err, body)
	}
	if request(first.Header().Get("ETag")).Code != http.StatusNotModified {
		t.Fatal("matching ETag must return 304")
	}
	if body.Availability["research"].Reason != "not_configured" || body.Availability["models"].Status != "available" {
		t.Fatalf("capability availability missing: %+v", body.Availability)
	}
	if _, err := s.Pool.Exec(context.Background(), `UPDATE operations_controls SET cloud_paused=true,sales_paused=true,version=version+1 WHERE id=true`); err != nil {
		t.Fatal(err)
	}
	paused := request(first.Header().Get("ETag"))
	if paused.Code != http.StatusOK || paused.Header().Get("ETag") == first.Header().Get("ETag") {
		t.Fatal("pause must invalidate public configuration")
	}
	if err := json.Unmarshal(paused.Body.Bytes(), &body); err != nil || body.Features.Models || body.Features.Payments ||
		body.Availability["models"].Reason != "paused" || body.Availability["payments"].Reason != "paused" {
		t.Fatalf("paused model and sale must be unavailable: %v %+v", err, body)
	}
	owner := account(t, s, "client-config-owner@example.invalid", false)
	_, err := s.Pool.Exec(context.Background(), `INSERT INTO mx_cloud_models(id,display_name,provider,supplier_model,proxy_alias,api_base,protocol,credential_env,status,purchase_version_id,fx_version_id,retail_version_id,route_version,created_by) VALUES('synthetic-active','Synthetic','fixture','synthetic','fixture-synthetic','https://supplier.example.invalid','responses','FIXTURE_KEY','active','purchase-1','fx-1','retail-1','route-1',$1)`, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	changed := request(first.Header().Get("ETag"))
	if changed.Code != 200 || changed.Header().Get("ETag") == first.Header().Get("ETag") {
		t.Fatal("published model must change public revision")
	}
}

package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jamip/materialsx/control-plane/internal/billing"
)

func TestDevelopmentSubscriptionEndpointIsExplicitlyGated(t *testing.T) {
	store, _ := billing.NewStore("")
	body := `{"accountId":"acct","planId":"pro","eventId":"event-1"}`

	disabled := httptest.NewRecorder()
	New(store, false).Handler().ServeHTTP(disabled, httptest.NewRequest(http.MethodPost, "/v1/dev/subscriptions", strings.NewReader(body)))
	if disabled.Code != http.StatusNotFound {
		t.Fatalf("expected disabled endpoint to return 404, got %d", disabled.Code)
	}

	enabled := httptest.NewRecorder()
	New(store, true).Handler().ServeHTTP(enabled, httptest.NewRequest(http.MethodPost, "/v1/dev/subscriptions", strings.NewReader(body)))
	if enabled.Code != http.StatusOK {
		t.Fatalf("expected dev grant to succeed, got %d: %s", enabled.Code, enabled.Body.String())
	}
}

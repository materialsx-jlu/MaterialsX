package gateway

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jamip/materialsx/control-plane/internal/identity"
)

func TestProductionOpsRequiresProtectedAdminOrigin(t *testing.T) {
	parent := identity.NewHTTP(nil, "https://api.materialsx-fixture.org", true)
	parent.BillingPublicURL = "https://admin.materialsx-fixture.org"
	h := &HTTP{Identity: parent}
	check := func(origin string) (bool, int) {
		r := httptest.NewRequest(http.MethodPost, "https://admin.materialsx-fixture.org/ops/api/login", nil)
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		ok := h.sameOrigin(w, r)
		return ok, w.Code
	}
	if ok, _ := check("https://admin.materialsx-fixture.org"); !ok {
		t.Fatal("protected admin origin rejected")
	}
	if ok, code := check("https://api.materialsx-fixture.org"); ok || code != http.StatusForbidden {
		t.Fatal("API origin accepted for admin mutation", code)
	}
}

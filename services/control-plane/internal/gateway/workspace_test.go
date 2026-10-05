package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"github.com/jamip/materialsx/control-plane/internal/payments"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type workspaceFixture struct {
	h       *HTTP
	parent  *identity.HTTP
	p       identity.Principal
	token   string
	cookies []*http.Cookie
	csrf    string
}

func workspaceTest(t *testing.T) *workspaceFixture {
	t.Helper()
	s, p, _ := metered(t)
	ident, _ := identity.New(s.Pool, make([]byte, 32))
	ctx := context.Background()
	secret := "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
	admin, e := ident.CreateAccount(ctx, "workspace@example.invalid", "Workspace admin", "fixture-password-only", "admin", secret)
	if e != nil {
		t.Fatal(e)
	}
	parent := identity.NewHTTP(ident, "http://ops.test", false)
	h := Mount(parent, s)
	pay := &payments.Store{Pool: s.Pool, Mode: "test", Merchant: "synthetic", AppID: "app", Provider: payments.NewTestProvider("synthetic", "app")}
	MountPayments(h, pay)
	// Get an independent ordinary account bearer for ownership/role regressions.
	_, token := principal(t, ident)
	p, _ = ident.Authenticate(ctx, token)
	s.Grant(ctx, p.ID, 10000, time.Now().Add(time.Hour))
	otp, _ := identity.TOTP(secret, time.Now().Unix()/30)
	body, _ := json.Marshal(map[string]string{"email": admin.Email, "password": "fixture-password-only", "otp": otp})
	r := httptest.NewRequest("POST", "http://ops.test/ops/api/login", strings.NewReader(string(body)))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "http://ops.test")
	w := httptest.NewRecorder()
	parent.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal("MFA login", w.Code)
	}
	var login struct {
		CSRF string `json:"csrf"`
	}
	json.Unmarshal(w.Body.Bytes(), &login)
	return &workspaceFixture{h, parent, p, token, w.Result().Cookies(), login.CSRF}
}
func (f *workspaceFixture) ops(method, path string, body any, key string) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	r := httptest.NewRequest(method, "http://ops.test/ops/api/"+path, strings.NewReader(string(b)))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "http://ops.test")
	r.Header.Set("X-CSRF-Token", f.csrf)
	r.Header.Set("Idempotency-Key", key)
	for _, c := range f.cookies {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	f.parent.ServeHTTP(w, r)
	return w
}
func (f *workspaceFixture) user(path string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("GET", "http://ops.test"+path, nil)
	r.Header.Set("Authorization", "Bearer "+f.token)
	w := httptest.NewRecorder()
	f.parent.ServeHTTP(w, r)
	return w
}
func TestWorkspaceBillsUnknownOwnershipPagingAndCSV(t *testing.T) {
	f := workspaceTest(t)
	ctx := context.Background()
	s := f.h.S
	grantCredits(t, &metering.Store{Pool: s.Pool}, f.p, "bill-grant", "10000", time.Now().Add(time.Hour))
	task := meteredTask(t, s, f.p, "2000")
	one := newID()
	if _, _, e := s.Claim(ctx, f.p, task.ID, one, one, native()); e != nil {
		t.Fatal(e)
	}
	s.Dispatched(ctx, one)
	u := &rootflow.Usage{Source: "responses", Input: i64(10), Output: i64(4), Cached: i64(2), Uncached: i64(8), Reasoning: i64(1)}
	if e := s.Finish(ctx, one, "completed", "", 200, true, u); e != nil {
		t.Fatal(e)
	}
	two := newID()
	if _, _, e := s.Claim(ctx, f.p, task.ID, two, two, native()); e != nil {
		t.Fatal(e)
	}
	s.Dispatched(ctx, two)
	if e := s.Finish(ctx, two, "unknown", "STREAM_INTERRUPTED", 0, false, nil); e != nil {
		t.Fatal(e)
	}
	bills, _, e := s.Bills(ctx, f.p.ID, "")
	if e != nil || len(bills) != 1 {
		t.Fatal("bill", e)
	}
	b := bills[0]
	if b.Charged != "14" || b.Held == "0" || b.Pending != 1 || b.Input != nil || b.Output != nil {
		t.Fatalf("unknown incorrectly normalized: %+v", b)
	}
	var activity struct {
		Items []ActivityDay `json:"items"`
	}
	response := f.user("/v1/billing/activity")
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &activity) != nil || len(activity.Items) != 7 {
		t.Fatal("activity endpoint", response.Code)
	}
	total := 0
	for _, day := range activity.Items {
		total += day.Requests
		if day.Requests > 0 && (day.Pending != 1 || day.Charged != "14" || day.Input != nil) {
			t.Fatal("activity invented usage", day)
		}
	}
	if total != 2 {
		t.Fatal("activity incomplete", total)
	}
	if w := f.user("/v1/billing/tasks/export"); w.Code != 200 || !strings.Contains(w.Body.String(), ",unknown,unknown,") || strings.Contains(w.Body.String(), "procurement") {
		t.Fatal("CSV whitelist", w.Code)
	}
	ident := f.parent.S
	other, _ := principal(t, ident)
	s.Grant(ctx, other.ID, 10000, time.Now().Add(time.Hour))
	foreign := meteredTask(t, s, other, "2000")
	if w := f.user("/v1/billing/tasks?cursor=" + foreign.ID); w.Code != 200 || !strings.Contains(w.Body.String(), `"items":[]`) {
		t.Fatal("foreign cursor leaked")
	}
	for i := 0; i < 52; i++ {
		meteredTask(t, s, f.p, "2000")
	}
	page, c, e := s.Bills(ctx, f.p.ID, "")
	if e != nil || len(page) != 50 || c == nil {
		t.Fatal("page", e)
	}
	rest, next, e := s.Bills(ctx, f.p.ID, *c)
	if e != nil || len(rest) != 3 || next != nil {
		t.Fatal("cursor", e)
	}
	if _, _, e = s.Bills(ctx, f.p.ID, "../../"); !errors.Is(e, ErrValidation) {
		t.Fatal("invalid cursor admitted")
	}
	for _, v := range []string{"=1+2", " +SUM(A1)", "\t@cmd", "-1"} {
		if !strings.HasPrefix(csvCell(v), "'") {
			t.Fatal("CSV injection", v)
		}
	}
}
func TestWorkspaceControlsMFAIdempotencyAndAdmission(t *testing.T) {
	f := workspaceTest(t)
	ctx := context.Background()
	s := f.h.S
	grantCredits(t, &metering.Store{Pool: s.Pool}, f.p, "control-grant", "10000", time.Now().Add(time.Hour))
	task := meteredTask(t, s, f.p, "2000")
	id := newID()
	if _, _, e := s.Claim(ctx, f.p, task.ID, id, id, native()); e != nil {
		t.Fatal(e)
	}
	in := map[string]any{"cloudPaused": true, "salesPaused": true, "announcementZh": "测试维护", "announcementEn": "Test maintenance", "version": "1", "reason": "synthetic controls test"}
	if w := f.ops("POST", "controls", in, "controls-1"); w.Code != 200 {
		t.Fatal("controls", w.Code, w.Body.String())
	}
	if allowed, e := s.RunningAllowed(ctx, f.p, id); e != nil || !allowed {
		t.Fatal("pause interrupted running request", e)
	}
	if _, _, e := s.Claim(ctx, f.p, task.ID, newID(), newID(), native()); !errors.Is(e, ErrUnavailable) {
		t.Fatal("pause admitted claim", e)
	}
	input := taskInput()
	input.Mode = "test-credits"
	input.Budget.MaxCredits = "2000"
	if _, e := s.Create(ctx, f.p, input, newID()); !errors.Is(e, ErrUnavailable) {
		t.Fatal("pause admitted task", e)
	}
	if w := f.ops("POST", "controls", in, "controls-1"); w.Code != 200 || !strings.Contains(w.Body.String(), `"version": "2"`) && !strings.Contains(w.Body.String(), `"version":"2"`) {
		t.Fatal("replay", w.Code)
	}
	if w := f.ops("POST", "controls", in, "controls-2"); w.Code != 409 {
		t.Fatal("stale control accepted", w.Code)
	}
	old := f.csrf
	f.csrf = "wrong"
	if w := f.ops("POST", "controls", in, "controls-3"); w.Code != 403 {
		t.Fatal("CSRF", w.Code)
	}
	f.csrf = old
	cookies := f.cookies
	f.cookies = []*http.Cookie{{Name: "mx_ops", Value: f.token}, {Name: "mx_ops_csrf", Value: strings.Repeat("x", 43)}}
	for _, path := range []string{"users", "audit", "controls", "releases"} {
		if w := f.ops("GET", path, nil, ""); w.Code != 403 {
			t.Fatal("ordinary account admin access", path, w.Code)
		}
	}
	f.cookies = cookies
	if e := s.Finish(ctx, id, "failed", "", 0, false, nil); e != nil {
		t.Fatal("pause broke settlement", e)
	}
	if w := f.user("/v1/models"); w.Code != 200 || !strings.Contains(w.Body.String(), `"enabled":false`) {
		t.Fatal("model availability ignores pause", w.Code)
	}
	if w := f.ops("GET", "audit", nil, ""); w.Code != 200 || !strings.Contains(w.Body.String(), "operations.controls") {
		t.Fatal("control audit missing")
	}
}
func TestWorkspaceUserStatusAndRevocation(t *testing.T) {
	f := workspaceTest(t)
	in := map[string]any{"status": "suspended", "reason": "synthetic account review", "expectedVersion": "1"}
	if w := f.ops("POST", "users/"+f.p.ID+"/status", in, "user-1"); w.Code != 200 {
		t.Fatal("user status", w.Code)
	}
	if w := f.user("/v1/billing/tasks"); w.Code != 401 {
		t.Fatal("suspended session still active", w.Code)
	}
	if w := f.ops("POST", "users/"+f.p.ID+"/status", in, "user-1"); w.Code != 200 {
		t.Fatal("status replay")
	}
	in["status"] = "active"
	if w := f.ops("POST", "users/"+f.p.ID+"/status", in, "user-2"); w.Code != 409 {
		t.Fatal("stale status admitted")
	}
}
func exampleRelease() ReleaseManifest {
	commit := strings.Repeat("a", 40)
	digest := strings.Repeat("b", 64)
	return ReleaseManifest{ID: "1.0.0-beta.1", Tag: "v1.0.0-beta.1", Channel: "beta", Commit: commit, Source: releaseRepo + "/tree/" + commit, Protocol: "m5.5-v1", Database: "005_workspace_ops.sql", NotesZh: "合成发布", NotesEn: "Synthetic release", SkillsSHA256: digest, ModelsSHA256: digest, Assets: []ReleaseAsset{{OS: "macos", Arch: "arm64", Name: "MaterialsX-test.dmg", Size: 1024, SHA256: digest, URL: releaseRepo + "/releases/download/v1.0.0-beta.1/MaterialsX-test.dmg", Signature: "unsigned"}}}
}
func TestReleaseGatesImmutablePublicationAndWithdrawal(t *testing.T) {
	f := workspaceTest(t)
	m := exampleRelease()
	if _, err := f.h.S.Pool.Exec(context.Background(), `INSERT INTO release_registry(id,manifest,state) VALUES('injected','{}','published')`); err == nil {
		t.Fatal("direct published insert admitted")
	}
	in := map[string]any{"action": "draft", "manifest": m, "id": m.ID, "expectedVersion": "0", "reason": "synthetic draft"}
	if w := f.ops("POST", "releases", in, "release-draft"); w.Code != 200 {
		t.Fatal("draft", w.Code, w.Body.String())
	}
	if w := f.user("/v1/releases"); !strings.Contains(w.Body.String(), `"items":[]`) {
		t.Fatal("draft leaked")
	}
	publish := map[string]any{"action": "publish", "manifest": nil, "id": m.ID, "expectedVersion": "1", "reason": "synthetic approved manifest"}
	if w := f.ops("POST", "releases", publish, "release-publish"); w.Code != 409 {
		t.Fatal("missing evidence admitted", w.Code)
	}
	path := filepath.Join(t.TempDir(), "approved.json")
	checks := map[string]bool{}
	for _, k := range []string{"license", "source", "secret_scan", "example_rights", "skills_bundle", "models_catalog", "protocol_compatibility", "database_compatibility", "macos_installation"} {
		checks[k] = true
	}
	b, _ := json.Marshal([]ReleaseApproval{{fingerprint(m), checks, []string{"synthetic-evidence-only"}}})
	os.WriteFile(path, b, 0600)
	f.h.ReleaseEvidencePath = path
	calls := 0
	f.h.releaseVerifier = func(_ context.Context, got ReleaseManifest) error {
		calls++
		if fingerprint(got) != fingerprint(m) {
			return ErrValidation
		}
		return nil
	}
	if w := f.ops("POST", "releases", publish, "release-publish"); w.Code != 200 {
		t.Fatal("approved publish", w.Code, w.Body.String())
	}
	if w := f.user("/v1/releases"); !strings.Contains(w.Body.String(), "MaterialsX-test.dmg") {
		t.Fatal("public catalog missing")
	}
	if _, e := f.h.S.Pool.Exec(context.Background(), `UPDATE release_registry SET manifest='{}'::jsonb WHERE id=$1`, m.ID); e == nil {
		t.Fatal("published manifest changed")
	}
	withdraw := map[string]any{"action": "withdraw", "manifest": nil, "id": m.ID, "expectedVersion": "2", "reason": "synthetic withdrawal"}
	if w := f.ops("POST", "releases", withdraw, "release-withdraw"); w.Code != 200 {
		t.Fatal("withdraw", w.Code)
	}
	if w := f.user("/v1/releases"); !strings.Contains(w.Body.String(), `"items":[]`) {
		t.Fatal("withdrawn release visible")
	}
	f.h.ReleaseEvidencePath = "missing"
	if w := f.ops("POST", "releases", publish, "release-publish"); w.Code != 200 || calls != 1 {
		t.Fatal("replay consulted remote again", w.Code, calls)
	}
	if w := f.ops("GET", "releases", nil, ""); !strings.Contains(w.Body.String(), "withdrawn") {
		t.Fatal("withdrawal history missing")
	}
	stable := m
	stable.Channel = "stable"
	if stable.validate() == nil {
		t.Fatal("unsigned stable admitted")
	}
	bad := m
	bad.Assets = append([]ReleaseAsset{}, m.Assets...)
	bad.Assets[0].URL = "https://foreign.test/installer"
	if bad.validate() == nil {
		t.Fatal("foreign download admitted")
	}
	bad = m
	bad.ModelsSHA256 = strings.Repeat("c", 64)
	if approvedRelease(path, bad) == nil {
		t.Fatal("approval reused for changed bundle")
	}
}
func TestAdminStaticRootBoundary(t *testing.T) {
	f := workspaceTest(t)
	dir := t.TempDir()
	os.Mkdir(filepath.Join(dir, "assets"), 0700)
	os.WriteFile(filepath.Join(dir, "index.html"), []byte(`<title>MaterialsX operations</title><script src="/ops/assets/app.js"></script>`), 0600)
	os.WriteFile(filepath.Join(dir, "assets", "app.js"), []byte("export const fixture=true"), 0600)
	outside := filepath.Join(t.TempDir(), "private.txt")
	os.WriteFile(outside, []byte("not-for-browser"), 0600)
	os.Symlink(outside, filepath.Join(dir, "assets", "escape.txt"))
	if e := f.h.ConfigureWorkspace(dir, ""); e != nil {
		t.Fatal(e)
	}
	defer f.h.AdminAssets.Close()
	for _, path := range []string{"/ops", "/ops/assets/app.js"} {
		w := f.user(path)
		if w.Code != 200 {
			t.Fatal("bundle", path, w.Code)
		}
	}
	for _, path := range []string{"/ops/assets/escape.txt", "/ops/assets/"} {
		w := f.user(path)
		if w.Code != 404 || strings.Contains(w.Body.String(), "not-for-browser") {
			t.Fatal("static escape", path, w.Code)
		}
	}
}

func TestSalesPauseKeepsExistingOrderAndSettlement(t *testing.T) {
	f := workspaceTest(t)
	ctx := context.Background()
	tx, e := f.h.S.Pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback(ctx)
	product := payments.Product{ID: "pause-pack", Name: "Synthetic pause pack", Kind: "pack", Currency: "CNY", PriceFen: "100", Credits: "1000", ValidDays: 30, RefundPolicyVersion: "test-v1", RefundRule: "unused-proportional-v1", TestOnly: true, DailyLimit: "1000", MonthlyLimit: "1000", RequestLimit: 10}
	if e = payments.PutProduct(ctx, tx, product); e != nil {
		t.Fatal(e)
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	order, e := f.h.Payments.Create(ctx, f.p.ID, "original-order", product.ID)
	if e != nil {
		t.Fatal(e)
	}
	body := map[string]any{"cloudPaused": false, "salesPaused": true, "announcementZh": "", "announcementEn": "", "version": "1", "reason": "synthetic sales pause"}
	if w := f.ops("POST", "controls", body, "sales-pause"); w.Code != 200 {
		t.Fatal("pause", w.Code)
	}
	if _, e = f.h.Payments.Create(ctx, f.p.ID, "new-order", product.ID); !errors.Is(e, payments.ErrDisabled) {
		t.Fatal("new sale admitted", e)
	}
	replay, e := f.h.Payments.Create(ctx, f.p.ID, "original-order", product.ID)
	if e != nil || replay.ID != order.ID {
		t.Fatal("existing order replay blocked", e)
	}
	provider := f.h.Payments.Provider.(*payments.TestProvider)
	provider.Simulate(order.ID)
	ev, e := provider.Query(ctx, order)
	if e != nil {
		t.Fatal(e)
	}
	if e = f.h.Payments.ApplyPayment(ctx, ev); e != nil {
		t.Fatal("pause stopped settlement", e)
	}
	settled, e := f.h.Payments.Order(ctx, f.p.ID, order.ID)
	if e != nil || settled.State != "paid" {
		t.Fatal("payment lost", e)
	}
}

type releaseRoundTrip func(*http.Request) (*http.Response, error)

func (f releaseRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestPublicGitHubVerificationFailsClosed(t *testing.T) {
	m := exampleRelease()
	mode := "valid"
	old := http.DefaultTransport
	defer func() { http.DefaultTransport = old }()
	http.DefaultTransport = releaseRoundTrip(func(r *http.Request) (*http.Response, error) {
		if r.Method != "GET" || r.URL.Host != "api.github.com" || r.Header.Get("Authorization") != "" {
			t.Fatal("verification scope escaped")
		}
		body := map[string]any{"sha": m.Commit}
		status := 200
		if strings.Contains(r.URL.Path, "releases/tags/") {
			body = map[string]any{"tag_name": m.Tag, "draft": false, "prerelease": true, "immutable": true, "published_at": "2026-10-01T00:00:00Z", "html_url": releaseRepo + "/releases/tag/" + m.Tag, "assets": []any{map[string]any{"name": m.Assets[0].Name, "size": m.Assets[0].Size, "digest": "sha256:" + m.Assets[0].SHA256, "browser_download_url": m.Assets[0].URL, "state": "uploaded"}}}
			switch mode {
			case "draft":
				body["draft"] = true
			case "mutable":
				body["immutable"] = false
			case "unpublished":
				body["published_at"] = nil
			case "wrong-channel":
				body["prerelease"] = false
			case "bad-digest":
				body["assets"].([]any)[0].(map[string]any)["digest"] = ""
			case "bad-url":
				body["assets"].([]any)[0].(map[string]any)["browser_download_url"] = "https://foreign.test/installer"
			case "private":
				status = 404
			case "redirect":
				status = 302
			}
		}
		if mode == "wrong-commit" && strings.Contains(r.URL.Path, "commits/") {
			body["sha"] = strings.Repeat("c", 40)
		}
		b, _ := json.Marshal(body)
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(string(b)))}, nil
	})
	if e := verifyPublicRelease(context.Background(), m); e != nil {
		t.Fatal("valid public metadata rejected", e)
	}
	for _, bad := range []string{"draft", "mutable", "unpublished", "wrong-channel", "bad-digest", "bad-url", "wrong-commit", "private", "redirect"} {
		mode = bad
		if e := verifyPublicRelease(context.Background(), m); !errors.Is(e, ErrReleaseRemote) {
			t.Fatal("bad remote metadata admitted", bad, e)
		}
	}
}

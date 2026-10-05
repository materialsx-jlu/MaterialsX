package gateway

import (
	"context"
	"encoding/json"
	"github.com/jamip/materialsx/control-plane/internal/delivery"
	"github.com/jamip/materialsx/control-plane/internal/lifecycle"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCounterRejectsChangedArtifactInvalidRouteAndHugeCounts(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "counter")
	script := `#!/bin/sh
cat >/dev/null
printf '%s' '{"version":"mx-input-count-v1","routeVersionId":"rootflow-sol-responses-2026-10-01-v1","inputTokens":123,"evidenceRef":"synthetic-count-fixture"}'
`
	os.WriteFile(p, []byte(script), 0700)
	counter := CommandCounter{Program: p, SHA256: delivery.ID(script)}
	n, ev, e := counter.Count(context.Background(), map[string]any{"input": "fixture"})
	if e != nil || n != 123 || ev != "synthetic-count-fixture" {
		t.Fatal(n, ev, e)
	}
	counter.SHA256 = strings.Repeat("0", 64)
	if _, _, e = counter.Count(context.Background(), map[string]any{}); e == nil {
		t.Fatal("changed artifact accepted")
	}
	script = strings.Replace(script, `"inputTokens":123`, `"inputTokens":131073`, 1)
	os.WriteFile(p, []byte(script), 0700)
	counter.SHA256 = delivery.ID(script)
	if _, _, e = counter.Count(context.Background(), map[string]any{}); e == nil {
		t.Fatal("over-ceiling count accepted")
	}
}
func TestApprovalExpiryAndMissingEvidenceNeverPass(t *testing.T) {
	now := time.Now().UTC()
	a := lifecycle.Approvals{Version: "m5-beta-approval-v1", RouteVersion: RouteVersion, RefundRule: "unused-full-v1"}
	for _, id := range lifecycle.RequiredGates {
		a.Gates = append(a.Gates, lifecycle.Gate{ID: id, EvidenceRef: "synthetic-evidence", SHA256: strings.Repeat("a", 64), ApprovedBy: "synthetic-reviewer", ApprovedAt: now.Add(-time.Hour), ExpiresAt: now.Add(time.Hour)})
	}
	if len(a.Missing(now)) != 0 {
		t.Fatal("synthetic gates rejected")
	}
	if len(a.Missing(now.Add(2*time.Hour))) != len(lifecycle.RequiredGates) {
		t.Fatal("expired gates allowed")
	}
	p := filepath.Join(t.TempDir(), "approvals.json")
	raw, _ := json.Marshal(a)
	os.WriteFile(p, raw, 0600)
	if _, e := lifecycle.ReadApprovals(p, RouteVersion); e != nil {
		t.Fatal(e)
	}
	os.Chmod(p, 0644)
	if _, e := lifecycle.ReadApprovals(p, RouteVersion); e == nil {
		t.Fatal("public writable/readable approval accepted")
	}
}

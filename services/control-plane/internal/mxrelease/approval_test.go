package mxrelease

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func fixture(t *testing.T) (string, Approval, string) {
	t.Helper()
	dir := t.TempDir()
	now := time.Now().UTC()
	a := Approval{SchemaVersion: "mx-production-release-v1", ReleaseID: PriceVersion, PriceVersion: PriceVersion,
		APIOrigin: "https://api.fixture-materialsx.org", MerchantID: "1900000000", RefundRule: "unused-full-v1",
		ExpiresAt: now.Add(24 * time.Hour), Routes: []Route{{"gpt-5.6-sol", "mx03-gpt56-litellm-responses-20261007-v1"}}}
	first := ""
	for _, kind := range required {
		path := filepath.Join(dir, kind+".txt")
		body := []byte("reviewed fixture: " + kind)
		if err := os.WriteFile(path, body, 0600); err != nil {
			t.Fatal(err)
		}
		if first == "" {
			first = path
		}
		h := sha256.Sum256(body)
		a.Evidence = append(a.Evidence, Evidence{Kind: kind, Path: path, SHA256: hex.EncodeToString(h[:]), ApprovedBy: "fixture-reviewer", ApprovedAt: now.Add(-time.Hour)})
	}
	return filepath.Join(dir, "approval.json"), a, first
}

func save(t *testing.T, path string, a Approval) {
	t.Helper()
	body, err := json.Marshal(a)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, body, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestProductionApprovalRequiresActualEvidenceAndExactRoute(t *testing.T) {
	path, a, evidence := fixture(t)
	save(t, path, a)
	got, err := Read(path, time.Now().UTC())
	if err != nil || !got.Allows("gpt-5.6-sol", "mx03-gpt56-litellm-responses-20261007-v1") || got.Allows("gpt-5.6-sol", "other") {
		t.Fatalf("valid approval or route failed: %v", err)
	}
	if err := os.WriteFile(evidence, []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Read(path, time.Now().UTC()); err == nil {
		t.Fatal("changed evidence left sales open")
	}
}

func TestProductionApprovalFailsClosed(t *testing.T) {
	path, a, _ := fixture(t)
	for name, change := range map[string]func(*Approval){
		"expired":         func(v *Approval) { v.ExpiresAt = time.Now().Add(-time.Second) },
		"wrong price":     func(v *Approval) { v.PriceVersion = "wrong" },
		"duplicate gate":  func(v *Approval) { v.Evidence[1].Kind = v.Evidence[0].Kind },
		"duplicate route": func(v *Approval) { v.Routes = append(v.Routes, v.Routes[0]) },
		"localhost":       func(v *Approval) { v.APIOrigin = "https://localhost" },
	} {
		t.Run(name, func(t *testing.T) {
			copy := a
			copy.Evidence = append([]Evidence(nil), a.Evidence...)
			copy.Routes = append([]Route(nil), a.Routes...)
			change(&copy)
			save(t, path, copy)
			if _, err := Read(path, time.Now().UTC()); err == nil {
				t.Fatal("unapproved release accepted")
			}
		})
	}
	save(t, path, a)
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := Read(path, time.Now().UTC()); err == nil {
		t.Fatal("public approval accepted")
	}
	if err := os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"schemaVersion":"mx-production-release-v1","schemaVersion":"mx-production-release-v1"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Read(path, time.Now().UTC()); err == nil {
		t.Fatal("duplicate approval field accepted")
	}
}

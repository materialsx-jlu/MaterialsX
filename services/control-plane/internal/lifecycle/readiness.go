package lifecycle

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"
)

var RequiredGates = []string{"deployment", "email", "procurement", "input-metering", "wechat-payment-refund", "privacy-retention", "restore", "capacity", "materials-quality", "macos-signing", "windows-install"}

type Gate struct {
	ID          string    `json:"id"`
	EvidenceRef string    `json:"evidenceRef"`
	SHA256      string    `json:"sha256"`
	ApprovedBy  string    `json:"approvedBy"`
	ApprovedAt  time.Time `json:"approvedAt"`
	ExpiresAt   time.Time `json:"expiresAt"`
}
type Approvals struct {
	Version      string `json:"version"`
	RouteVersion string `json:"routeVersionId"`
	RefundRule   string `json:"refundRule"`
	Gates        []Gate `json:"gates"`
}
type Readiness struct {
	Ready         bool     `json:"ready"`
	Missing       []string `json:"missing"`
	RefundRule    string   `json:"refundRule"`
	WorkerHealthy bool     `json:"workerHealthy"`
}

func ReadApprovals(path, route string) (Approvals, error) {
	var a Approvals
	if !filepath.IsAbs(path) {
		return a, errors.New("absolute_approval_path_required")
	}
	f, e := os.Open(path)
	if e != nil {
		return a, e
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return a, errors.New("private_approvals_required")
	}
	d := json.NewDecoder(io.LimitReader(f, 65536))
	d.DisallowUnknownFields()
	if d.Decode(&a) != nil || d.Decode(new(any)) != io.EOF || a.Version != "m5-beta-approval-v1" || a.RouteVersion != route || a.RefundRule != "unused-full-v1" {
		return a, errors.New("invalid_approvals")
	}
	return a, nil
}
func (a Approvals) Missing(now time.Time) []string {
	missing := []string{}
	for _, id := range RequiredGates {
		valid := false
		for _, g := range a.Gates {
			if g.ID == id && clean(g.EvidenceRef, 256) && sha.MatchString(g.SHA256) && clean(g.ApprovedBy, 100) && !g.ApprovedAt.After(now) && g.ExpiresAt.After(now) && g.ExpiresAt.Sub(g.ApprovedAt) <= 90*24*time.Hour {
				valid = true
			}
		}
		if !valid {
			missing = append(missing, id)
		}
	}
	return missing
}
func (s Store) Readiness(ctx context.Context, path, route string) (Readiness, error) {
	v := Readiness{RefundRule: "unused-full-v1", Missing: append([]string{}, RequiredGates...)}
	if path != "" {
		a, e := ReadApprovals(path, route)
		if e != nil {
			return v, e
		}
		v.Missing = a.Missing(time.Now().UTC())
	}
	e := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM worker_heartbeats WHERE name='billing' AND touched_at>clock_timestamp()-interval '60 seconds')`).Scan(&v.WorkerHealthy)
	v.Ready = e == nil && v.WorkerHealthy && len(v.Missing) == 0
	return v, e
}

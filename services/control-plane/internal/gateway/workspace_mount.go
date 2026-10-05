package gateway

import (
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (h *HTTP) mountWorkspace() {
	p := h.Identity
	p.Mount("GET /v1/workspace/status", h.workspaceStatus)
	p.Mount("GET /v1/billing/activity", h.activity)
	p.Mount("GET /v1/billing/tasks", h.taskBills)
	p.Mount("GET /v1/billing/tasks/export", h.taskBillsExport)
	p.Mount("GET /v1/releases", h.releases)
	p.Mount("GET /ops/api/users", h.opsUsers)
	p.Mount("POST /ops/api/users/{id}/status", h.opsUserStatus)
	p.Mount("GET /ops/api/audit", h.opsAudit)
	p.Mount("GET /ops/api/controls", h.opsControls)
	p.Mount("POST /ops/api/controls", h.opsControls)
	p.Mount("GET /ops/api/releases", h.releases)
	p.Mount("POST /ops/api/releases", h.releaseMutation)
	p.Mount("GET /ops/assets/{path...}", h.opsAsset)
}

// Called once on startup with an explicit deployment directory; path traversal and symlink escape are blocked by os.Root.
func (h *HTTP) ConfigureWorkspace(assetDir, evidencePath string) error {
	if assetDir != "" {
		if !filepath.IsAbs(assetDir) {
			return ErrValidation
		}
		root, e := os.OpenRoot(assetDir)
		if e != nil {
			return e
		}
		f, e := root.Open("index.html")
		if e != nil {
			root.Close()
			return e
		}
		info, e := f.Stat()
		f.Close()
		if e != nil || !info.Mode().IsRegular() {
			root.Close()
			return ErrValidation
		}
		h.AdminAssets = root
	}
	if evidencePath != "" && !filepath.IsAbs(evidencePath) {
		return ErrValidation
	}
	h.ReleaseEvidencePath = evidencePath
	return nil
}
func (h *HTTP) opsAsset(w http.ResponseWriter, r *http.Request) {
	if h.AdminAssets == nil {
		http.NotFound(w, r)
		return
	}
	p := "assets/" + r.PathValue("path")
	if !fs.ValidPath(p) || strings.Contains(p, "\\") {
		http.NotFound(w, r)
		return
	}
	f, e := h.AdminAssets.Open(p)
	if e != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Security-Policy", "default-src 'none'")
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

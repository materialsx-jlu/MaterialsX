package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const releaseRepo = "https://github.com/materialsx-jlu/MaterialsX"

var semver = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$`)
var sha256Pattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
var commitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
var assetPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,160}$`)

type ReleaseAsset struct {
	OS        string `json:"os"`
	Arch      string `json:"arch"`
	Name      string `json:"name"`
	Size      int64  `json:"sizeBytes,string"`
	SHA256    string `json:"sha256"`
	URL       string `json:"downloadUrl"`
	Signature string `json:"signature"`
}
type ReleaseManifest struct {
	ID           string         `json:"id"`
	Channel      string         `json:"channel"`
	Tag          string         `json:"tag"`
	Commit       string         `json:"commit"`
	Source       string         `json:"sourceUrl"`
	Protocol     string         `json:"minimumProtocol"`
	Database     string         `json:"databaseMigration"`
	NotesZh      string         `json:"notesZh"`
	NotesEn      string         `json:"notesEn"`
	SkillsSHA256 string         `json:"skillsSha256"`
	ModelsSHA256 string         `json:"modelsSha256"`
	Assets       []ReleaseAsset `json:"assets"`
}
type Release struct {
	Manifest ReleaseManifest `json:"manifest"`
	State    string          `json:"state"`
	Version  int64           `json:"version,string"`
	Created  time.Time       `json:"createdAt"`
	Verified *time.Time      `json:"verifiedAt"`
}

func (m ReleaseManifest) validate() error {
	if !semver.MatchString(m.ID) || m.Tag != "v"+m.ID || (m.Channel != "stable" && m.Channel != "beta") || !commitPattern.MatchString(m.Commit) || m.Source != releaseRepo+"/tree/"+m.Commit || !((m.Protocol == "m5.5-v1" && m.Database == "005_workspace_ops.sql") || (m.Protocol == "m5.5-v2" && m.Database == "007_paid_consumption.sql") || (m.Protocol == "m5.6-v1" && m.Database == "010_email_serialization.sql")) || len(strings.TrimSpace(m.NotesZh)) == 0 || len(strings.TrimSpace(m.NotesEn)) == 0 || len(m.NotesZh) > 12000 || len(m.NotesEn) > 12000 || !sha256Pattern.MatchString(m.SkillsSHA256) || !sha256Pattern.MatchString(m.ModelsSHA256) || len(m.Assets) == 0 || len(m.Assets) > 4 {
		return ErrValidation
	}
	if m.Channel == "stable" && strings.Contains(m.ID, "-") {
		return ErrValidation
	}
	names := map[string]bool{}
	targets := map[string]bool{}
	for _, a := range m.Assets {
		target := a.OS + "-" + a.Arch
		if (target != "macos-arm64" && target != "windows-x64") || names[a.Name] || targets[target] || !assetPattern.MatchString(a.Name) || a.Size <= 0 || a.Size > 8*1024*1024*1024 || !sha256Pattern.MatchString(a.SHA256) || a.URL != releaseRepo+"/releases/download/"+m.Tag+"/"+a.Name || (a.Signature != "verified" && a.Signature != "unsigned") || (m.Channel == "stable" && a.Signature != "verified") {
			return ErrValidation
		}
		if (a.OS == "macos" && !strings.HasSuffix(a.Name, ".dmg")) || (a.OS == "windows" && !strings.HasSuffix(a.Name, ".exe")) {
			return ErrValidation
		}
		names[a.Name] = true
		targets[target] = true
	}
	if m.Channel == "stable" && len(targets) != 2 {
		return ErrValidation
	}
	return nil
}

// A deployment-owned file grants gates to one exact manifest hash. Browser input cannot mark gates as passed.
type ReleaseApproval struct {
	ManifestSHA256 string          `json:"manifestSha256"`
	Checks         map[string]bool `json:"checks"`
	EvidenceRefs   []string        `json:"evidenceRefs"`
}

func approvedRelease(path string, m ReleaseManifest) error {
	f, e := os.Open(path)
	if e != nil {
		return ErrReleaseGates
	}
	defer f.Close()
	var entries []ReleaseApproval
	d := json.NewDecoder(io.LimitReader(f, 1024*1024+1))
	d.DisallowUnknownFields()
	if d.Decode(&entries) != nil || d.Decode(new(any)) != io.EOF || len(entries) > 100 {
		return ErrReleaseGates
	}
	required := []string{"license", "source", "secret_scan", "example_rights", "skills_bundle", "models_catalog", "protocol_compatibility", "database_compatibility"}
	for _, a := range m.Assets {
		required = append(required, a.OS+"_installation")
		if a.Signature == "verified" {
			required = append(required, a.OS+"_signature")
		}
		if m.Channel == "stable" && a.OS == "macos" {
			required = append(required, "macos_notarization")
		}
	}
	for _, entry := range entries {
		if entry.ManifestSHA256 != fingerprint(m) {
			continue
		}
		if len(entry.EvidenceRefs) == 0 || len(entry.EvidenceRefs) > 30 {
			return ErrReleaseGates
		}
		for _, ref := range entry.EvidenceRefs {
			if !identifier.MatchString(ref) {
				return ErrReleaseGates
			}
		}
		for _, name := range required {
			if !entry.Checks[name] {
				return ErrReleaseGates
			}
		}
		return nil
	}
	return ErrReleaseGates
}
func githubJSON(ctx context.Context, path string, v any) error {
	req, e := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/repos/materialsx-jlu/MaterialsX/"+path, nil)
	if e != nil {
		return ErrReleaseRemote
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2026-03-10")
	req.Header.Set("User-Agent", "MaterialsX-release-verifier")
	client := http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirect refused") }}
	res, e := client.Do(req)
	if e != nil {
		return ErrReleaseRemote
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return ErrReleaseRemote
	}
	if json.NewDecoder(io.LimitReader(res.Body, 1024*1024)).Decode(v) != nil {
		return ErrReleaseRemote
	}
	return nil
}
func verifyPublicRelease(ctx context.Context, m ReleaseManifest) error {
	var r struct {
		Tag       string     `json:"tag_name"`
		Draft     bool       `json:"draft"`
		Pre       bool       `json:"prerelease"`
		Immutable bool       `json:"immutable"`
		Published *time.Time `json:"published_at"`
		URL       string     `json:"html_url"`
		Assets    []struct {
			Name   string `json:"name"`
			Size   int64  `json:"size"`
			Digest string `json:"digest"`
			URL    string `json:"browser_download_url"`
			State  string `json:"state"`
		} `json:"assets"`
	}
	if githubJSON(ctx, "releases/tags/"+url.PathEscape(m.Tag), &r) != nil || r.Tag != m.Tag || r.Draft || !r.Immutable || r.Published == nil || r.Pre != (m.Channel == "beta") || r.URL != releaseRepo+"/releases/tag/"+m.Tag {
		return ErrReleaseRemote
	}
	var c struct {
		SHA string `json:"sha"`
	}
	if githubJSON(ctx, "commits/"+url.PathEscape(m.Tag), &c) != nil || c.SHA != m.Commit {
		return ErrReleaseRemote
	}
	for _, want := range m.Assets {
		found := false
		for _, have := range r.Assets {
			if have.Name == want.Name && have.Size == want.Size && have.Digest == "sha256:"+want.SHA256 && have.URL == want.URL && have.State == "uploaded" {
				found = true
				break
			}
		}
		if !found {
			return ErrReleaseRemote
		}
	}
	return nil
}
func (h *HTTP) releases(w http.ResponseWriter, r *http.Request) {
	admin := strings.HasPrefix(r.URL.Path, "/ops/")
	if admin {
		if _, ok := h.opsAuthorized(w, r); !ok {
			return
		}
	}
	rows, e := h.S.Pool.Query(r.Context(), `SELECT manifest,state,version,created_at,verified_at FROM release_registry WHERE ($1 OR state='published') ORDER BY created_at DESC,id DESC LIMIT 100`, admin)
	if e != nil {
		fail(w, e)
		return
	}
	defer rows.Close()
	items := []Release{}
	for rows.Next() {
		var v Release
		var b []byte
		if e = rows.Scan(&b, &v.State, &v.Version, &v.Created, &v.Verified); e != nil {
			fail(w, e)
			return
		}
		if e = json.Unmarshal(b, &v.Manifest); e != nil {
			fail(w, e)
			return
		}
		v.Created = v.Created.UTC()
		if v.Verified != nil {
			u := v.Verified.UTC()
			v.Verified = &u
		}
		items = append(items, v)
	}
	if e = rows.Err(); e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
func (h *HTTP) releaseMutation(w http.ResponseWriter, r *http.Request) {
	clone, ok := h.opsAuthorized(w, r)
	if !ok || !operation(w, r) {
		return
	}
	p, ok := h.admin(w, clone)
	if !ok {
		return
	}
	var in struct {
		Action   string           `json:"action"`
		Manifest *ReleaseManifest `json:"manifest"`
		ID       string           `json:"id"`
		Version  int64            `json:"expectedVersion,string"`
		Reason   string           `json:"reason"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(strings.TrimSpace(in.Reason)) < 1 || len(in.Reason) > 256 || (in.Action != "draft" && in.Action != "publish" && in.Action != "withdraw") {
		fail(w, ErrValidation)
		return
	}
	if in.Action == "draft" {
		if in.Manifest == nil || in.Manifest.validate() != nil || in.ID != in.Manifest.ID || in.Version != 0 {
			fail(w, ErrValidation)
			return
		}
	} else if in.Manifest != nil || !semver.MatchString(in.ID) || in.Version < 1 {
		fail(w, ErrValidation)
		return
	}
	// Successful replays do not depend on a later GitHub outage or withdrawn catalogue entry.
	var priorFP string
	var priorBody []byte
	err := h.S.Pool.QueryRow(r.Context(), `SELECT fingerprint,response FROM workspace_operations WHERE actor_id=$1 AND operation_key=$2`, p.ID, r.Header.Get("Idempotency-Key")).Scan(&priorFP, &priorBody)
	if err == nil {
		if priorFP != fingerprint([]any{"release", in}) {
			fail(w, ErrIdempotency)
			return
		}
		writeJSON(w, 200, json.RawMessage(priorBody))
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		fail(w, err)
		return
	}
	// Validate evidence/network without holding account locks. The subsequent version check binds the exact immutable draft.
	var manifest ReleaseManifest
	if in.Action == "publish" {
		var b []byte
		if e := h.S.Pool.QueryRow(r.Context(), `SELECT manifest FROM release_registry WHERE id=$1`, in.ID).Scan(&b); e != nil {
			fail(w, ErrNotFound)
			return
		}
		if json.Unmarshal(b, &manifest) != nil || manifest.validate() != nil || approvedRelease(h.ReleaseEvidencePath, manifest) != nil {
			fail(w, ErrReleaseGates)
			return
		}
		verify := h.releaseVerifier
		if verify == nil {
			verify = verifyPublicRelease
		}
		if e := verify(r.Context(), manifest); e != nil {
			fail(w, e)
			return
		}
	}
	tx, e := h.S.Pool.Begin(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	if e = h.liveAdmin(r.Context(), tx, p); e != nil {
		fail(w, e)
		return
	}
	key := r.Header.Get("Idempotency-Key")
	fp := fingerprint([]any{"release", in})
	old, e := priorOperation(r.Context(), tx, p, key, fp)
	if e != nil {
		fail(w, e)
		return
	}
	if old != nil {
		writeJSON(w, 200, old)
		return
	}
	state := "draft"
	version := int64(1)
	if in.Action == "draft" {
		b, _ := json.Marshal(in.Manifest)
		_, e = tx.Exec(r.Context(), `INSERT INTO release_registry(id,manifest,state) VALUES($1,$2,'draft')`, in.ID, b)
		if e != nil {
			e = ErrConflict
		}
	} else {
		from := "draft"
		state = "published"
		if in.Action == "withdraw" {
			from = "published"
			state = "withdrawn"
		}
		tag, err := tx.Exec(r.Context(), `UPDATE release_registry SET state=$2,version=version+1,verified_at=CASE WHEN $2='published' THEN clock_timestamp() ELSE verified_at END WHERE id=$1 AND state=$3 AND version=$4`, in.ID, state, from, in.Version)
		e = err
		if e == nil && tag.RowsAffected() != 1 {
			e = ErrConflict
		}
		version = in.Version + 1
	}
	result := map[string]any{"id": in.ID, "state": state, "version": strconv.FormatInt(version, 10)}
	if e == nil {
		e = recordOperation(r.Context(), tx, p, key, fp, "release."+in.Action, in.ID, in.Reason, result)
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, result)
}

// ReleaseManifestHash binds deployment gate approvals to the validated, canonical Go wire manifest.
func ReleaseManifestHash(m ReleaseManifest) (string, error) {
	if e := m.validate(); e != nil {
		return "", e
	}
	return fingerprint(m), nil
}

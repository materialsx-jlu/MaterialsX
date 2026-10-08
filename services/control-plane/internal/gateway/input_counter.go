package gateway

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// A route-specific, operator-reviewed local adapter. It must count the complete
// native envelope (instructions, tools, history and provider overhead), not text alone.
// No unverified tokenizer or byte estimate is silently substituted.
type InputCounter interface {
	Count(context.Context, map[string]any) (int64, string, error)
}
type CommandCounter struct{ Program, SHA256 string }
type boundedOutput struct{ bytes.Buffer }

func (b *boundedOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 4096 {
		return 0, errors.New("counter_output_limit")
	}
	return b.Buffer.Write(p)
}
func (c CommandCounter) Count(ctx context.Context, payload map[string]any) (int64, string, error) {
	if !filepath.IsAbs(c.Program) || len(c.SHA256) != 64 {
		return 0, "", ErrValidation
	}
	info, e := os.Lstat(c.Program)
	if e != nil || !info.Mode().IsRegular() || info.Mode()&0022 != 0 || info.Size() > 64*1024*1024 {
		return 0, "", ErrValidation
	}
	f, e := os.Open(c.Program)
	if e != nil {
		return 0, "", ErrUnavailable
	}
	h := sha256.New()
	_, e = io.Copy(h, f)
	f.Close()
	if e != nil || hex.EncodeToString(h.Sum(nil)) != c.SHA256 {
		return 0, "", ErrUnavailable
	}
	body := map[string]any{}
	for k, v := range payload {
		body[k] = v
	}
	body["model"] = "gpt-5.6-sol"
	raw, e := json.Marshal(map[string]any{"version": "mx-input-count-v1", "routeVersionId": RouteVersion, "payload": body})
	if e != nil || len(raw) > 32768 {
		return 0, "", ErrValidation
	}
	call, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(call, c.Program)
	cmd.Stdin = bytes.NewReader(raw)
	cmd.Env = []string{"PATH=/usr/bin:/bin"}
	var out boundedOutput
	cmd.Stdout = &out
	cmd.Stderr = io.Discard
	if e = cmd.Run(); e != nil {
		return 0, "", ErrUnavailable
	}
	var result struct {
		Version  string `json:"version"`
		Route    string `json:"routeVersionId"`
		Input    int64  `json:"inputTokens"`
		Evidence string `json:"evidenceRef"`
	}
	d := json.NewDecoder(&out)
	d.DisallowUnknownFields()
	if d.Decode(&result) != nil || d.Decode(new(any)) != io.EOF || result.Version != "mx-input-count-v1" || result.Route != RouteVersion || result.Input < 1 || result.Input > 131072 || !identifier.MatchString(result.Evidence) {
		return 0, "", ErrValidation
	}
	return result.Input, result.Evidence, nil
}

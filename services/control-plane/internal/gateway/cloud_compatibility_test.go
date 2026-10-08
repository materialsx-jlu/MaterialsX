package gateway

import (
	"context"
	"encoding/json"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRegisteredResearchToolsAndNoDispatch(t *testing.T) {
	for name := range admittedToolNames {
		if name == "agent_exec" || name == "agent_wait" || name == "materials_science" || name == "bash" {
			continue
		}
		p := native()
		p["tools"] = []any{map[string]any{"type": "function", "name": name, "description": "Client-only fixture", "parameters": map[string]any{"type": "object"}}}
		if err := ValidateNative(p, 8192); err != nil {
			t.Fatalf("registered tool %s rejected: %v", name, err)
		}
	}
	p := native()
	p["tools"] = []any{map[string]any{"type": "function", "name": "arbitrary_remote_execution", "description": "fixture", "parameters": map[string]any{"type": "object"}}}
	if ValidateNative(p, 8192) == nil {
		t.Fatal("unknown tool accepted")
	}
	w := httptest.NewRecorder()
	fail(w, ErrValidation, true)
	var e map[string]any
	if json.Unmarshal(w.Body.Bytes(), &e) != nil || e["error"].(map[string]any)["dispatched"] != false {
		t.Fatal("missing admission proof")
	}
}

func TestUnlimitedTaskBeyondFormerRequestCeilings(t *testing.T) {
	pool := poolFixture(t)
	ctx := context.Background()
	ident, e := identity.New(pool, []byte(strings.Repeat("C", 32)))
	if e != nil {
		t.Fatal(e)
	}
	p, _ := principal(t, ident)
	s := &Store{Pool: pool, Config: Config{Enabled: true, MaxRequests: 0, MaxOutputTokens: 8192, MaxDurationSeconds: 3600, MaxConcurrent: 0}}
	if e = s.Grant(ctx, p.ID, 100, time.Now().Add(time.Hour)); e != nil {
		t.Fatal(e)
	}
	in := taskInput()
	in.Budget = Limits{MaxRequests: 0, MaxOutput: 8192, MaxDuration: 3600}
	task, e := s.Create(ctx, p, in, newID())
	if e != nil {
		t.Fatal(e)
	}
	var last string
	for i := 0; i < 40; i++ {
		id := newID()
		if _, _, e = s.Claim(ctx, p, task.ID, id, id, native()); e != nil {
			t.Fatalf("request %d: %v", i, e)
		}
		usage := rootflow.Usage{Source: "responses", Input: numCloud(10), Output: numCloud(4), Cached: numCloud(2), Uncached: numCloud(8), Reasoning: numCloud(1)}
		if e = s.Finish(ctx, id, "completed", "", 200, true, &usage); e != nil {
			t.Fatal(e)
		}
		last = id
	}
	got, e := s.Task(ctx, p.ID, task.ID)
	if e != nil || got.Requests != 40 {
		t.Fatal(got, e)
	}
	if _, _, e = s.Claim(ctx, p, task.ID, last, last, native()); e == nil {
		t.Fatal("duplicate request replay allowed")
	}
	// A frozen finite budget remains authoritative even on an unlimited server.
	in = taskInput()
	limited, e := s.Create(ctx, p, in, newID())
	if e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `UPDATE research_tasks SET request_count=max_requests WHERE id=$1`, limited.ID); e != nil {
		t.Fatal(e)
	}
	id := newID()
	if _, _, e = s.Claim(ctx, p, limited.ID, id, id, native()); e != ErrBudget {
		t.Fatal("finite budget bypassed", e)
	}
}
func numCloud(n int64) *int64 { return &n }

package main

import "testing"

func TestScienceFixtureReadsOnlyLatestToolOutput(t *testing.T) {
	scope := map[string]any{"role": "developer", "content": `Approved scope {"structureId":"synthetic-si"}`}
	selection := map[string]any{"type": "function_call_output", "output": `{"id":"assessment","selection":{"candidates":[{"potentialId":"chgnet-0.3.0","evidenceIds":["runtime:chgnet-0.3.0"]}]}}`}
	started := map[string]any{"type": "function_call_output", "output": `{"runId":"run","status":"queued"}`}
	p := map[string]any{"input": []any{scope, selection, started}}
	args, ok := scienceCall(p)
	if !ok || args["action"] != "get" || args["targetId"] != "run" {
		t.Fatal("fixture repeated an earlier selection instead of reading the latest job")
	}
	finished := map[string]any{"type": "function_call_output", "output": `{"runId":"run","status":"completed","result":{"energyEv":-42.5}}`}
	p["input"] = append(p["input"].([]any), finished)
	if _, ok = scienceCall(p); ok {
		t.Fatal("fixture repeated a completed task")
	}
}

package gateway

import (
	"encoding/json"
	"testing"
)

func TestCodexComposerProfile(t *testing.T) {
	raw := `{"model":"materials-research","stream":true,"max_output_tokens":512,"store":false,"input":[{"type":"message","role":"user","content":"read Si"}],"tools":[{"type":"function","name":"agent_exec","description":"Native Codex composer; executes only on the authorized client","strict":true,"parameters":{"type":"object","properties":{"input":{"type":"string"}},"required":["input"],"additionalProperties":false}}]}`
	var p map[string]any
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		t.Fatal(err)
	}
	if err := ValidateNative(p, 512); err != nil {
		t.Fatal(err)
	}
	tool := p["tools"].([]any)[0].(map[string]any)
	tool["parameters"] = map[string]any{"type": "object"}
	if ValidateNative(p, 512) == nil {
		t.Fatal("composer schema substitution accepted")
	}
	tool["name"] = "arbitrary_shell"
	if ValidateNative(p, 512) == nil {
		t.Fatal("unknown remote tool accepted")
	}
}

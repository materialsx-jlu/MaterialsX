package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/providers/litellm"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestMX03RoutesRequireExplicitActivation(t *testing.T) {
	if len(mx03Routes) != 3 {
		t.Fatal("three model slots required")
	}
	for _, route := range mx03Routes {
		if route.Enabled || route.Provider != nil || route.ModelID == ModelAlias || route.Version == "" {
			t.Fatalf("unsafe catalog route: %+v", route)
		}
	}
	t.Setenv("MATERIALSX_MX03_GATEWAY_MODE", "diagnostic")
	t.Setenv("MATERIALSX_LITELLM_URL", "http://127.0.0.1:4000")
	t.Setenv("MATERIALSX_LITELLM_GATEWAY_KEY", "sk-fixture")
	t.Setenv("MATERIALSX_MX03_DIAGNOSTIC_MODELS", "gpt-5.6-sol,claude-opus-5-5")
	c := Config{}
	if err := configureMX03(&c, "alpha"); err != nil {
		t.Fatal(err)
	}
	if !c.Routes["gpt-5.6-sol"].Enabled || !c.Routes["claude-opus-5-5"].Enabled || c.Routes["claude-fable-5-1"].Enabled || len(c.Routes) != 3 {
		t.Fatal("explicit route allowlist ignored")
	}
	t.Setenv("MATERIALSX_MX03_DIAGNOSTIC_MODELS", "gpt-6-sol")
	if err := configureMX03(&c, "alpha"); err == nil {
		t.Fatal("retired GPT-6 route enabled")
	}
	if err := configureMX03(&c, "paid-beta"); err == nil {
		t.Fatal("paid mode enabled before MX wallet")
	}
}

func TestMX03ConfigRejectsBillingAndKeepsLegacyRoute(t *testing.T) {
	t.Setenv("MATERIALSX_CLOUD_MODE", "alpha")
	t.Setenv("MATERIALSX_CLOUD_ROUTE_VERIFIED", "1")
	t.Setenv("ROOTFLOWAI_API_KEY", "sk-fixture-legacy")
	t.Setenv("ROOTFLOWAI_BASE_URL", "")
	t.Setenv("ROOTFLOWAI_MODEL", "")
	t.Setenv("MATERIALSX_METERING_PRICE_VERSION", "")
	t.Setenv("MATERIALSX_PROCUREMENT_PRICE_VERSION", "")
	t.Setenv("MATERIALSX_MX03_GATEWAY_MODE", "diagnostic")
	t.Setenv("MATERIALSX_LITELLM_URL", "http://127.0.0.1:4000")
	t.Setenv("MATERIALSX_LITELLM_GATEWAY_KEY", "sk-fixture")
	t.Setenv("MATERIALSX_MX03_DIAGNOSTIC_MODELS", "claude-fable-5-1")
	c, err := ConfigFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	legacy, found := c.route(ModelAlias)
	if !found || !legacy.Enabled || legacy.Version != RouteVersion || !c.Routes["claude-fable-5-1"].Enabled {
		t.Fatal("legacy route or diagnostic route missing")
	}
	t.Setenv("MATERIALSX_METERING_PRICE_VERSION", "paid-sol-20261001-v1")
	if _, err := ConfigFromEnv(); err == nil {
		t.Fatal("diagnostic models accepted legacy paid pricing")
	}
}

func TestMX03TaskPinsModelAndRoute(t *testing.T) {
	pool := poolFixture(t)
	ctx := context.Background()
	ident, err := identity.New(pool, []byte(strings.Repeat("M", 32)))
	if err != nil {
		t.Fatal(err)
	}
	principal, _ := principal(t, ident)
	provider := &fixtureProvider{}
	route := mx03Routes[2]
	route.Enabled, route.Provider = true, provider
	store := &Store{Pool: pool, Config: Config{Enabled: true, MX03Diagnostic: true,
		MaxRequests: 2, MaxOutputTokens: 1024, MaxDurationSeconds: 180, MaxConcurrent: 2,
		Routes: map[string]Route{route.ModelID: route}}}
	if err := store.Grant(ctx, principal.ID, 10, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	in := taskInput()
	in.Model = route.ModelID
	task, err := store.Create(ctx, principal, in, newID())
	if err != nil || task.Model != route.ModelID {
		t.Fatalf("task model not pinned: %+v %v", task, err)
	}
	wrong := native()
	if _, _, err := store.Claim(ctx, principal, task.ID, newID(), newID(), wrong); err != ErrValidation {
		t.Fatalf("cross-model claim accepted: %v", err)
	}
	payload := native()
	payload["model"] = route.ModelID
	requestID := newID()
	claimed, _, err := store.Claim(ctx, principal, task.ID, requestID, newID(), payload)
	if err != nil || claimed.Model != route.ModelID || claimed.Route != route.Version {
		t.Fatalf("wrong immutable route: %+v %v", claimed, err)
	}
	stored, err := store.Request(ctx, principal.ID, requestID)
	if err != nil || stored.Model != route.ModelID || stored.Route != route.Version {
		t.Fatalf("stored request lost route: %+v %v", stored, err)
	}
	in.Model = "gpt-6-sol"
	if _, err := store.Create(ctx, principal, in, newID()); err != ErrValidation {
		t.Fatalf("unverified route accepted: %v", err)
	}
}

func TestMX03CatalogShowsThreeSlotsAndExcludesGPT6(t *testing.T) {
	fixture := workspaceTest(t)
	fixture.h.S.Config.MX03Diagnostic = true
	fixture.h.S.Config.SalesPriceVersion = ""
	fixture.h.S.Config.PurchasePriceVersion = ""
	fixture.h.S.Config.PaidAccount = ""
	fixture.h.S.Config.Routes = map[string]Route{}
	for _, template := range mx03Routes {
		route := template
		route.Enabled = route.ModelID == "claude-fable-5-1"
		route.Provider = &fixtureProvider{}
		fixture.h.S.Config.Routes[route.ModelID] = route
	}
	response := fixture.user("/v1/models")
	if response.Code != 200 {
		t.Fatalf("catalog HTTP %d", response.Code)
	}
	var catalog struct {
		Items []struct {
			ID      string `json:"id"`
			Enabled bool   `json:"enabled"`
			Route   string `json:"routeVersionId"`
		} `json:"items"`
	}
	if json.Unmarshal(response.Body.Bytes(), &catalog) != nil || len(catalog.Items) != 4 {
		t.Fatal("expected legacy plus three model slots")
	}
	for _, item := range catalog.Items {
		if item.ID == "gpt-6-sol" {
			t.Fatal("retired GPT-6 appeared in catalog")
		}
		if item.ID == "claude-fable-5-1" && !item.Enabled {
			t.Fatal("approved diagnostic route hidden")
		}
	}
}

func TestChatAdapterConvertsToolHistoryAndTerminalUsage(t *testing.T) {
	native := map[string]any{"model": "claude-fable-5-1", "stream": true, "max_output_tokens": float64(64),
		"input": []any{map[string]any{"type": "message", "role": "user", "content": "Call read"},
			map[string]any{"type": "function_call", "call_id": "call_old", "name": "read", "arguments": "{}"},
			map[string]any{"type": "function_call_output", "call_id": "call_old", "output": "silicon"}},
		"tools": []any{map[string]any{"type": "function", "name": "read", "description": "Read material", "parameters": map[string]any{"type": "object"}}}}
	chat, err := chatPayload(native)
	if err != nil {
		t.Fatal(err)
	}
	messages := chat["messages"].([]any)
	if len(messages) != 3 || messages[1].(map[string]any)["role"] != "assistant" || messages[2].(map[string]any)["role"] != "tool" {
		t.Fatal("tool turn was not preserved")
	}
	if chat["stream_options"].(map[string]any)["include_usage"] != true {
		t.Fatal("terminal usage was not requested")
	}
	native["tool_choice"] = map[string]any{"type": "function", "name": "read"}
	chat, err = chatPayload(native)
	if err != nil || chat["tool_choice"].(map[string]any)["function"].(map[string]any)["name"] != "read" {
		t.Fatal("named tool choice was not converted")
	}
	native["include"] = []any{"reasoning.encrypted_content"}
	if _, err := chatPayload(native); err == nil {
		t.Fatal("encrypted reasoning silently dropped")
	}
	delete(native, "include")
	fixture := strings.Join([]string{
		`data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_new","function":{"name":"read","arguments":"{"}}]}}]}`,
		`data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]},"finish_reason":"tool_calls"}]}`,
		`data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":3}}}`,
		`data: [DONE]`,
	}, "\n\n") + "\n\n"
	var output bytes.Buffer
	if err := translateChatSSE(strings.NewReader(fixture), &output, "mx-claude-fable-5-1"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "response.function_call_arguments.done") {
		t.Fatal("tool completion event missing")
	}
	var terminalEvent []byte
	for _, block := range strings.Split(output.String(), "\n\n") {
		if strings.Contains(block, `"response.completed"`) {
			terminalEvent = []byte(strings.TrimPrefix(block, "data: "))
		}
	}
	done, state, usage, err := terminal(terminalEvent)
	if err != nil || !done || state != "completed" || usage == nil || usage.Input == nil || *usage.Input != 11 || usage.Cached == nil || *usage.Cached != 3 {
		t.Fatalf("bad normalized terminal: %t %s %+v %v", done, state, usage, err)
	}
	var final struct {
		Response struct {
			Output []map[string]any `json:"output"`
		} `json:"response"`
	}
	if json.Unmarshal(terminalEvent, &final) != nil || len(final.Response.Output) != 1 || final.Response.Output[0]["call_id"] != "call_new" {
		t.Fatal("tool terminal lost call ID")
	}
	if err := translateChatSSE(strings.NewReader(strings.TrimSuffix(fixture, "data: [DONE]\n\n")), &bytes.Buffer{}, "model"); err == nil {
		t.Fatal("interrupted stream accepted")
	}
	invalidArguments := strings.Replace(fixture, `"arguments":"}"`, `"arguments":"oops"`, 1)
	var rejected bytes.Buffer
	if err := translateChatSSE(strings.NewReader(invalidArguments), &rejected, "model"); err == nil || bytes.Contains(rejected.Bytes(), []byte(`"response.completed"`)) {
		t.Fatal("invalid tool arguments produced a completed response")
	}
	oneIndexed := strings.ReplaceAll(fixture, `"tool_calls":[{"index":0`, `"tool_calls":[{"index":1`)
	var normalized bytes.Buffer
	if err := translateChatSSE(strings.NewReader(oneIndexed), &normalized, "model"); err != nil || !bytes.Contains(normalized.Bytes(), []byte(`"response.completed"`)) {
		t.Fatal("supplier one-indexed tool call was not normalized")
	}
	gapped := strings.Replace(fixture, `"arguments":"{"}}]`, `"arguments":"{"}},{"index":2,"id":"call_gap","function":{"name":"read","arguments":"{}"}}]`, 1)
	if err := translateChatSSE(strings.NewReader(gapped), &bytes.Buffer{}, "model"); err == nil {
		t.Fatal("missing tool index was accepted")
	}
}

func TestChatAdapterStreamsFromProxyBody(t *testing.T) {
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("wrong proxy path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"OK\"},\"finish_reason\":\"stop\"}]}\n\n")
		_, _ = io.WriteString(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":1}}\n\n")
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer proxy.Close()
	client, err := litellm.NewClient(proxy.URL, "sk-fixture")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	response, err := (chatAdapter{client}).Open(ctx, map[string]any{
		"model": "mx-claude-fable-5-1", "input": "Reply OK", "stream": true, "max_output_tokens": float64(16)})
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || !bytes.Contains(body, []byte("response.completed")) {
		t.Fatalf("adapted stream missing terminal: %v", err)
	}
}

// Explicitly opt in: this sends small billable requests to the local proxy.
func TestMX03LiveClaudeToolStream(t *testing.T) {
	if os.Getenv("MX03_LIVE_PROXY_TEST") != "1" {
		t.Skip("requires explicit live probe")
	}
	client, err := litellm.NewClient(os.Getenv("MATERIALSX_LITELLM_URL"), os.Getenv("MATERIALSX_LITELLM_GATEWAY_KEY"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	tools := []any{map[string]any{"type": "function", "name": "read", "description": "Read a material name",
		"parameters": map[string]any{"type": "object", "properties": map[string]any{"input": map[string]any{"type": "string"}}, "required": []any{"input"}}}}
	probe := func(model string, input any, choice any) ([]byte, []map[string]any) {
		t.Helper()
		t.Logf("diagnostic model=%s", model)
		response, err := (chatAdapter{client: client}).Open(ctx, map[string]any{
			"model": model, "input": input, "stream": true, "max_output_tokens": float64(64),
			"tools": tools, "tool_choice": choice,
		})
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("proxy status %d", response.StatusCode)
		}
		body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		if err != nil {
			t.Fatal(err)
		}
		var terminalEvent []byte
		for _, block := range strings.Split(string(body), "\n\n") {
			if strings.Contains(block, `"response.completed"`) {
				terminalEvent = []byte(strings.TrimPrefix(block, "data: "))
			}
		}
		done, state, usage, err := terminal(terminalEvent)
		if err != nil || !done || state != "completed" || usage == nil || usage.Input == nil || usage.Output == nil {
			t.Fatalf("missing trusted terminal usage: %t %s %v", done, state, err)
		}
		var final struct {
			Response struct {
				Output []map[string]any `json:"output"`
			} `json:"response"`
		}
		if json.Unmarshal(terminalEvent, &final) != nil {
			t.Fatal("invalid terminal output")
		}
		return body, final.Response.Output
	}
	for _, model := range []string{"mx-claude-opus-5-5", "mx-claude-fable-5-1"} {
		if only := os.Getenv("MX03_LIVE_ONLY_MODEL"); only != "" && only != model {
			continue
		}
		body, output := probe(model, "Call read once.", map[string]any{"type": "function", "name": "read"})
		if !bytes.Contains(body, []byte("response.function_call_arguments.done")) || len(output) != 1 || output[0]["type"] != "function_call" {
			t.Fatalf("tool call not converted for %s", model)
		}
		callID, _ := output[0]["call_id"].(string)
		arguments, _ := output[0]["arguments"].(string)
		_, reply := probe(model, []any{
			map[string]any{"type": "message", "role": "user", "content": "Call read once."},
			map[string]any{"type": "function_call", "call_id": callID, "name": "read", "arguments": arguments},
			map[string]any{"type": "function_call_output", "call_id": callID, "output": "silicon"},
		}, "none")
		if len(reply) == 0 || reply[0]["type"] != "message" {
			t.Fatalf("%s tool result did not produce a final message", model)
		}
	}
}

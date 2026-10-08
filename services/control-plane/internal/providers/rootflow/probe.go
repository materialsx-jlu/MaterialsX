package rootflow

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Base, Key, Protocol                string
	BudgetFen, InputPrice, OutputPrice int64
	PriceConfirmed                     bool
	UnbudgetedTest                     bool // explicit diagnostic authorization only; not a production budget policy
	PriceReference, Group, Membership  string
	fixtureClient                      *Client // test injection; never exposed through environment or CLI
	reserveCampaign                    func(int64) error
}
type Check struct {
	ID     string  `json:"id"`
	Status string  `json:"status"`
	Reason string  `json:"reason,omitempty"`
	Result *Result `json:"result,omitempty"`
}
type Report struct {
	SchemaVersion    string   `json:"schemaVersion"`
	GeneratedAt      string   `json:"generatedAt"`
	Environment      string   `json:"environment"`
	Provider         string   `json:"provider"`
	Model            string   `json:"model"`
	Protocol         string   `json:"protocol"`
	Status           string   `json:"status"`
	Decision         string   `json:"protocolDecision"`
	BudgetFen        int64    `json:"budgetFen,string"`
	BudgetPolicy     string   `json:"budgetPolicy"`
	ReservedUpperFen int64    `json:"reservedUpperFen,string"`
	GenerationCalls  int      `json:"generationCalls"`
	Checks           []Check  `json:"checks"`
	Unverified       []string `json:"unverified"`
}

func ConfigFromEnv(protocol string) (Config, error) {
	c := Config{Base: os.Getenv("ROOTFLOWAI_BASE_URL"), Key: os.Getenv("ROOTFLOWAI_API_KEY"), Protocol: protocol,
		PriceConfirmed: os.Getenv("ROOTFLOWAI_PRICE_CONFIRMED") == "1", PriceReference: os.Getenv("ROOTFLOWAI_PRICE_REFERENCE"),
		Group: os.Getenv("ROOTFLOWAI_ACCOUNT_GROUP"), Membership: os.Getenv("ROOTFLOWAI_MEMBERSHIP")}
	for _, pair := range []struct {
		name   string
		target *int64
	}{
		{"ROOTFLOWAI_TEST_BUDGET_FEN", &c.BudgetFen}, {"ROOTFLOWAI_INPUT_PRICE_FEN_PER_MILLION", &c.InputPrice},
		{"ROOTFLOWAI_OUTPUT_PRICE_FEN_PER_MILLION", &c.OutputPrice}} {
		value := os.Getenv(pair.name)
		if value == "" {
			continue
		}
		n, err := strconv.ParseInt(value, 10, 64)
		if err != nil || n < 0 {
			return c, errors.New("invalid_numeric_configuration")
		}
		*pair.target = n
	}
	if m := os.Getenv("ROOTFLOWAI_MODEL"); m != "" && m != Model {
		return c, errors.New("target_model_must_be_gpt_5_6_sol")
	}
	return c, nil
}

func RunProbe(ctx context.Context, c Config, mode string) Report {
	r := Report{SchemaVersion: "m5.0-v1", GeneratedAt: time.Now().UTC().Format(time.RFC3339), Environment: "no-network",
		Provider: "rootflowai", Model: Model, Protocol: c.Protocol, Status: "blocked", Decision: "pending_real_verification",
		BudgetFen: c.BudgetFen, BudgetPolicy: "bounded-priced-test", Checks: []Check{}, Unverified: []string{"account_price_and_group", "model_origin",
			"context_window", "cache_write_billing", "upstream_cancellation", "provider_log_reconciliation", "commercial_data_terms", "live_pi_agent"}}
	if c.fixtureClient != nil {
		r.Environment = "synthetic-fixture"
	}
	add := func(id, status, reason string) {
		r.Checks = append(r.Checks, Check{ID: id, Status: status, Reason: reason})
	}
	if mode != "inspect" && mode != "discover" && mode != "live" {
		add("configuration", "failed", "invalid_mode")
		return r
	}
	if c.Protocol != "responses" && c.Protocol != "chat-completions" {
		add("configuration", "failed", "invalid_protocol")
		return r
	}
	if c.UnbudgetedTest {
		if mode != "live" {
			add("configuration", "failed", "unbudgeted_test_requires_live_mode")
			return r
		}
		r.BudgetPolicy = "waived-for-diagnostic-test"
		// Zero here means no monetary reserve was computed, never free usage.
		r.BudgetFen = 0
		add("test_authorization", "passed", "monetary_cap_waived_price_remains_unverified")
	}
	base, err := NormalizeBaseURL(c.Base)
	if err != nil {
		add("configuration", "failed", err.Error())
		return r
	}
	_ = base
	if !c.UnbudgetedTest && c.BudgetFen > 3000 {
		add("budget", "blocked", "exceeds_authorized_30_cny")
		return r
	}
	if strings.TrimSpace(c.Key) == "" {
		add("credential", "blocked", "server_credential_missing")
	}
	if !c.UnbudgetedTest && c.BudgetFen <= 0 {
		add("budget", "blocked", "explicit_test_budget_missing")
	}
	if !c.UnbudgetedTest && (!c.PriceConfirmed || c.PriceReference == "" || c.Group == "" || c.Membership == "" || c.InputPrice <= 0 || c.OutputPrice <= 0) {
		add("price", "blocked", "account_specific_effective_price_unconfirmed")
	}
	if mode == "inspect" {
		r.Environment = "no-network"
		if len(r.Checks) == 0 {
			add("preflight", "passed", "")
			r.Status = "ready_for_explicit_live_probe"
		}
		return r
	}
	client, err := NewClient(c.Base, c.Key)
	if err != nil {
		add("credential", "blocked", "server_credential_missing_or_invalid")
		return r
	}
	if c.fixtureClient != nil {
		client = c.fixtureClient
	} else {
		r.Environment = "real-provider"
	}
	visible, httpStatus, err := client.Discover(ctx)
	result := &Result{HTTPStatus: httpStatus, Usage: Usage{Source: c.Protocol}}
	if err != nil {
		r.Checks = append(r.Checks, Check{ID: "models", Status: "failed", Reason: err.Error(), Result: result})
		return r
	}
	if !visible {
		r.Checks = append(r.Checks, Check{ID: "models", Status: "blocked", Reason: "exact_target_model_not_visible", Result: result})
		return r
	}
	r.Checks = append(r.Checks, Check{ID: "models", Status: "passed", Result: result})
	if mode == "discover" {
		r.Status = "discovery_only"
		return r
	}
	for _, check := range r.Checks {
		if check.Status == "blocked" || check.Status == "failed" {
			return r
		}
	}
	call := func(id string, payload map[string]any, stream bool, callContext context.Context) (Result, bool) {
		// Conservative byte-based input bound plus protocol overhead. This is a
		// probe allowance, not a verified model tokenizer or production reserve.
		body, _ := json.Marshal(payload)
		inputBound := int64(len(body) + 4096)
		var upper int64
		if !c.UnbudgetedTest {
			var err error
			upper, err = QuoteFen(inputBound, 256, c.InputPrice, c.OutputPrice)
			if err != nil || upper > c.BudgetFen-r.ReservedUpperFen {
				add(id, "blocked", "test_budget_would_be_exceeded")
				return Result{}, false
			}
		}
		if r.GenerationCalls >= 6 {
			add(id, "blocked", "maximum_probe_calls_reached")
			return Result{}, false
		}
		if !c.UnbudgetedTest && c.reserveCampaign != nil {
			if err := c.reserveCampaign(upper); err != nil {
				add(id, "blocked", "campaign_budget_unavailable")
				return Result{}, false
			}
		}
		r.ReservedUpperFen += upper
		r.GenerationCalls++
		res, err := client.Generate(callContext, c.Protocol, payload, stream)
		check := Check{ID: id, Status: "passed", Result: &res}
		if err != nil {
			check.Status = "failed"
			check.Reason = err.Error()
		}
		if err == nil && (res.Usage.Input == nil || res.Usage.Output == nil) {
			check.Status = "blocked"
			check.Reason = "usage_missing_reconciliation_required"
		}
		if err == nil && res.Usage.Input != nil && res.Usage.Output != nil && ((!c.UnbudgetedTest && *res.Usage.Input > inputBound) || *res.Usage.Output > 256) {
			check.Status = "failed"
			check.Reason = "observed_usage_exceeds_probe_bound"
		}
		if err == nil && c.UnbudgetedTest && res.Usage.Input != nil && *res.Usage.Input > inputBound {
			// The provider may account for an undisclosed prompt prefix. Keep raw
			// usage for reconciliation; do not invent a monetary reserve or lower it.
			add(id+"_input_estimate", "warning", "provider_input_exceeds_local_estimate_reconciliation_required")
		}
		r.Checks = append(r.Checks, check)
		return res, check.Status == "passed"
	}
	plain := func(text string, stream bool) map[string]any {
		if c.Protocol == "responses" {
			return map[string]any{"model": Model, "input": text, "stream": stream, "max_output_tokens": 256, "store": false}
		}
		p := map[string]any{"model": Model, "messages": []any{map[string]any{"role": "user", "content": text}}, "stream": stream, "max_completion_tokens": 256}
		if stream {
			p["stream_options"] = map[string]any{"include_usage": true}
		}
		return p
	}
	for _, stage := range []struct {
		id     string
		stream bool
	}{{"non_stream_text", false}, {"stream_text", true}} {
		res, ok := call(stage.id, plain("Reply briefly with: MaterialsX probe connected.", stage.stream), stage.stream, ctx)
		if !ok {
			return r
		}
		if !res.TextSeen {
			add(stage.id+"_content", "failed", "empty_text")
			return r
		}
	}
	parameters := map[string]any{"type": "object", "properties": map[string]any{"symbol": map[string]any{"type": "string", "enum": []string{"Si"}}}, "required": []string{"symbol"}, "additionalProperties": false}
	tool := map[string]any{"type": "function", "name": "read_probe_material", "description": "Read a fixed synthetic silicon record; no filesystem or network access.", "parameters": parameters, "strict": true}
	payload := plain("Call read_probe_material with symbol Si. Then state its atomic number from the tool result.", true)
	if c.Protocol == "responses" {
		payload["tools"] = []any{tool}
		payload["tool_choice"] = map[string]any{"type": "function", "name": "read_probe_material"}
	} else {
		payload["tools"] = []any{map[string]any{"type": "function", "function": map[string]any{"name": tool["name"], "description": tool["description"], "parameters": parameters, "strict": true}}}
		payload["tool_choice"] = map[string]any{"type": "function", "function": map[string]any{"name": "read_probe_material"}}
	}
	res, ok := call("stream_tool_call", payload, true, ctx)
	if !ok {
		return r
	}
	t := res.ToolCall
	var args map[string]any
	if t == nil || t.ID == "" || len(t.ID) > 128 || t.Name != "read_probe_material" || json.Unmarshal([]byte(t.Arguments), &args) != nil || len(args) != 1 || args["symbol"] != "Si" {
		add("tool_validation", "failed", "unexpected_or_invalid_readonly_tool")
		return r
	}
	output := `{"symbol":"Si","atomicNumber":14,"source":"synthetic-probe-fixture"}`
	follow := plain("State the atomic number from the tool output.", true)
	if c.Protocol == "responses" {
		follow["input"] = []any{
			map[string]any{"role": "user", "content": "Read synthetic silicon, then state its atomic number."},
			map[string]any{"type": "function_call", "call_id": t.ID, "name": t.Name, "arguments": t.Arguments},
			map[string]any{"type": "function_call_output", "call_id": t.ID, "output": output}}
	} else {
		follow["messages"] = []any{map[string]any{"role": "user", "content": "Read synthetic silicon, then state its atomic number."},
			map[string]any{"role": "assistant", "content": nil, "tool_calls": []any{map[string]any{"id": t.ID, "type": "function", "function": map[string]any{"name": t.Name, "arguments": t.Arguments}}}},
			map[string]any{"role": "tool", "tool_call_id": t.ID, "content": output}}
	}
	res, ok = call("tool_result_roundtrip", follow, true, ctx)
	if !ok {
		return r
	}
	if !res.TextSeen || !strings.Contains(res.Text, "14") {
		add("tool_result_content", "failed", "tool_result_not_used")
		return r
	}
	r.Status = "core_protocol_verified"
	r.Decision = c.Protocol + "_candidate_verified_not_production_enabled"
	// Optional capabilities never promote the core model to production-ready.
	structured := plain("Return JSON with exactly one field: symbol equal to Si.", false)
	format := map[string]any{"type": "json_schema", "name": "material", "strict": true, "schema": parameters}
	if c.Protocol == "responses" {
		structured["text"] = map[string]any{"format": format}
	} else {
		structured["response_format"] = map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "material", "strict": true, "schema": parameters}}
	}
	res, ok = call("structured_output", structured, false, ctx)
	if !ok {
		return r
	}
	if ok {
		var doc map[string]any
		if json.Unmarshal([]byte(res.Text), &doc) != nil || len(doc) != 1 || doc["symbol"] != "Si" {
			add("structured_content", "failed", "schema_not_observed")
		}
	}
	// Abort after a short deadline. A transport abort is not proof that upstream
	// generation stopped or that no money was spent; retain its full allowance.
	cancelCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
	defer cancel()
	_, _ = call("local_abort_observation", plain("Explain silicon in detail.", true), true, cancelCtx)
	return r
}

// AttachCampaign binds the probe to an exclusive, persistent test allowance.
func AttachCampaign(c *Config, campaign *Campaign) { c.reserveCampaign = campaign.Reserve }

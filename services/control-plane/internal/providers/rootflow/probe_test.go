package rootflow

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNormalizeUsage(t *testing.T) {
	for _, protocol := range []string{"responses", "chat-completions"} {
		raw := `{"input_tokens":100,"output_tokens":20,"input_tokens_details":{"cached_tokens":40},"output_tokens_details":{"reasoning_tokens":5}}`
		if protocol == "chat-completions" {
			raw = `{"prompt_tokens":100,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":40},"completion_tokens_details":{"reasoning_tokens":5}}`
		}
		u, err := NormalizeUsage(json.RawMessage(raw), protocol)
		if err != nil || *u.Uncached != 60 || *u.Output != 20 || *u.Reasoning != 5 {
			t.Fatal("overlap normalization failed")
		}
	}
	u, err := NormalizeUsage(nil, "responses")
	if err != nil || u.Input != nil || u.Cached != nil {
		t.Fatal("unknown turned into zero")
	}
	u, err = NormalizeUsage(json.RawMessage(`{"input_tokens":0,"output_tokens":0}`), "responses")
	if err != nil || u.Input == nil || *u.Input != 0 || u.Cached != nil {
		t.Fatal("zero and unknown conflated")
	}
	for _, raw := range []string{`{"input_tokens":1.5}`, `{"input_tokens":-1}`, `{"input_tokens":1,"input_tokens_details":{"cached_tokens":2}}`,
		`{"output_tokens":1,"output_tokens_details":{"reasoning_tokens":2}}`, `{"input_tokens":9007199254740992}`} {
		if _, err := NormalizeUsage(json.RawMessage(raw), "responses"); err == nil {
			t.Fatalf("invalid usage accepted: %s", raw)
		}
	}
}
func TestFixedPointQuote(t *testing.T) {
	q, err := QuoteFen(10000, 1000, 200, 800)
	if err != nil || q != 3 {
		t.Fatalf("quote %d %v", q, err)
	}
	q, err = QuoteFen(1, 1, 1, 1)
	if err != nil || q != 1 {
		t.Fatal("round once after summation")
	}
	if _, err = QuoteFen(math.MaxInt64, math.MaxInt64, math.MaxInt64, math.MaxInt64); err == nil {
		t.Fatal("overflow accepted")
	}
	if _, err = QuoteFen(-1, 1, 1, 1); err == nil {
		t.Fatal("negative accepted")
	}
}
func TestTrustedBase(t *testing.T) {
	for _, base := range []string{"", "https://api.rootflowai.com", BaseURL + "/"} {
		b, err := NormalizeBaseURL(base)
		if err != nil || b != BaseURL {
			t.Fatal("valid base rejected")
		}
	}
	for _, base := range []string{"http://api.rootflowai.com/v1", "https://api.rootflowai.com.evil/v1", BaseURL + "/v1", BaseURL + "?key=value", "https://name:pass@api.rootflowai.com/v1", BaseURL + "#fragment"} {
		if _, err := NormalizeBaseURL(base); err == nil {
			t.Fatal("untrusted or doubled path accepted")
		}
	}
}
func TestSSEFramingAndFailures(t *testing.T) {
	var events []string
	err := parseSSE(strings.NewReader(": heartbeat\r\ndata: {\"text\":\r\ndata: \"硅\"}\r\n\r\n"), func(data []byte) error { events = append(events, string(data)); return nil })
	if err != nil || len(events) != 1 || !json.Valid([]byte(events[0])) {
		t.Fatal("multiline unicode frame failed")
	}
	if parseSSE(strings.NewReader("data: incomplete"), func([]byte) error { return nil }) == nil {
		t.Fatal("truncated frame accepted")
	}
	if parseSSE(strings.NewReader("data: "+strings.Repeat("x", maxBody)+"\n\n"), func([]byte) error { return nil }) == nil {
		t.Fatal("oversize stream accepted")
	}
}
func testClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	s := httptest.NewServer(handler)
	t.Cleanup(s.Close)
	return &Client{base: s.URL, key: "fixture-sensitive-value", http: s.Client()}
}
func TestFailureReportNeverCopiesUpstreamBodyOrCredential(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		fmt.Fprint(w, `{"error":"fixture-sensitive-value secret正文"}`)
	})
	_, status, err := c.Discover(context.Background())
	if status != 401 || err == nil {
		t.Fatal("401 not reported")
	}
	if strings.Contains(err.Error(), "sensitive") || strings.Contains(err.Error(), "正文") {
		t.Fatal("raw error leaked")
	}
}
func TestStreamRequiresTerminalAndUsesFinalUsageOnce(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"硅\"}\n\n")
	})
	res, err := c.Generate(context.Background(), "responses", map[string]any{}, true)
	if err == nil || res.Completed {
		t.Fatal("unterminated stream accepted")
	}
	c = testClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		for i := 0; i < 2; i++ {
			fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[],\"usage\":{\"input_tokens\":10,\"output_tokens\":2}}}\n\n")
		}
	})
	res, err = c.Generate(context.Background(), "responses", map[string]any{}, true)
	if err != nil || *res.Usage.Input != 10 {
		t.Fatal("cumulative usage added twice")
	}
}
func TestChatStreamSplitToolsAndFinalUsage(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		for _, event := range []string{
			`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_probe_material","arguments":"{\"symbol\":"}}]},"finish_reason":null}]}`,
			`{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"Si\"}"}}]},"finish_reason":"tool_calls"}]}`,
			`{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":3}}`, "[DONE]"} {
			fmt.Fprintf(w, "data: %s\n\n", event)
		}
	})
	res, err := c.Generate(context.Background(), "chat-completions", map[string]any{}, true)
	if err != nil || res.ToolCall == nil || res.ToolCall.Arguments != `{"symbol":"Si"}` || *res.Usage.Output != 3 {
		t.Fatalf("chat fragments failed: %v", err)
	}
}
func fixtureConfig(t *testing.T) *Config {
	t.Helper()
	return &Config{Protocol: "responses", Key: "fixture-sensitive-value", BudgetFen: 3000, InputPrice: 200, OutputPrice: 800,
		PriceConfirmed: true, PriceReference: "fixture-not-real-pricing", Group: "fixture", Membership: "fixture"}
}
func TestPreflightNoNetworkAndPriceBudgetGuards(t *testing.T) {
	c := fixtureConfig(t)
	c.Key = ""
	c.PriceConfirmed = false
	r := RunProbe(context.Background(), *c, "inspect")
	if r.Status != "blocked" || r.GenerationCalls != 0 || r.Environment != "no-network" {
		t.Fatal("missing config did not block")
	}
	c = fixtureConfig(t)
	c.BudgetFen = 3001
	r = RunProbe(context.Background(), *c, "live")
	if r.GenerationCalls != 0 || r.Checks[0].Reason != "exceeds_authorized_30_cny" {
		t.Fatal("approved budget bypass")
	}
}

func TestExplicitUnbudgetedDiagnosticDoesNotInventPrices(t *testing.T) {
	c := Config{Protocol: "responses", Key: "fixture-only", UnbudgetedTest: true}
	posts := 0
	c.reserveCampaign = func(int64) error { t.Fatal("unpriced diagnostic reserved money"); return nil }
	c.fixtureClient = testClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/models" {
			fmt.Fprint(w, `{"data":[{"id":"gpt-5.6-sol"}]}`)
			return
		}
		posts++
		// Missing usage must still halt; the waiver is not production billing.
		fmt.Fprint(w, `{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}`)
	})
	r := RunProbe(context.Background(), c, "live")
	if posts != 1 || r.GenerationCalls != 1 || r.BudgetPolicy != "waived-for-diagnostic-test" || r.ReservedUpperFen != 0 || r.Status != "blocked" {
		t.Fatal("diagnostic waiver did not preserve usage/price semantics")
	}
	if !strings.Contains(strings.Join(r.Unverified, ","), "account_price_and_group") {
		t.Fatal("unknown price marked verified")
	}
	for _, mode := range []string{"inspect", "discover"} {
		r = RunProbe(context.Background(), c, mode)
		if r.Environment != "synthetic-fixture" || r.Checks[0].Reason != "unbudgeted_test_requires_live_mode" || r.GenerationCalls != 0 {
			t.Fatal("test override used outside explicit live mode")
		}
	}
}

func TestUnbudgetedDiagnosticStillRequiresExactModel(t *testing.T) {
	c := Config{Protocol: "responses", Key: "fixture-only", UnbudgetedTest: true}
	c.fixtureClient = testClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Fatal("absent model generated or silently replaced")
		}
		fmt.Fprint(w, `{"data":[{"id":"gpt-5.6"}]}`)
	})
	r := RunProbe(context.Background(), c, "live")
	if r.Status != "blocked" || r.GenerationCalls != 0 || r.Checks[len(r.Checks)-1].Reason != "exact_target_model_not_visible" {
		t.Fatal("budget waiver bypassed exact model requirement")
	}
}

func TestProviderInputAboveEstimateOnlyContinuesWithExplicitDiagnosticWaiver(t *testing.T) {
	for _, waived := range []bool{false, true} {
		c := fixtureConfig(t)
		c.UnbudgetedTest = waived
		posts := 0
		c.fixtureClient = testClient(t, func(w http.ResponseWriter, r *http.Request) {
			if r.Method == "GET" {
				fmt.Fprintf(w, `{"data":[{"id":%q}]}`, Model)
				return
			}
			posts++
			if posts > 1 {
				w.WriteHeader(502)
				return
			}
			fmt.Fprint(w, `{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}],"usage":{"input_tokens":5000,"output_tokens":9,"input_tokens_details":{"cached_tokens":4224}}}`)
		})
		r := RunProbe(context.Background(), *c, "live")
		wantPosts := 1
		if waived {
			wantPosts = 2
		}
		if posts != wantPosts {
			t.Fatal("input estimate protection changed outside authorized diagnostic")
		}
		warning, firstPassed := false, false
		for _, check := range r.Checks {
			if check.ID == "non_stream_text_input_estimate" && check.Status == "warning" {
				warning = true
			}
			if check.ID == "non_stream_text" {
				firstPassed = check.Status == "passed"
				if check.Result == nil || check.Result.Usage.Input == nil || *check.Result.Usage.Input != 5000 {
					t.Fatal("provider usage replaced by local estimate")
				}
			}
		}
		if warning != waived || firstPassed != waived {
			t.Fatal("estimate divergence not recorded accurately")
		}
	}
}

func TestInsufficientBudgetBlocksBeforePOST(t *testing.T) {
	c := fixtureConfig(t)
	c.BudgetFen = 1
	posts := 0
	c.fixtureClient = testClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			posts++
		}
		fmt.Fprint(w, `{"data":[{"id":"gpt-5.6-sol"}]}`)
	})
	r := RunProbe(context.Background(), *c, "live")
	if posts != 0 || r.GenerationCalls != 0 || r.Status != "blocked" {
		t.Fatal("budget checked after generation")
	}
}
func TestLiveProbeSyntheticEndToEnd(t *testing.T) {
	c := fixtureConfig(t)
	calls := 0
	c.fixtureClient = testClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/models" {
			fmt.Fprint(w, `{"data":[{"id":"gpt-5.6-sol"}]}`)
			return
		}
		calls++
		var payload map[string]any
		json.NewDecoder(r.Body).Decode(&payload)
		if payload["model"] != Model || payload["max_output_tokens"] != float64(256) {
			t.Error("model/output cap changed")
		}
		text := "MaterialsX probe connected."
		if calls == 4 {
			text = "硅 14"
		}
		if calls == 5 {
			text = `{"symbol":"Si"}`
		}
		item := map[string]any{"type": "message", "content": []any{map[string]any{"type": "output_text", "text": text}}}
		if calls == 3 {
			item = map[string]any{"type": "function_call", "call_id": "fixture_call", "name": "read_probe_material", "arguments": `{"symbol":"Si"}`}
		}
		body := map[string]any{"status": "completed", "output": []any{item}, "usage": map[string]any{"input_tokens": 10, "output_tokens": 3}}
		if payload["stream"] == true {
			w.Header().Set("Content-Type", "text/event-stream")
			event, _ := json.Marshal(map[string]any{"type": "response.completed", "response": body})
			fmt.Fprintf(w, "data: %s\n\n", event)
		} else {
			json.NewEncoder(w).Encode(body)
		}
	})
	r := RunProbe(context.Background(), *c, "live")
	if r.Status != "core_protocol_verified" || r.Environment != "synthetic-fixture" || r.GenerationCalls != 6 {
		t.Fatalf("fixture pipeline failed: %+v", r)
	}
	b, _ := json.Marshal(r)
	if strings.Contains(string(b), c.Key) || strings.Contains(string(b), "MaterialsX probe connected.") {
		t.Fatal("report leaked response text/credential")
	}
}
func TestModelsExactMatchAndUnknownUsageStopGeneration(t *testing.T) {
	c := fixtureConfig(t)
	calls := 0
	c.fixtureClient = testClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/models" {
			fmt.Fprint(w, `{"data":[{"id":"gpt-5.6-sol-preview"}]}`)
		} else {
			calls++
		}
	})
	r := RunProbe(context.Background(), *c, "live")
	if calls != 0 || r.Status != "blocked" {
		t.Fatal("similar model accepted")
	}
	c.fixtureClient = testClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/models" {
			fmt.Fprint(w, `{"data":[{"id":"gpt-5.6-sol"}]}`)
			return
		}
		calls++
		fmt.Fprint(w, `{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}`)
	})
	r = RunProbe(context.Background(), *c, "live")
	if calls != 1 || r.Status != "blocked" {
		t.Fatal("unknown usage treated as free; continued")
	}
}
func TestCancellationAndRedirectRefusal(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, _, err := c.Discover(ctx)
	if err == nil {
		t.Fatal("cancel ignored")
	}
	client, err := NewClient(BaseURL, "fixture")
	if err != nil {
		t.Fatal(err)
	}
	if client.http.CheckRedirect(nil, nil) == nil {
		t.Fatal("credential redirect allowed")
	}
}

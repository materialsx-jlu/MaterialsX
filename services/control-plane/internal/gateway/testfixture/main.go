// Test-only provider service. Never mounted by cmd/identity.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jamip/materialsx/control-plane/internal/gateway"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/payments"
	"github.com/jamip/materialsx/control-plane/migrations"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
)

type fixture struct{}

// Deterministic scientific conversation for an isolated synthetic desktop test only.
func scienceCall(p map[string]any) (map[string]any, bool) {
	input, _ := p["input"].([]any)
	var scopeText string
	var last map[string]any
	for _, entry := range input {
		m, _ := entry.(map[string]any)
		if m["type"] == "function_call_output" {
			output, _ := m["output"].(string)
			last = nil
			_ = json.Unmarshal([]byte(output), &last)
		}
		if text, ok := m["content"].(string); ok {
			scopeText += text
		}
		content, _ := m["content"].([]any)
		for _, part := range content {
			v, _ := part.(map[string]any)
			text, _ := v["text"].(string)
			scopeText += text
		}
	}
	match := regexp.MustCompile(`"structureId":"([a-zA-Z0-9_.:-]+)"`).FindStringSubmatch(scopeText)
	if len(match) != 2 {
		return nil, false
	}
	args := map[string]any{"action": "select", "targetId": match[1], "secondaryId": nil, "potentialId": nil, "domain": "inorganic-crystals", "mode": "exploratory", "evidenceIds": []any{}}
	if last != nil {
		if selection, ok := last["selection"].(map[string]any); ok {
			candidates, _ := selection["candidates"].([]any)
			if len(candidates) == 0 {
				return nil, false
			}
			c := candidates[0].(map[string]any)
			args["action"] = "singlepoint"
			if strings.Contains(scopeText, `"permission":"md"`) {
				args["action"] = "md"
			}
			args["targetId"] = last["id"]
			args["potentialId"] = c["potentialId"]
			args["evidenceIds"] = c["evidenceIds"]
		} else if run, ok := last["runId"].(string); ok {
			if last["status"] == "completed" && last["result"] != nil {
				return nil, false
			}
			args["action"] = "get"
			args["targetId"] = run
		} else {
			return nil, false
		}
	}
	return args, true
}

func (fixture) Open(ctx context.Context, p map[string]any) (*http.Response, error) {
	raw, _ := json.Marshal(p["input"])
	if strings.Contains(string(raw), "slow-fixture") {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	hasResult := strings.Contains(string(raw), "function_call_output")
	tools, _ := p["tools"].([]any)
	toolCall := len(tools) > 0 && !hasResult
	var scienceArgs map[string]any
	science := (strings.Contains(string(raw), "M64-science-fixture") || strings.Contains(string(raw), "M65-md-fixture"))
	if science {
		// Synthetic science fixture also enforces its declared outbound privacy boundary.
		for _, private := range []string{`"positionsAngstrom"`, `"velocitiesAngstromPerFs"`, `"forcesEvPerAngstrom"`, `"atoms"`, `outputDirectory`} {
			if strings.Contains(string(raw), private) {
				return nil, fmt.Errorf("science fixture private geometry/array/path leaked")
			}
		}
		scienceArgs, toolCall = scienceCall(p)
	}
	usage := map[string]any{"input_tokens": 10, "output_tokens": 4, "input_tokens_details": map[string]any{"cached_tokens": 2}, "output_tokens_details": map[string]any{"reasoning_tokens": 1}}
	text := "硅的原子序数是 14。"
	if strings.Contains(string(raw), "一页原文提取事实") {
		value := map[string]any{"facts": []any{map[string]any{"sample": "Si", "category": "process", "name": "Heating temperature", "descriptionZh": "硅样品在300 K加热", "quote": "The silicon sample was heated at 300 K.", "value": 300, "unit": "K", "conditions": "", "recipe": ""}}, "notes": "合成样品的加热步骤。", "gaps": []any{}}
		b, _ := json.Marshal(value)
		text = string(b)
	}
	if strings.Contains(string(raw), "仅从以下首页") {
		text = `{"title":"Synthetic silicon methods","doi":null}`
	}

	item := map[string]any{"id": "msg_fixture", "type": "message", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": text, "annotations": []any{}}}}
	if toolCall && science {
		args, _ := json.Marshal(scienceArgs)
		item = map[string]any{"id": "fc_science", "type": "function_call", "call_id": fmt.Sprintf("science-%v", scienceArgs["action"]), "name": "materials_science", "arguments": string(args), "status": "completed"}
	} else if toolCall {
		t := tools[0].(map[string]any)
		props := t["parameters"].(map[string]any)["properties"].(map[string]any)
		argument, value := "", ""
		for k, v := range props {
			argument = k
			value = v.(map[string]any)["enum"].([]any)[0].(string)
		}
		args, _ := json.Marshal(map[string]string{argument: value})
		item = map[string]any{"id": "fc_fixture", "type": "function_call", "call_id": "call_fixture", "name": t["name"], "arguments": string(args), "status": "completed"}
	}
	response := map[string]any{"id": "resp_fixture", "model": "gpt-5.6-sol", "status": "completed", "output": []any{item}, "usage": usage}
	first := map[string]any{}
	for k, v := range response {
		first[k] = v
	}
	first["status"] = "in_progress"
	first["output"] = []any{}
	first["usage"] = nil
	added := map[string]any{}
	for k, v := range item {
		added[k] = v
	}
	added["status"] = "in_progress"
	if toolCall {
		added["arguments"] = ""
	} else {
		added["content"] = []any{}
	}
	events := []any{map[string]any{"type": "response.created", "response": first}, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": added}}
	if toolCall {
		events = append(events, map[string]any{"type": "response.function_call_arguments.delta", "output_index": 0, "delta": item["arguments"]}, map[string]any{"type": "response.function_call_arguments.done", "output_index": 0, "arguments": item["arguments"]})
	} else {
		events = append(events, map[string]any{"type": "response.content_part.added", "output_index": 0, "content_index": 0, "part": map[string]any{"type": "output_text", "text": "", "annotations": []any{}}}, map[string]any{"type": "response.output_text.delta", "output_index": 0, "content_index": 0, "delta": text}, map[string]any{"type": "response.output_text.delta", "output_index": 0, "content_index": 0, "delta": ""})
	}
	events = append(events, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item}, map[string]any{"type": "response.completed", "response": response})
	var body strings.Builder
	for _, e := range events {
		b, _ := json.Marshal(e)
		body.WriteString("data: ")
		body.Write(b)
		body.WriteString("\n\n")
	}
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(body.String()))}, nil
}
func main() {
	cfg, e := identity.ConfigFromEnv()
	if e != nil || cfg.Environment != "development" || !strings.Contains(os.Getenv("MATERIALSX_DATABASE_URL"), "test") {
		log.Fatal("test-only fixture configuration required")
	}
	pool, e := identity.OpenPool(context.Background(), cfg)
	if e != nil {
		log.Fatal("fixture database unavailable")
	}
	defer pool.Close()
	if migrations.Check(context.Background(), pool) != nil {
		log.Fatal("fixture migration required")
	}
	service, e := identity.New(pool, cfg.MasterKey)
	if e != nil {
		log.Fatal("fixture master invalid")
	}
	h := identity.NewHTTP(service, cfg.PublicURL, false)
	cfgCloud := gateway.Config{Enabled: true, MaxRequests: 3, MaxOutputTokens: 256, MaxDurationSeconds: 30, MaxConcurrent: 8, Provider: fixture{}}
	if os.Getenv("MATERIALSX_M64_FIXTURE") == "1" {
		cfgCloud.MaxRequests = 8
		cfgCloud.MaxDurationSeconds = 180
	}
	if price := os.Getenv("MATERIALSX_METERING_PRICE_VERSION"); price != "" {
		cfgCloud.SalesPriceVersion = price
		cfgCloud.MaxRequests = 16
		cfgCloud.MaxOutputTokens = 4096
		cfgCloud.MaxDurationSeconds = 600
	}
	gateway.MountPayments(gateway.Mount(h, &gateway.Store{Pool: pool, Config: cfgCloud}), &payments.Store{Pool: pool, Mode: "disabled"})
	if identity.NewServer(cfg.Address, h).ListenAndServe() != nil {
		log.Fatal("fixture server stopped")
	}
}

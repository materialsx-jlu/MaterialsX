package gateway

import (
	_ "embed"
	"encoding/json"
	"math"
	"reflect"
)

func keys(m map[string]any, allowed ...string) bool {
	set := map[string]bool{}
	for _, k := range allowed {
		set[k] = true
	}
	for k := range m {
		if !set[k] {
			return false
		}
	}
	return true
}
func text(v any, max int) bool { s, ok := v.(string); return ok && len(s) <= max }

//go:embed science-parameters.json
var scienceParameters []byte

//go:embed science-current-parameters.json
var currentScienceParameters []byte

//go:embed client-tool-names.json
var clientToolNames []byte
var admittedToolNames = func() map[string]bool {
	var names []string
	if json.Unmarshal(clientToolNames, &names) != nil {
		panic("invalid_client_tool_names")
	}
	result := map[string]bool{}
	for _, name := range names {
		result[name] = true
	}
	return result
}()

func toolName(v any) bool {
	name, ok := v.(string)
	return ok && admittedToolNames[name]
}
func validScienceParameters(v any) bool {
	var expected any
	if json.Unmarshal(scienceParameters, &expected) != nil {
		return false
	}
	if reflect.DeepEqual(v, expected) {
		return true
	}
	var current any
	if json.Unmarshal(currentScienceParameters, &current) != nil {
		return false
	}
	return reflect.DeepEqual(v, current)
}

// Only text, fixed client-side project tools and the frozen science dispatcher are admitted.
// Project authorization is enforced on the client and archived with the host task. This gateway never executes tools.
// No URL images, built-in remote tools, arbitrary headers or sampling/billing fields.
func ValidateNative(p map[string]any, maxOutput int) error {
	return ValidateNativeModel(p, maxOutput, ModelAlias)
}

func ValidateNativeModel(p map[string]any, maxOutput int, model string) error {
	if !keys(p, "model", "input", "stream", "max_output_tokens", "store", "include", "tools", "tool_choice") || p["model"] != model || p["stream"] != true {
		return ErrValidation
	}
	n, ok := p["max_output_tokens"].(float64)
	if !ok || n < 1 || n > float64(maxOutput) || math.Trunc(n) != n {
		return ErrValidation
	}
	if v, ok := p["store"]; ok && v != false {
		return ErrValidation
	}
	p["store"] = false
	if v, ok := p["include"]; ok {
		a, ok := v.([]any)
		if !ok || len(a) > 1 {
			return ErrValidation
		}
		for _, i := range a {
			if i != "reasoning.encrypted_content" {
				return ErrValidation
			}
		}
	}
	tools := map[string]bool{}
	if v, exists := p["tools"]; exists {
		a, ok := v.([]any)
		if !ok || len(a) > 32 {
			return ErrValidation
		}
		for _, v := range a {
			t, ok := v.(map[string]any)
			if !ok || !keys(t, "type", "name", "description", "parameters", "strict") || t["type"] != "function" || !toolName(t["name"]) || !text(t["description"], 4096) {
				return ErrValidation
			}
			name := t["name"].(string)
			if tools[name] {
				return ErrValidation
			}
			tools[name] = true
			if name == "agent_exec" || name == "agent_wait" {
				expected := map[string]any{"type": "object", "properties": map[string]any{"input": map[string]any{"type": "string"}}, "required": []any{"input"}, "additionalProperties": false}
				if !reflect.DeepEqual(t["parameters"], expected) || t["strict"] != true {
					return ErrValidation
				}
			}
			if name == "materials_science" && !validScienceParameters(t["parameters"]) {
				return ErrValidation
			}
			if _, ok := t["parameters"].(map[string]any); !ok {
				return ErrValidation
			}
			if name == "bash" {
				schema := t["parameters"].(map[string]any)
				props, ok := schema["properties"].(map[string]any)
				if !ok || schema["type"] != "object" {
					return ErrValidation
				}
				command, ok := props["command"].(map[string]any)
				if !ok || command["type"] != "string" {
					return ErrValidation
				}
			}
			if v, ok := t["strict"]; ok {
				if _, ok := v.(bool); !ok {
					return ErrValidation
				}
			}
		}
	}
	if v, exists := p["tool_choice"]; exists {
		switch v := v.(type) {
		case string:
			if v != "auto" && v != "none" && v != "required" {
				return ErrValidation
			}
		case map[string]any:
			if !keys(v, "type", "name") || v["type"] != "function" || !toolName(v["name"]) || !tools[v["name"].(string)] {
				return ErrValidation
			}
		default:
			return ErrValidation
		}
	}
	switch input := p["input"].(type) {
	case string:
		if len(input) < 1 || len(input) > 128*1024 {
			return ErrValidation
		}
	case []any:
		if len(input) < 1 || len(input) > 200 {
			return ErrValidation
		}
		for _, v := range input {
			i, ok := v.(map[string]any)
			if !ok {
				return ErrValidation
			}
			kind, _ := i["type"].(string)
			switch kind {
			case "", "message":
				if !keys(i, "type", "role", "content", "id", "status", "phase") {
					return ErrValidation
				}
				if i["role"] != "user" && i["role"] != "assistant" && i["role"] != "system" && i["role"] != "developer" {
					return ErrValidation
				}
				switch c := i["content"].(type) {
				case string:
					if !text(c, 128*1024) {
						return ErrValidation
					}
				case []any:
					if len(c) < 1 || len(c) > 64 {
						return ErrValidation
					}
					for _, v := range c {
						b, ok := v.(map[string]any)
						if !ok || !keys(b, "type", "text", "annotations") || (b["type"] != "input_text" && b["type"] != "output_text") || !text(b["text"], 128*1024) {
							return ErrValidation
						}
						if a, ok := b["annotations"]; ok {
							arr, ok := a.([]any)
							if !ok || len(arr) > 0 {
								return ErrValidation
							}
						}
					}
				default:
					return ErrValidation
				}
			case "function_call":
				if !keys(i, "type", "id", "call_id", "name", "arguments", "status") || !toolName(i["name"]) || !text(i["arguments"], 32768) || !text(i["call_id"], 128) {
					return ErrValidation
				}
			case "function_call_output":
				if !keys(i, "type", "call_id", "output") || !text(i["call_id"], 128) || !text(i["output"], 65536) {
					return ErrValidation
				}
			case "reasoning":
				if !keys(i, "type", "id", "encrypted_content", "summary", "status") || !text(i["encrypted_content"], 128*1024) {
					return ErrValidation
				}
			default:
				return ErrValidation
			}
		}
	default:
		return ErrValidation
	}
	b, e := json.Marshal(p)
	if e != nil || len(b) > 256*1024 {
		return ErrValidation
	}
	return nil
}

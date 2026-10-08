package gateway

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jamip/materialsx/control-plane/internal/providers/litellm"
	"io"
	"net/http"
	"sort"
	"strings"
)

type chatAdapter struct{ client *litellm.Client }

func chatPayload(native map[string]any) (map[string]any, error) {
	if include, ok := native["include"].([]any); ok && len(include) > 0 {
		return nil, ErrValidation // Encrypted reasoning cannot cross this adapter.
	}
	messages := []any{}
	switch input := native["input"].(type) {
	case string:
		messages = append(messages, map[string]any{"role": "user", "content": input})
	case []any:
		for _, value := range input {
			item := value.(map[string]any) // ValidateNative has checked the shape.
			switch item["type"] {
			case nil, "", "message":
				content := ""
				switch parts := item["content"].(type) {
				case string:
					content = parts
				case []any:
					for _, part := range parts {
						content += part.(map[string]any)["text"].(string)
					}
				default:
					return nil, ErrValidation
				}
				messages = append(messages, map[string]any{"role": item["role"], "content": content})
			case "function_call":
				messages = append(messages, map[string]any{"role": "assistant", "content": nil,
					"tool_calls": []any{map[string]any{"id": item["call_id"], "type": "function",
						"function": map[string]any{"name": item["name"], "arguments": item["arguments"]}}}})
			case "function_call_output":
				messages = append(messages, map[string]any{"role": "tool", "tool_call_id": item["call_id"], "content": item["output"]})
			default:
				return nil, ErrValidation // Encrypted reasoning has no Chat equivalent.
			}
		}
	default:
		return nil, ErrValidation
	}
	chat := map[string]any{"model": native["model"], "messages": messages, "stream": true,
		"stream_options": map[string]any{"include_usage": true}, "max_tokens": native["max_output_tokens"]}
	if tools, ok := native["tools"].([]any); ok {
		converted := make([]any, 0, len(tools))
		for _, value := range tools {
			tool := value.(map[string]any)
			function := map[string]any{"name": tool["name"], "description": tool["description"], "parameters": tool["parameters"]}
			if strict, ok := tool["strict"]; ok {
				function["strict"] = strict
			}
			converted = append(converted, map[string]any{"type": "function", "function": function})
		}
		chat["tools"] = converted
	}
	if choice, ok := native["tool_choice"]; ok {
		if named, ok := choice.(map[string]any); ok {
			chat["tool_choice"] = map[string]any{"type": "function", "function": map[string]any{"name": named["name"]}}
		} else {
			chat["tool_choice"] = choice
		}
	}
	return chat, nil
}

func (a chatAdapter) Open(ctx context.Context, native map[string]any) (*http.Response, error) {
	chat, err := chatPayload(native)
	if err != nil {
		return nil, err
	}
	upstream, err := a.client.OpenChat(ctx, chat)
	if err != nil || upstream.StatusCode != http.StatusOK {
		return upstream, err
	}
	if !strings.HasPrefix(upstream.Header.Get("Content-Type"), "text/event-stream") {
		return upstream, nil // The gateway rejects this before writing to the client.
	}
	source := upstream.Body
	reader, writer := io.Pipe()
	go func() {
		defer source.Close()
		if err := translateChatSSE(source, writer, native["model"].(string)); err != nil {
			writer.CloseWithError(err)
		} else {
			writer.Close()
		}
	}()
	upstream.Body = reader
	return upstream, nil
}

type chatTool struct{ ID, Name, Arguments string }

func emitResponse(w io.Writer, event map[string]any) error {
	body, err := json.Marshal(event)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "data: %s\n\n", body)
	return err
}

func translateChatSSE(body io.Reader, out io.Writer, model string) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 4096), 256*1024)
	var data []string
	var text strings.Builder
	tools := map[int]*chatTool{}
	var usage json.RawMessage
	finish, total := "", 0
	completed := false
	process := func(raw string) error {
		if raw == "[DONE]" {
			completed = true
			return nil
		}
		var chunk struct {
			Usage   json.RawMessage `json:"usage"`
			Choices []struct {
				Index  int    `json:"index"`
				Finish string `json:"finish_reason"`
				Delta  struct {
					Content *string `json:"content"`
					Tools   []struct {
						Index    int    `json:"index"`
						ID       string `json:"id"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if json.Unmarshal([]byte(raw), &chunk) != nil {
			return errors.New("invalid_chat_chunk")
		}
		if len(chunk.Usage) > 0 && string(chunk.Usage) != "null" {
			usage = chunk.Usage
		}
		if len(chunk.Choices) > 1 {
			return errors.New("multiple_chat_choices")
		}
		for _, choice := range chunk.Choices {
			if choice.Index != 0 {
				return errors.New("unexpected_chat_choice")
			}
			if choice.Finish != "" {
				finish = choice.Finish
			}
			if choice.Delta.Content != nil {
				if text.Len()+len(*choice.Delta.Content) > 2*1024*1024 {
					return errors.New("chat_text_bound")
				}
				text.WriteString(*choice.Delta.Content)
				if err := emitResponse(out, map[string]any{"type": "response.output_text.delta", "delta": *choice.Delta.Content}); err != nil {
					return err
				}
			}
			for _, delta := range choice.Delta.Tools {
				if delta.Index < 0 || delta.Index >= 32 {
					return errors.New("chat_tool_bound")
				}
				tool := tools[delta.Index]
				if tool == nil {
					tool = &chatTool{}
					tools[delta.Index] = tool
				}
				tool.ID += delta.ID
				tool.Name += delta.Function.Name
				tool.Arguments += delta.Function.Arguments
				if len(tool.ID) > 128 || len(tool.Name) > 128 || len(tool.Arguments) > 32768 {
					return errors.New("chat_tool_bound")
				}
			}
		}
		return nil
	}
	for scanner.Scan() {
		line := scanner.Text()
		total += len(line) + 1
		if total > 8*1024*1024 {
			return errors.New("chat_stream_bound")
		}
		if line == "" {
			if len(data) > 0 {
				if err := process(strings.Join(data, "\n")); err != nil {
					return err
				}
			}
			data = nil
			if completed {
				break
			}
			continue
		}
		if strings.HasPrefix(line, "data:") {
			data = append(data, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	if scanner.Err() != nil || !completed || finish == "" {
		return errors.New("chat_stream_incomplete")
	}
	output := []any{}
	if text.Len() > 0 {
		item := map[string]any{"id": "mx-chat-message", "type": "message", "role": "assistant", "status": "completed",
			"content": []any{map[string]any{"type": "output_text", "text": text.String()}}}
		output = append(output, item)
		if err := emitResponse(out, map[string]any{"type": "response.output_item.done", "output_index": len(output) - 1, "item": item}); err != nil {
			return err
		}
	}
	indices := make([]int, 0, len(tools))
	for index := range tools {
		indices = append(indices, index)
	}
	sort.Ints(indices)
	for position, index := range indices {
		if (indices[0] != 0 && indices[0] != 1) || index != indices[0]+position {
			return errors.New("chat_tool_index_gap")
		}
		tool := tools[index]
		if tool.ID == "" {
			return errors.New("chat_tool_id_missing")
		}
		if !toolName(tool.Name) {
			return errors.New("chat_tool_name_unadmitted")
		}
		var arguments map[string]any
		if json.Unmarshal([]byte(tool.Arguments), &arguments) != nil || arguments == nil {
			return errors.New("chat_tool_arguments_invalid")
		}
		item := map[string]any{"id": tool.ID, "type": "function_call", "call_id": tool.ID, "name": tool.Name,
			"arguments": tool.Arguments, "status": "completed"}
		output = append(output, item)
		outputIndex := len(output) - 1
		for _, event := range []map[string]any{
			{"type": "response.output_item.added", "output_index": outputIndex, "item": map[string]any{"id": tool.ID, "type": "function_call", "call_id": tool.ID, "name": tool.Name, "arguments": ""}},
			{"type": "response.function_call_arguments.delta", "output_index": outputIndex, "item_id": tool.ID, "delta": tool.Arguments},
			{"type": "response.function_call_arguments.done", "output_index": outputIndex, "item_id": tool.ID, "arguments": tool.Arguments},
			{"type": "response.output_item.done", "output_index": outputIndex, "item": item},
		} {
			if err := emitResponse(out, event); err != nil {
				return err
			}
		}
	}
	if len(output) == 0 {
		return errors.New("empty_chat_output")
	}
	state := "response.completed"
	status := "completed"
	if finish != "stop" && finish != "tool_calls" {
		state, status = "response.incomplete", "incomplete"
	}
	var normalized any
	if len(usage) > 0 {
		var parsed struct {
			Prompt       *int64          `json:"prompt_tokens"`
			Completion   *int64          `json:"completion_tokens"`
			PromptInfo   json.RawMessage `json:"prompt_tokens_details"`
			OutputInfo   json.RawMessage `json:"completion_tokens_details"`
			CacheCreate  *int64          `json:"cache_creation_input_tokens"`
			BillingUsage struct {
				CacheCreate *int64 `json:"cache_creation_input_tokens"`
			} `json:"billing_usage"`
		}
		if json.Unmarshal(usage, &parsed) != nil {
			return errors.New("invalid_chat_usage")
		}
		create := parsed.CacheCreate
		if create == nil {
			create = parsed.BillingUsage.CacheCreate
		}
		normalized = map[string]any{"input_tokens": parsed.Prompt, "output_tokens": parsed.Completion,
			"input_tokens_details": json.RawMessage(parsed.PromptInfo), "output_tokens_details": json.RawMessage(parsed.OutputInfo),
			"cache_creation_input_tokens": create}
	}
	return emitResponse(out, map[string]any{"type": state, "response": map[string]any{
		"status": status, "model": model, "output": output, "usage": normalized}})
}

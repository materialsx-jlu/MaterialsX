package rootflow

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Explicitly selected by the user after the bare gpt-5.6 ID was unavailable.
const Model = "gpt-5.6-sol"
const BaseURL = "https://api.rootflowai.com/v1"
const maxBody = 2 * 1024 * 1024

type Client struct {
	base, key string
	http      *http.Client
}
type Result struct {
	HTTPStatus int       `json:"httpStatus"`
	TextSeen   bool      `json:"textSeen"`
	Completed  bool      `json:"completed"`
	Usage      Usage     `json:"usage"`
	EventCount int       `json:"eventCount"`
	ToolCall   *ToolCall `json:"-"`
	Text       string    `json:"-"`
}
type ToolCall struct{ ID, Name, Arguments string }

func NormalizeBaseURL(value string) (string, error) {
	if value == "" {
		return BaseURL, nil
	}
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "https" || u.Host != "api.rootflowai.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("untrusted_base_url")
	}
	if strings.TrimRight(u.Path, "/") != "" && strings.TrimRight(u.Path, "/") != "/v1" {
		return "", errors.New("invalid_base_path")
	}
	return BaseURL, nil
}
func NewClient(base, key string) (*Client, error) {
	b, err := NormalizeBaseURL(base)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(key) == "" || strings.ContainsAny(key, "\r\n") {
		return nil, errors.New("missing_or_invalid_credential")
	}
	return &Client{base: b, key: key, http: &http.Client{Timeout: 60 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return errors.New("redirect_refused") }}}, nil
}
func (c *Client) request(ctx context.Context, method, path string, payload any) (*http.Response, error) {
	var body io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil || len(b) > 256*1024 {
			return nil, errors.New("invalid_request")
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return nil, errors.New("invalid_request")
	}
	req.Header.Set("Authorization", "Bearer "+c.key)
	req.Header.Set("Content-Type", "application/json")
	// net/http does not retry POST generation calls. No application retries.
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, errors.New("request_cancelled_or_timed_out")
		}
		return nil, errors.New("transport_error")
	}
	return resp, nil
}
func readJSON(r io.Reader, dst any) error {
	b, err := io.ReadAll(io.LimitReader(r, maxBody+1))
	if err != nil || len(b) > maxBody || json.Unmarshal(b, dst) != nil {
		return errors.New("invalid_or_oversize_json")
	}
	return nil
}
func (c *Client) Discover(ctx context.Context) (bool, int, error) {
	resp, err := c.request(ctx, "GET", "/models", nil)
	if err != nil {
		return false, 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return false, resp.StatusCode, errors.New("models_http_error")
	}
	var body struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := readJSON(resp.Body, &body); err != nil {
		return false, 200, err
	}
	for _, m := range body.Data {
		if m.ID == Model {
			return true, 200, nil
		}
	}
	return false, 200, nil
}
func (c *Client) Generate(ctx context.Context, protocol string, payload any, stream bool) (Result, error) {
	r := Result{Usage: Usage{Source: protocol}}
	path := "/responses"
	if protocol == "chat-completions" {
		path = "/chat/completions"
	} else if protocol != "responses" {
		return r, errors.New("invalid_protocol")
	}
	resp, err := c.request(ctx, "POST", path, payload)
	if err != nil {
		return r, err
	}
	defer resp.Body.Close()
	r.HTTPStatus = resp.StatusCode
	if resp.StatusCode != 200 {
		return r, errors.New("generation_http_error")
	}
	if stream {
		if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
			return r, errors.New("expected_sse")
		}
		err = parseSSE(resp.Body, func(data []byte) error {
			r.EventCount++
			if bytes.Equal(data, []byte("[DONE]")) {
				return nil
			}
			var event map[string]json.RawMessage
			if json.Unmarshal(data, &event) != nil {
				return errors.New("invalid_sse_json")
			}
			if protocol == "responses" {
				var typ string
				json.Unmarshal(event["type"], &typ)
				switch typ {
				case "response.output_text.delta":
					var delta string
					if json.Unmarshal(event["delta"], &delta) != nil {
						return errors.New("invalid_text_delta")
					}
					r.Text += delta
					r.TextSeen = r.Text != ""
				case "response.completed":
					return parseResponse(event["response"], protocol, &r)
				case "response.failed", "response.incomplete", "error":
					return errors.New("stream_terminal_error")
				}
			} else {
				return parseChat(data, true, &r)
			}
			return nil
		})
		if err != nil {
			return r, err
		}
		if !r.Completed {
			return r, errors.New("stream_missing_completion")
		}
		return r, nil
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil || len(b) > maxBody {
		return r, errors.New("invalid_or_oversize_json")
	}
	if protocol == "responses" {
		err = parseResponse(b, protocol, &r)
	} else {
		err = parseChat(b, false, &r)
	}
	return r, err
}

// SSE frames are buffered by line/event, independently of TCP and UTF-8 chunk boundaries.
func parseSSE(reader io.Reader, consume func([]byte) error) error {
	scanner := bufio.NewScanner(io.LimitReader(reader, maxBody+1))
	scanner.Buffer(make([]byte, 4096), maxBody)
	var data []string
	total := 0
	flush := func() error {
		if len(data) == 0 {
			return nil
		}
		joined := strings.Join(data, "\n")
		data = nil
		return consume([]byte(joined))
	}
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		total += len(line) + 1
		if total > maxBody {
			return errors.New("oversize_stream")
		}
		if line == "" {
			if err := flush(); err != nil {
				return err
			}
			continue
		}
		if strings.HasPrefix(line, "data:") {
			data = append(data, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	if scanner.Err() != nil {
		return errors.New("stream_read_error")
	}
	if len(data) > 0 {
		return errors.New("truncated_sse_frame")
	}
	return nil
}
func parseResponse(raw []byte, protocol string, r *Result) error {
	var body struct {
		Status string          `json:"status"`
		Usage  json.RawMessage `json:"usage"`
		Output []struct {
			Type      string `json:"type"`
			CallID    string `json:"call_id"`
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
			Content   []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
	}
	if json.Unmarshal(raw, &body) != nil {
		return errors.New("invalid_response")
	}
	if body.Status != "completed" {
		return errors.New("response_not_completed")
	}
	u, err := NormalizeUsage(body.Usage, protocol)
	if err != nil {
		return err
	}
	r.Usage = u
	r.Completed = true
	text := ""
	for _, item := range body.Output {
		if item.Type == "function_call" {
			if r.ToolCall != nil {
				return errors.New("unexpected_multiple_tools")
			}
			r.ToolCall = &ToolCall{item.CallID, item.Name, item.Arguments}
		}
		for _, content := range item.Content {
			if content.Type == "output_text" {
				text += content.Text
			}
		}
	}
	// Final response replaces cumulative text rather than adding it again.
	if text != "" {
		r.Text = text
	}
	r.TextSeen = r.Text != ""
	return nil
}
func parseChat(raw []byte, stream bool, r *Result) error {
	var body struct {
		Error   json.RawMessage `json:"error"`
		Usage   json.RawMessage `json:"usage"`
		Choices []struct {
			Finish  *string         `json:"finish_reason"`
			Message json.RawMessage `json:"message"`
			Delta   json.RawMessage `json:"delta"`
		} `json:"choices"`
	}
	if json.Unmarshal(raw, &body) != nil {
		return errors.New("invalid_chat_response")
	}
	if len(body.Error) > 0 && string(body.Error) != "null" {
		return errors.New("stream_terminal_error")
	}
	if len(body.Usage) > 0 && string(body.Usage) != "null" {
		u, err := NormalizeUsage(body.Usage, "chat-completions")
		if err != nil {
			return err
		}
		r.Usage = u
	}
	if len(body.Choices) > 1 {
		return errors.New("unexpected_multiple_choices")
	}
	for _, choice := range body.Choices {
		rawMessage := choice.Message
		if stream {
			rawMessage = choice.Delta
		}
		var msg struct {
			Content *string `json:"content"`
			Tools   []struct {
				Index    int    `json:"index"`
				ID       string `json:"id"`
				Function struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		}
		if len(rawMessage) > 0 && string(rawMessage) != "null" && json.Unmarshal(rawMessage, &msg) != nil {
			return errors.New("invalid_chat_message")
		}
		if msg.Content != nil {
			r.Text += *msg.Content
			r.TextSeen = r.Text != ""
		}
		for _, t := range msg.Tools {
			if t.Index != 0 || len(msg.Tools) > 1 {
				return errors.New("unexpected_multiple_tools")
			}
			if r.ToolCall == nil {
				r.ToolCall = &ToolCall{}
			}
			r.ToolCall.ID += t.ID
			r.ToolCall.Name += t.Function.Name
			r.ToolCall.Arguments += t.Function.Arguments
		}
		if choice.Finish != nil {
			if *choice.Finish != "stop" && *choice.Finish != "tool_calls" {
				return errors.New("chat_not_completed")
			}
			r.Completed = true
		}
	}
	if !stream && !r.Completed {
		return errors.New("chat_missing_finish")
	}
	return nil
}

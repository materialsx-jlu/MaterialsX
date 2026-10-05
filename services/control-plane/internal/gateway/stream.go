package gateway

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

type frame struct {
	Data []byte
	Err  error
}

// Bounded framing handles CRLF, multi-line data and arbitrarily split UTF-8.
func frames(ctx context.Context, body io.Reader, out chan<- frame) {
	defer close(out)
	send := func(f frame) bool {
		select {
		case out <- f:
			return true
		case <-ctx.Done():
			return false
		}
	}
	scan := bufio.NewScanner(body)
	scan.Buffer(make([]byte, 4096), 256*1024)
	data := []string{}
	size, total := 0, 0
	for scan.Scan() {
		line := scan.Text()
		total += len(line) + 1
		if total > 8*1024*1024 {
			send(frame{Err: errors.New("stream_bound")})
			return
		}
		if line == "" {
			if len(data) > 0 {
				if !send(frame{Data: []byte(strings.Join(data, "\n"))}) {
					return
				}
			}
			data = nil
			size = 0
			continue
		}
		if strings.HasPrefix(line, "data:") {
			value := strings.TrimPrefix(line, "data:")
			value = strings.TrimPrefix(value, " ")
			size += len(value) + 1
			if size > 256*1024 {
				send(frame{Err: errors.New("frame_bound")})
				return
			}
			data = append(data, value)
		}
	}
	if scan.Err() != nil {
		send(frame{Err: errors.New("stream_read")})
		return
	}
	send(frame{Err: io.ErrUnexpectedEOF})
}
func terminal(data []byte) (bool, string, *rootflow.Usage, error) {
	if !utf8.Valid(data) {
		return false, "", nil, errors.New("invalid_utf8")
	}
	var e struct {
		Type     string `json:"type"`
		Response struct {
			Status string            `json:"status"`
			Output []json.RawMessage `json:"output"`
			Usage  json.RawMessage   `json:"usage"`
		} `json:"response"`
	}
	if json.Unmarshal(data, &e) != nil || e.Type == "" {
		return false, "", nil, errors.New("invalid_event")
	}
	if e.Type == "error" || e.Type == "response.failed" {
		return true, "failed", nil, errors.New("upstream_failure")
	}
	if e.Type != "response.completed" && e.Type != "response.incomplete" {
		return false, "", nil, nil
	}
	u, err := rootflow.NormalizeUsage(e.Response.Usage, "responses")
	if err != nil {
		return false, "", nil, err
	}
	if e.Type == "response.incomplete" {
		return true, "failed", &u, errors.New("incomplete")
	}
	if e.Response.Status != "completed" || len(e.Response.Output) == 0 {
		return false, "", nil, errors.New("invalid_terminal")
	}
	return true, "completed", &u, nil
}
func (h *HTTP) stream(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok || !operation(w, r) {
		return
	}
	var payload map[string]any
	if !decode(w, r, &payload) {
		return
	}
	if e := ValidateNative(payload, h.S.Config.MaxOutputTokens); e != nil {
		fail(w, e)
		return
	}
	taskID, id, key := r.Header.Get("X-Materialsx-Task-Id"), r.Header.Get("X-Materialsx-Request-Id"), r.Header.Get("Idempotency-Key")
	if !identifier.MatchString(taskID) {
		fail(w, ErrValidation)
		return
	}
	_, deadline, e := h.S.Claim(r.Context(), p, taskID, id, key, payload, r.Header.Get("X-Materialsx-Phase"))
	if e != nil {
		fail(w, e)
		return
	}
	ctx, cancel := context.WithDeadline(r.Context(), deadline)
	defer cancel()
	finished := false
	dispatched := false
	finish := func(state, code string, status int, term bool, usage *rootflow.Usage) error {
		c, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		e := h.S.Finish(c, id, state, code, status, term, usage)
		if e == nil {
			finished = true
		}
		return e
	}
	defer func() {
		if !finished {
			state := "cancelled"
			if dispatched {
				state = "unknown"
			}
			_ = finish(state, "STREAM_INTERRUPTED", 0, false, nil)
		}
	}()
	// Recheck durable cancellation and identity revocation while opening/reading.
	go func() {
		ticker := time.NewTicker(300 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				c, stop := context.WithTimeout(ctx, 2*time.Second)
				allowed, e := h.S.RunningAllowed(c, p, id)
				stop()
				if e != nil || !allowed {
					cancel()
					return
				}
			}
		}
	}()
	allowed, e := h.S.RunningAllowed(ctx, p, id)
	if e != nil || !allowed {
		fail(w, ErrForbidden)
		return
	}
	if e = h.S.Dispatched(ctx, id); e != nil {
		fail(w, e)
		return
	}
	dispatched = true
	payload["model"] = rootflow.Model
	response, e := h.S.Config.Provider.Open(ctx, payload)
	if e != nil {
		fail(w, errors.New("upstream_unconfirmed"))
		return
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		_ = finish("failed", "UPSTREAM_ERROR", response.StatusCode, false, nil)
		fail(w, errors.New("upstream_rejected"))
		return
	}
	if !strings.HasPrefix(response.Header.Get("Content-Type"), "text/event-stream") {
		fail(w, errors.New("invalid_protocol"))
		return
	}
	// Override the ordinary HTTP write timeout for this bounded stream only.
	rc := http.NewResponseController(w)
	if e = rc.SetWriteDeadline(time.Now().Add(10 * time.Second)); e != nil {
		fail(w, errors.New("stream_writer_unavailable"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("X-Materialsx-Request-Id", id)
	w.WriteHeader(200)
	emit := func(b []byte) error {
		_ = rc.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, e := w.Write(b); e != nil {
			return e
		}
		return rc.Flush()
	}
	if emit([]byte(": connected\n\n")) != nil {
		return
	}
	output := make(chan frame, 1)
	go frames(ctx, response.Body, output)
	heartbeat := time.NewTicker(10 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-heartbeat.C:
			if emit([]byte(": heartbeat\n\n")) != nil {
				return
			}
		case f, open := <-output:
			if !open || f.Err != nil {
				return
			}
			done, state, usage, parseErr := terminal(f.Data)
			if done {
				exceeded := usage != nil && usage.Output != nil && *usage.Output > int64(payload["max_output_tokens"].(float64))
				if exceeded {
					state = "failed"
					parseErr = ErrBudget
				}
				code := ""
				if parseErr != nil {
					code = "UPSTREAM_ERROR"
					if exceeded {
						code = "TASK_BUDGET_EXCEEDED"
					}
				}
				if finish(state, code, 200, true, usage) != nil {
					return
				}
				if parseErr != nil {
					_ = emit([]byte("data: {\"type\":\"error\",\"code\":\"UPSTREAM_ERROR\",\"message\":\"UPSTREAM_ERROR\"}\n\n"))
					return
				}
			} else if parseErr != nil {
				return
			}
			if emit(append(append([]byte("data: "), f.Data...), []byte("\n\n")...)) != nil {
				return
			}
			if done {
				return
			}
		}
	}
}

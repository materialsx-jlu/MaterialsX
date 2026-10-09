package gateway

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"github.com/jamip/materialsx/control-plane/internal/observability"
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
func routeUsage(route Route, usage *rootflow.Usage) *rootflow.Usage {
	if route.NoCacheWriteUsage && usage != nil && usage.Input != nil && usage.Output != nil && usage.Cached != nil && usage.CacheCreate == nil {
		zero := int64(0)
		usage.CacheCreate = &zero
	}
	return usage
}
func textDelta(data []byte) bool {
	var v struct {
		Type  string `json:"type"`
		Delta string `json:"delta"`
		Text  string `json:"text"`
	}
	return json.Unmarshal(data, &v) == nil && (v.Type == "response.output_text.delta" && v.Delta != "" || v.Type == "response.output_text.done" && v.Text != "")
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
	model, _ := payload["model"].(string)
	route, known := h.S.resolveRoute(r.Context(), model, p.ID)
	if !known || !route.Enabled || route.Provider == nil {
		fail(w, ErrUnavailable, true)
		return
	}
	if e := ValidateNativeModel(payload, h.S.Config.MaxOutputTokens, route.ModelID); e != nil {
		fail(w, e, true)
		return
	}
	if route.Protocol == "chat-completions" {
		if _, e := chatPayload(payload); e != nil {
			fail(w, e, true)
			return
		}
	}
	taskID, id, key := r.Header.Get("X-Materialsx-Task-Id"), r.Header.Get("X-Materialsx-Request-Id"), r.Header.Get("Idempotency-Key")
	if !identifier.MatchString(taskID) {
		fail(w, ErrValidation, true)
		return
	}
	claim, deadline, e := h.S.Claim(r.Context(), p, taskID, id, key, payload, r.Header.Get("X-Materialsx-Phase"))
	if e != nil {
		fail(w, e, true)
		return
	}
	if claim.Model != route.ModelID || claim.Route != route.Version {
		cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
		_ = h.S.Finish(cleanup, id, "cancelled", "ROUTE_MISMATCH", 0, false, nil)
		stop()
		fail(w, ErrUnavailable, true)
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
		fail(w, e, true)
		return
	}
	dispatched = true
	payload["model"] = route.UpstreamAlias
	response, e := route.Provider.Open(ctx, payload)
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
	if e = rc.SetWriteDeadline(time.Now().Add(30 * time.Second)); e != nil {
		fail(w, errors.New("stream_writer_unavailable"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("X-Materialsx-Request-Id", id)
	w.WriteHeader(200)
	emit := func(b []byte) error {
		_ = rc.SetWriteDeadline(time.Now().Add(30 * time.Second))
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
				usage = routeUsage(route, usage)
				code := ""
				if parseErr != nil {
					code = "UPSTREAM_ERROR"
				}
				if finish(state, code, 200, true, usage) != nil {
					return
				}
				if parseErr != nil {
					failure, _ := json.Marshal(map[string]string{"type": "error", "code": code, "message": code})
					_ = emit(append(append([]byte("data: "), failure...), []byte("\n\n")...))
					return
				}
			} else if parseErr != nil {
				return
			}
			if emit(append(append([]byte("data: "), f.Data...), []byte("\n\n")...)) != nil {
				return
			}
			if textDelta(f.Data) {
				observability.RecordFirstToken(r.Context())
			}
			if done {
				return
			}
		}
	}
}

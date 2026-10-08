package litellm

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientPinsEndpointAndAuth(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/v1/responses" || r.Header.Get("Authorization") != "Bearer sk-internal" || r.Method != http.MethodPost {
			t.Errorf("unexpected proxy request: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {}\n\n")
	}))
	defer server.Close()
	client, err := NewClient(server.URL, "sk-internal")
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.Open(context.Background(), map[string]any{"model": "mx-gpt-5-6-sol", "stream": true})
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if calls != 1 {
		t.Fatal("generation was retried")
	}
}

func TestClientNeverRetriesRateLimitOrCancelledGeneration(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()
	client, err := NewClient(server.URL, "sk-internal")
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.OpenChat(context.Background(), map[string]any{"model": "mx-claude-opus-5-5"})
	if err != nil || response.StatusCode != http.StatusTooManyRequests || calls != 1 {
		t.Fatalf("rate limit was retried: calls=%d err=%v", calls, err)
	}
	response.Body.Close()
	cancelled, stop := context.WithCancel(context.Background())
	stop()
	if _, err := client.Open(cancelled, map[string]any{"model": "mx-gpt-5-6-sol"}); err == nil || calls != 1 {
		t.Fatal("cancelled generation was dispatched")
	}
}

func TestClientRejectsRemotePlaintextAndRedirects(t *testing.T) {
	for _, address := range []string{"http://example.com", "http://127.0.0.1:4000/other", "https://user@example.com", "https://example.com/v1?target=bad"} {
		if _, err := NewClient(address, "sk-internal"); err == nil {
			t.Fatalf("accepted unsafe address %s", address)
		}
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://example.com/collect", http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	client, err := NewClient(server.URL, "sk-internal")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Open(context.Background(), map[string]any{"model": "mx-gpt-5-6-sol"}); err == nil {
		t.Fatal("redirect followed")
	}
}

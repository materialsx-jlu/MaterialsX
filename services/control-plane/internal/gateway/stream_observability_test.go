package gateway

import "testing"

func TestOnlyVisibleOutputTextCountsAsFirstToken(t *testing.T) {
	if textDelta([]byte(`{"type":"response.created"}`)) || textDelta([]byte(`{"type":"response.output_text.delta","delta":""}`)) {
		t.Fatal("metadata is not a token")
	}
	if !textDelta([]byte(`{"type":"response.output_text.delta","delta":"A"}`)) {
		t.Fatal("text delta missing")
	}
	if !textDelta([]byte(`{"type":"response.output_text.done","text":"full text"}`)) {
		t.Fatal("final text without deltas missing")
	}
}

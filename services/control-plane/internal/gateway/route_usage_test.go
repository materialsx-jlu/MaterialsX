package gateway

import (
	"testing"

	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
)

func TestRouteUsageOnlyCompletesGPTCacheWriteClass(t *testing.T) {
	n := func(v int64) *int64 { return &v }
	gpt := rootflow.Usage{Source: "responses", Input: n(10373), Output: n(53), Cached: n(0)}
	actual := routeUsage(mx03Routes[0], &gpt)
	if actual.CacheCreate == nil || *actual.CacheCreate != 0 || actual.Input == nil || *actual.Input != 10373 {
		t.Fatalf("GPT usage was not completed without changing provider totals: %+v", actual)
	}
	claude := rootflow.Usage{Source: "responses", Input: n(10373), Output: n(53), Cached: n(0)}
	if routeUsage(mx03Routes[1], &claude).CacheCreate != nil {
		t.Fatal("Claude cache-write usage was invented")
	}
	incomplete := rootflow.Usage{Source: "responses", Input: n(10373), Output: n(53)}
	if routeUsage(mx03Routes[0], &incomplete).CacheCreate != nil {
		t.Fatal("missing cache-read usage was treated as complete")
	}
}

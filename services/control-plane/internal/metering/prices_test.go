package metering

import (
	"errors"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
	"testing"
)

func fixturePrice() Price {
	return Price{ID: "fixture-v1", Model: "materials-research", Route: "rootflow-sol-responses-2026-10-01-v1", TestOnly: true, Unit: "test-credit", Tiers: []Tier{{0, "1000000", "200000", "2000000"}}, MaxInput: 100000, InputPolicy: "utf8-byte-test-estimate-v1", Evidence: "synthetic-test"}
}
func num(n int64) *int64 { return &n }
func TestExactPricing(t *testing.T) {
	p := fixturePrice()
	u := rootflow.Usage{Source: "responses", Input: num(10), Cached: num(2), Uncached: num(8), Output: num(4), Reasoning: num(3)}
	q, e := p.Quote(u)
	if e != nil || q != 17 {
		t.Fatalf("quote %d %v", q, e)
	}
	u.Reasoning = num(0)
	q, _ = p.Quote(u)
	if q != 17 {
		t.Fatal("reasoning counted twice")
	}
	u.Cached = nil
	u.Uncached = nil
	q, e = p.Quote(u)
	if e != nil || q != 10 {
		t.Fatal("missing cache split should use the customer-favorable rate")
	}
	purchaseUnknown := PurchasePrice{ID: "cost-unknown", Unit: "provider-credit-subunit", Tiers: []Tier{{0, "1000000", "200000", "2000000"}}, FenNumerator: "1", UnitDenominator: "1", Evidence: "synthetic-only", Group: "test-group", Membership: "test-membership"}
	if _, e = purchaseUnknown.Quote(u); !errors.Is(e, ErrPending) {
		t.Fatal("unknown supplier cache split must not become verified procurement cost")
	}
	p.Tiers[0].Cached = p.Tiers[0].Input
	q, e = p.Quote(u)
	if e != nil || q != 18 {
		t.Fatal("equal cache rates still require unknown cache")
	}
	p.Tiers = append(p.Tiers, Tier{10, "2000000", "2000000", "3000000"})
	q, e = p.Quote(u)
	if e != nil || q != 32 {
		t.Fatal("tier boundary")
	}
	reserve, bound, e := p.Reserve(map[string]any{"input": "硅"}, 4)
	if e != nil || reserve < bound*2+12 {
		t.Fatal("reservation failed to use maximum tier")
	}
	p.Tiers = []Tier{{0, "1", "1", "1"}}
	q, e = p.Quote(rootflow.Usage{Input: num(1), Output: num(1)})
	if e != nil || q != 1 {
		t.Fatal("rounded twice")
	}
	p.TestOnly = false
	if p.Validate() == nil {
		t.Fatal("unverified commercial price admitted")
	}
	purchase := PurchasePrice{ID: "cost-v1", Unit: "provider-credit-subunit", Tiers: []Tier{{0, "1", "1", "1"}}, FenNumerator: "3", UnitDenominator: "2", Evidence: "synthetic-only", Group: "test-group", Membership: "test-membership"}
	q, e = purchase.Quote(rootflow.Usage{Input: num(333334), Output: num(333334)})
	if e != nil || q != 2 {
		t.Fatal("credit conversion/rounding")
	}
	p = fixturePrice()
	p.Tiers[0].Input = "9223372036854775807"
	p.Tiers[0].Cached = "0"
	if _, e = quote(100000, 0, 4096, p.Tiers[0], 9223372036854775807, 1); e == nil {
		t.Fatal("overflow admitted")
	}
	for _, s := range []string{"-1", "01", "1.0", "9223372036854775808"} {
		if _, e = Amount(s); e == nil {
			t.Fatalf("invalid amount %s", s)
		}
	}
	u = rootflow.Usage{Input: num(2), Output: num(1), Cached: num(3)}
	if _, e = fixturePrice().Quote(u); e == nil {
		t.Fatal("invalid evidence")
	}
}

package metering

import (
	"errors"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
	"testing"
)

func TestPaidExactTokenPricing(t *testing.T) {
	p := PaidPrice()
	for _, tt := range []struct {
		input, cached, output, reason int64
		want                          string
	}{{20000, 10000, 10000, 9999, "111"}, {1, 1, 0, 0, "0.0001"}, {1, 0, 0, 0, "0.001"}, {0, 0, 1, 1, "0.01"}, {12345, 1234, 56, 42, "11.7944"}} {
		q, e := p.Quote(rootflow.Usage{Input: num(tt.input), Cached: num(tt.cached), Output: num(tt.output), Reasoning: num(tt.reason)})
		if e != nil || Display(q, PaidPrecision) != tt.want {
			t.Fatalf("%+v => %s %v", tt, Display(q, PaidPrecision), e)
		}
	}
	if _, e := p.Quote(rootflow.Usage{Input: num(1), Output: num(1)}); !errors.Is(e, ErrPending) {
		t.Fatal("unknown cache billed")
	}
	reserve, bound, e := p.Reserve(map[string]any{"input": "one tiny input"}, 1024)
	if e != nil || bound != 131072 || Display(reserve, PaidPrecision) != "141.312" {
		t.Fatal(reserve, bound, e)
	}
	p.Tiers[0].Input = "1000"
	if p.Validate() == nil {
		t.Fatal("unapproved rates admitted")
	}
}
func TestCreditDecimalRoundtrip(t *testing.T) {
	for _, s := range []string{"0", "0.0001", "1010", "141.312", "922337203685477.5807"} {
		n, e := DecimalAmount(s)
		if e != nil || Display(n, PaidPrecision) != s {
			t.Fatal(s, n, e)
		}
	}
	for _, s := range []string{"-1", "01", "0.00001", "1e3", "1.", "1..2", "922337203685477.5808"} {
		if _, e := DecimalAmount(s); e == nil {
			t.Fatal(s)
		}
	}
	if Display(-1, PaidPrecision) != "-0.0001" {
		t.Fatal("negative ledger formatting")
	}
}

func TestTrustedCounterReserveRequiresEvidenceAndUsesSmallInputBound(t *testing.T) {
	p := CountedPaidPrice("synthetic-count-evidence")
	if _, _, e := p.Reserve(map[string]any{"input": "fixture"}, 8); e == nil {
		t.Fatal("counted price accepted missing bound")
	}
	amount, bound, e := p.Reserve(map[string]any{"input": "fixture"}, 8, 123)
	if e != nil || amount != 2030 || bound != 123 {
		t.Fatal(amount, bound, e)
	}
	old := PaidPrice()
	if _, _, e = old.Reserve(map[string]any{}, 8, 123); e == nil {
		t.Fatal("pilot price accepted unbound override")
	}
}

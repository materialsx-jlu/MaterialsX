package mxpricing

import (
	"errors"
	"os"
	"testing"
)

func testSnapshot(t *testing.T) (Bundle, []byte) {
	t.Helper()
	raw, err := os.ReadFile("../../../../docs/V0_3_ROOTFLOWAI_PRICING.json")
	if err != nil {
		t.Fatal(err)
	}
	bundle, err := ParseSnapshot(raw)
	if err != nil {
		t.Fatal(err)
	}
	return bundle, raw
}

func n(value int64) *int64 { return &value }

func TestPinnedPriceSnapshotAndExactQuote(t *testing.T) {
	bundle, raw := testSnapshot(t)
	if len(bundle.Retail.Models) != 3 || len(bundle.Purchase.Models) != 3 || bundle.Retail.Status != "draft" {
		t.Fatal("snapshot model/status mismatch")
	}
	if _, err := ParseSnapshot(append(append([]byte{}, raw...), '\n')); !errors.Is(err, ErrSnapshot) {
		t.Fatal("modified bytes accepted")
	}
	q, err := Price(bundle, "gpt-5.6-sol", Usage{Input: n(1000), Output: n(1000), CacheRead: n(1000), CacheCreate: n(1000)})
	if err != nil || q.Tier != "standard" || q.RetailSubunits != 1461250 || q.PurchaseEstimateMicrofen != 1043750 {
		t.Fatalf("four class quote: %+v %v", q, err)
	}
	for _, id := range []string{"gpt-5.6-sol"} {
		standard, err := Price(bundle, id, Usage{Input: n(271999), Output: n(1), CacheRead: n(0), CacheCreate: n(0)})
		if err != nil || standard.Tier != "standard" {
			t.Fatalf("standard boundary %s: %+v %v", id, standard, err)
		}
		long, err := Price(bundle, id, Usage{Input: n(272000), Output: n(1), CacheRead: n(0), CacheCreate: n(0)})
		if err != nil || long.Tier != "long_context" || long.RetailSubunits <= standard.RetailSubunits {
			t.Fatalf("long boundary %s: %+v %v", id, long, err)
		}
	}
	if _, err := Price(bundle, "claude-opus-5-5", Usage{Input: n(1), Output: n(0), CacheRead: n(0)}); !errors.Is(err, ErrPending) {
		t.Fatalf("unknown cache write accepted: %v", err)
	}
	if _, err := Price(bundle, "claude-opus-5-5", Usage{Input: n(-1), Output: n(0), CacheRead: n(0), CacheCreate: n(0)}); !errors.Is(err, ErrQuote) {
		t.Fatalf("negative usage accepted: %v", err)
	}
	bound, err := ReserveBound(bundle, "gpt-5.6-sol", 1000, 1000)
	if err != nil || bound != 1268750 {
		t.Fatalf("unsafe hold: %d %v", bound, err)
	}
	q, err = Price(bundle, "gpt-5.6-sol", Usage{Input: n(500), Output: n(100), CacheRead: n(200), CacheCreate: n(300)})
	if err != nil || q.RetailSubunits > bound {
		t.Fatalf("actual debit exceeds hold: %+v %v", q, err)
	}
	q, err = Price(bundle, "claude-opus-5-5", Usage{Input: n(1), Output: n(0), CacheRead: n(0), CacheCreate: n(0)})
	if err != nil || q.RetailSubunits != 140 || q.PurchaseEstimateMicrofen != 240 {
		t.Fatalf("micro usage rounding: %+v %v", q, err)
	}
}

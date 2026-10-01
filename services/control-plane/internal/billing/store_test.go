package billing

import (
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestDuplicateEventsDoNotDoubleCreditOrCharge(t *testing.T) {
	store, _ := NewStore("")
	now := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	first, err := store.GrantSubscription("acct", "pro", "grant-1", now)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.GrantSubscription("acct", "pro", "grant-1", now)
	if err != nil {
		t.Fatal(err)
	}
	if first.GrantedCredits != second.GrantedCredits || second.GrantedCredits != 2_000_000 {
		t.Fatalf("duplicate grant changed credits: %+v", second)
	}
	if _, err := store.Reserve("reserve-1", "acct", "request-1", 10_000, now); err != nil {
		t.Fatal(err)
	}
	actual := int64(4_000)
	settled, err := store.Settle("reserve-1", "settle-1", &actual, now)
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := store.Settle("reserve-1", "settle-1", &actual, now)
	if err != nil {
		t.Fatal(err)
	}
	if settled.UsedCredits != 4_000 || duplicate.UsedCredits != 4_000 {
		t.Fatalf("duplicate settlement charged twice: %+v", duplicate)
	}
}

func TestConcurrentReservationsCannotOverspend(t *testing.T) {
	store, _ := NewStore("")
	now := time.Now()
	if _, err := store.GrantSubscription("acct", "pro", "grant", now); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	succeeded := 0
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			_, err := store.Reserve(fmt.Sprintf("reserve-%d", index), "acct", fmt.Sprintf("request-%d", index), 400_000, now)
			if err == nil {
				mu.Lock()
				succeeded++
				mu.Unlock()
			} else if !errors.Is(err, ErrInsufficientCredits) {
				t.Errorf("unexpected reservation error: %v", err)
			}
		}(i)
	}
	wg.Wait()
	if succeeded != 5 {
		t.Fatalf("expected 5 reservations, got %d", succeeded)
	}
	overview, _ := store.Overview("acct")
	if overview.Remaining != 0 || overview.ReservedCredits != 2_000_000 {
		t.Fatalf("unexpected balance after concurrent reservations: %+v", overview)
	}
}

func TestMissingUsageRetainsReservationForReconciliation(t *testing.T) {
	store, _ := NewStore("")
	now := time.Now()
	_, _ = store.GrantSubscription("acct", "pro", "grant", now)
	_, _ = store.Reserve("reserve", "acct", "request", 20_000, now)
	overview, err := store.Settle("reserve", "missing-usage", nil, now)
	if err != nil {
		t.Fatal(err)
	}
	if overview.ReservedCredits != 20_000 || overview.UsedCredits != 0 {
		t.Fatalf("missing usage should retain reservation: %+v", overview)
	}
	entries := store.Ledger("acct")
	if entries[len(entries)-1].Kind != "reconciliation_pending" {
		t.Fatalf("missing reconciliation entry: %+v", entries)
	}
}

func TestStatePersistsAcrossRestart(t *testing.T) {
	path := t.TempDir() + "/state.json"
	now := time.Now()
	first, _ := NewStore(path)
	_, _ = first.GrantSubscription("acct", "research", "grant", now)
	_, _ = first.Reserve("reserve", "acct", "request", 50_000, now)
	second, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	overview, ok := second.Overview("acct")
	if !ok || overview.Plan.ID != "research" || overview.ReservedCredits != 50_000 {
		t.Fatalf("state did not restore: %+v", overview)
	}
}

func TestPlanChangeStartsANewCreditPeriod(t *testing.T) {
	store, _ := NewStore("")
	now := time.Now()
	_, _ = store.GrantSubscription("acct", "pro", "pro-period", now)
	_, _ = store.Reserve("pro-reserve", "acct", "request", 50_000, now)
	actual := int64(20_000)
	_, _ = store.Settle("pro-reserve", "pro-settlement", &actual, now)

	overview, err := store.GrantSubscription("acct", "research", "research-period", now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if overview.GrantedCredits != 8_000_000 || overview.UsedCredits != 0 || overview.Remaining != 8_000_000 {
		t.Fatalf("new plan leaked prior-period credits or usage: %+v", overview)
	}
}

package billing

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

var ErrInsufficientCredits = errors.New("insufficient credits")

type Plan struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	PriceFen        int64  `json:"priceFen"`
	IncludedCredits int64  `json:"includedCredits"`
	TestPrice       bool   `json:"testPrice"`
}

type Subscription struct {
	AccountID   string    `json:"accountId"`
	PeriodID    string    `json:"periodId"`
	PlanID      string    `json:"planId"`
	Status      string    `json:"status"`
	PeriodStart time.Time `json:"periodStart"`
	PeriodEnd   time.Time `json:"periodEnd"`
	Renews      bool      `json:"renews"`
	RenewalMode string    `json:"renewalMode"`
}

type Reservation struct {
	ID        string    `json:"id"`
	AccountID string    `json:"accountId"`
	RequestID string    `json:"requestId"`
	PeriodID  string    `json:"periodId"`
	Units     int64     `json:"units"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

type LedgerEntry struct {
	ID            string    `json:"id"`
	AccountID     string    `json:"accountId"`
	EventID       string    `json:"eventId"`
	PeriodID      string    `json:"periodId"`
	ReservationID string    `json:"reservationId,omitempty"`
	Kind          string    `json:"kind"`
	Units         int64     `json:"units"`
	CreatedAt     time.Time `json:"createdAt"`
	Note          string    `json:"note,omitempty"`
}

type Overview struct {
	Subscription    Subscription `json:"subscription"`
	Plan            Plan         `json:"plan"`
	GrantedCredits  int64        `json:"grantedCredits"`
	UsedCredits     int64        `json:"usedCredits"`
	ReservedCredits int64        `json:"reservedCredits"`
	Remaining       int64        `json:"remainingCredits"`
}

type state struct {
	Subscriptions map[string]Subscription `json:"subscriptions"`
	Reservations  map[string]Reservation  `json:"reservations"`
	Ledger        []LedgerEntry           `json:"ledger"`
	Events        map[string]string       `json:"events"`
}

type Store struct {
	mu    sync.Mutex
	path  string
	state state
}

var plans = map[string]Plan{
	"community": {ID: "community", Name: "Community", PriceFen: 0, IncludedCredits: 0, TestPrice: false},
	"pro":       {ID: "pro", Name: "Pro", PriceFen: 19900, IncludedCredits: 2_000_000, TestPrice: true},
	"research":  {ID: "research", Name: "Research", PriceFen: 59900, IncludedCredits: 8_000_000, TestPrice: true},
}

func Plans() []Plan {
	result := make([]Plan, 0, len(plans))
	for _, plan := range plans {
		result = append(result, plan)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].PriceFen < result[j].PriceFen })
	return result
}

func NewStore(path string) (*Store, error) {
	s := &Store{path: path, state: state{
		Subscriptions: map[string]Subscription{},
		Reservations:  map[string]Reservation{},
		Ledger:        []LedgerEntry{},
		Events:        map[string]string{},
	}}
	if path == "" {
		return s, nil
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, &s.state); err != nil {
		return nil, fmt.Errorf("decode ledger state: %w", err)
	}
	for accountID, subscription := range s.state.Subscriptions {
		if subscription.PeriodID == "" {
			subscription.PeriodID = "legacy-" + accountID
			s.state.Subscriptions[accountID] = subscription
		}
	}
	for index, entry := range s.state.Ledger {
		if entry.PeriodID == "" {
			entry.PeriodID = s.state.Subscriptions[entry.AccountID].PeriodID
			s.state.Ledger[index] = entry
		}
	}
	for id, reservation := range s.state.Reservations {
		if reservation.PeriodID == "" {
			reservation.PeriodID = s.state.Subscriptions[reservation.AccountID].PeriodID
			s.state.Reservations[id] = reservation
		}
	}
	return s, nil
}

func (s *Store) GrantSubscription(accountID, planID, eventID string, now time.Time) (Overview, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	plan, ok := plans[planID]
	if !ok {
		return Overview{}, fmt.Errorf("unknown plan %q", planID)
	}
	if _, duplicate := s.state.Events[eventID]; !duplicate {
		s.state.Subscriptions[accountID] = Subscription{
			AccountID: accountID, PeriodID: eventID, PlanID: planID, Status: "active", PeriodStart: now.UTC(),
			PeriodEnd: now.UTC().Add(30 * 24 * time.Hour), Renews: false, RenewalMode: "manual",
		}
		s.state.Ledger = append(s.state.Ledger, LedgerEntry{
			ID: eventID + ":credit", AccountID: accountID, EventID: eventID, PeriodID: eventID, Kind: "period_credit",
			Units: plan.IncludedCredits, CreatedAt: now.UTC(), Note: "development entitlement; no payment captured",
		})
		s.state.Events[eventID] = "subscription:" + accountID
		if err := s.saveLocked(); err != nil {
			return Overview{}, err
		}
	}
	return s.overviewLocked(accountID), nil
}

func (s *Store) EnsureCommunity(accountID string, now time.Time) (Overview, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.state.Subscriptions[accountID]; !ok {
		periodID := "community-" + accountID
		s.state.Subscriptions[accountID] = Subscription{
			AccountID: accountID, PeriodID: periodID, PlanID: "community", Status: "active", PeriodStart: now.UTC(),
			PeriodEnd: now.UTC().Add(100 * 365 * 24 * time.Hour), Renews: false, RenewalMode: "none",
		}
		if err := s.saveLocked(); err != nil {
			return Overview{}, err
		}
	}
	return s.overviewLocked(accountID), nil
}

func (s *Store) Overview(accountID string) (Overview, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.state.Subscriptions[accountID]; !ok {
		return Overview{}, false
	}
	return s.overviewLocked(accountID), true
}

func (s *Store) Reserve(id, accountID, requestID string, units int64, now time.Time) (Reservation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.state.Reservations[id]; ok {
		return existing, nil
	}
	if units <= 0 {
		return Reservation{}, errors.New("reservation units must be positive")
	}
	overview := s.overviewLocked(accountID)
	if overview.Remaining < units {
		return Reservation{}, ErrInsufficientCredits
	}
	subscription := s.state.Subscriptions[accountID]
	reservation := Reservation{ID: id, AccountID: accountID, RequestID: requestID, PeriodID: subscription.PeriodID, Units: units, Status: "reserved", CreatedAt: now.UTC()}
	s.state.Reservations[id] = reservation
	if err := s.saveLocked(); err != nil {
		return Reservation{}, err
	}
	return reservation, nil
}

func (s *Store) Settle(reservationID, eventID string, actualUnits *int64, now time.Time) (Overview, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	reservation, ok := s.state.Reservations[reservationID]
	if !ok {
		return Overview{}, errors.New("reservation not found")
	}
	if _, duplicate := s.state.Events[eventID]; duplicate {
		return s.overviewLocked(reservation.AccountID), nil
	}
	if actualUnits == nil {
		s.state.Ledger = append(s.state.Ledger, LedgerEntry{
			ID: eventID + ":pending", AccountID: reservation.AccountID, EventID: eventID,
			PeriodID: reservation.PeriodID, ReservationID: reservationID, Kind: "reconciliation_pending", Units: 0, CreatedAt: now.UTC(),
			Note: "provider usage missing; reservation retained",
		})
		s.state.Events[eventID] = "pending:" + reservationID
		if err := s.saveLocked(); err != nil {
			return Overview{}, err
		}
		return s.overviewLocked(reservation.AccountID), nil
	}
	if *actualUnits < 0 {
		return Overview{}, errors.New("actual units cannot be negative")
	}
	if *actualUnits > reservation.Units+s.overviewLocked(reservation.AccountID).Remaining {
		return Overview{}, ErrInsufficientCredits
	}
	reservation.Status = "settled"
	s.state.Reservations[reservationID] = reservation
	s.state.Ledger = append(s.state.Ledger, LedgerEntry{
		ID: eventID + ":usage", AccountID: reservation.AccountID, EventID: eventID,
		PeriodID: reservation.PeriodID, ReservationID: reservationID, Kind: "model_usage", Units: -*actualUnits, CreatedAt: now.UTC(),
	})
	s.state.Events[eventID] = "settlement:" + reservationID
	if err := s.saveLocked(); err != nil {
		return Overview{}, err
	}
	return s.overviewLocked(reservation.AccountID), nil
}

func (s *Store) Release(reservationID, eventID string, now time.Time) (Overview, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	reservation, ok := s.state.Reservations[reservationID]
	if !ok {
		return Overview{}, errors.New("reservation not found")
	}
	if _, duplicate := s.state.Events[eventID]; duplicate {
		return s.overviewLocked(reservation.AccountID), nil
	}
	reservation.Status = "released"
	s.state.Reservations[reservationID] = reservation
	s.state.Ledger = append(s.state.Ledger, LedgerEntry{
		ID: eventID + ":release", AccountID: reservation.AccountID, EventID: eventID,
		PeriodID: reservation.PeriodID, ReservationID: reservationID, Kind: "reservation_release", Units: 0, CreatedAt: now.UTC(),
	})
	s.state.Events[eventID] = "release:" + reservationID
	if err := s.saveLocked(); err != nil {
		return Overview{}, err
	}
	return s.overviewLocked(reservation.AccountID), nil
}

func (s *Store) Ledger(accountID string) []LedgerEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]LedgerEntry, 0)
	for _, entry := range s.state.Ledger {
		if entry.AccountID == accountID {
			result = append(result, entry)
		}
	}
	return result
}

func (s *Store) overviewLocked(accountID string) Overview {
	subscription := s.state.Subscriptions[accountID]
	plan := plans[subscription.PlanID]
	var granted, used, reserved int64
	for _, entry := range s.state.Ledger {
		if entry.AccountID != accountID || entry.PeriodID != subscription.PeriodID {
			continue
		}
		if entry.Units > 0 {
			granted += entry.Units
		} else {
			used += -entry.Units
		}
	}
	for _, item := range s.state.Reservations {
		if item.AccountID == accountID && item.PeriodID == subscription.PeriodID && item.Status == "reserved" {
			reserved += item.Units
		}
	}
	remaining := granted - used - reserved
	if remaining < 0 {
		remaining = 0
	}
	return Overview{Subscription: subscription, Plan: plan, GrantedCredits: granted, UsedCredits: used, ReservedCredits: reserved, Remaining: remaining}
}

func (s *Store) saveLocked() error {
	if s.path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	temporary := s.path + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, s.path)
}

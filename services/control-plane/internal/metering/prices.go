// Package metering owns the transactional credit ledger. Legacy billing remains a dev-only prototype.
package metering

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
	"math/big"
	"regexp"
	"strconv"
	"time"
)

var (
	ErrValidation = errors.New("VALIDATION_ERROR")
	ErrConflict   = errors.New("IDEMPOTENCY_CONFLICT")
	ErrPrice      = errors.New("PRICE_UNVERIFIED")
	ErrBalance    = errors.New("INSUFFICIENT_CREDITS")
	ErrBudget     = errors.New("TASK_BUDGET_EXCEEDED")
	ErrPending    = errors.New("USAGE_PENDING")
	ErrNotFound   = errors.New("NOT_FOUND")
)
var canonical = regexp.MustCompile(`^(0|[1-9][0-9]{0,18})$`)
var identifier = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)

func Amount(s string) (int64, error) {
	if !canonical.MatchString(s) {
		return 0, ErrValidation
	}
	n, e := strconv.ParseInt(s, 10, 64)
	if e != nil {
		return 0, ErrValidation
	}
	return n, nil
}
func fingerprint(v any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

type Tier struct {
	MinInput int64  `json:"minInputTokens"`
	Input    string `json:"inputPerMillion"`
	Cached   string `json:"cachedInputPerMillion"`
	Output   string `json:"outputPerMillion"`
}
type Price struct {
	ID            string `json:"id"`
	Model         string `json:"modelId"`
	Route         string `json:"routeVersionId"`
	TestOnly      bool   `json:"testOnly"`
	Unit          string `json:"unit"`
	Tiers         []Tier `json:"tiers"`
	InputOverhead int64  `json:"inputOverheadTokens"`
	MaxInput      int64  `json:"maxInputTokens"`
	InputPolicy   string `json:"inputPolicy"`
	Evidence      string `json:"evidenceRef"`
}
type PurchasePrice struct {
	ID              string `json:"id"`
	Unit            string `json:"unit"`
	Tiers           []Tier `json:"tiers"`
	FenNumerator    string `json:"fenNumerator"`
	UnitDenominator string `json:"unitDenominator"`
	Evidence        string `json:"evidenceRef"`
	Group           string `json:"accountGroup"`
	Membership      string `json:"membership"`
}

func validTiers(tiers []Tier) bool {
	if len(tiers) == 0 || len(tiers) > 16 || tiers[0].MinInput != 0 {
		return false
	}
	prev := int64(-1)
	for _, t := range tiers {
		a, e := Amount(t.Input)
		b, e2 := Amount(t.Cached)
		c, e3 := Amount(t.Output)
		if e != nil || e2 != nil || e3 != nil || a <= 0 || c <= 0 || b > a || t.MinInput <= prev || t.MinInput > 1_000_000 {
			return false
		}
		prev = t.MinInput
	}
	return true
}
func (p Price) Validate() error {
	// Test policy and the explicitly approved, limited paid pilot have distinct units.
	if !identifier.MatchString(p.ID) || p.Model != "materials-research" || p.Route != "rootflow-sol-responses-2026-10-01-v1" || !validTiers(p.Tiers) || p.InputOverhead < 0 || p.InputOverhead > 100000 || p.MaxInput < 1 || p.MaxInput > 1_000_000 || p.InputOverhead >= p.MaxInput || len(p.Evidence) < 1 || len(p.Evidence) > 256 {
		return ErrPrice
	}
	if p.Unit == "paid-credit" {
		approved := PaidPrice()
		if (p.ID == CountedPaidPriceID) != (p.InputPolicy == CountedInputPolicy) {
			return ErrPrice
		}
		if p.TestOnly || (p.InputPolicy != approved.InputPolicy && p.InputPolicy != CountedInputPolicy) || p.MaxInput != approved.MaxInput || p.InputOverhead != 0 || fingerprint(p.Tiers) != fingerprint(approved.Tiers) {
			return ErrPrice
		}
	} else if p.Unit != "test-credit" || !p.TestOnly || p.InputPolicy != "utf8-byte-test-estimate-v1" {
		return ErrPrice
	}
	return nil
}
func ceil(n, d *big.Int) (int64, error) {
	v := new(big.Int).Sub(d, big.NewInt(1))
	v.Add(v, n)
	v.Div(v, d)
	if !v.IsInt64() {
		return 0, ErrValidation
	}
	return v.Int64(), nil
}
func quote(input, cached, output int64, t Tier, num, den int64) (int64, error) {
	a, e := Amount(t.Input)
	b, e2 := Amount(t.Cached)
	c, e3 := Amount(t.Output)
	if e != nil || e2 != nil || e3 != nil || input < 0 || cached < 0 || cached > input || output < 0 || num < 1 || den < 1 {
		return 0, ErrValidation
	}
	n := new(big.Int).Mul(big.NewInt(input-cached), big.NewInt(a))
	n.Add(n, new(big.Int).Mul(big.NewInt(cached), big.NewInt(b)))
	n.Add(n, new(big.Int).Mul(big.NewInt(output), big.NewInt(c)))
	n.Mul(n, big.NewInt(num))
	d := new(big.Int).Mul(big.NewInt(1_000_000), big.NewInt(den))
	return ceil(n, d)
}
func tierFor(tiers []Tier, input int64) Tier {
	chosen := tiers[0]
	for _, t := range tiers {
		if t.MinInput > input {
			break
		}
		chosen = t
	}
	return chosen
}
func (p Price) Reserve(payload map[string]any, output int, verifiedBound ...int64) (int64, int64, error) {
	if e := p.Validate(); e != nil {
		return 0, 0, e
	}
	b, e := json.Marshal(payload)
	if e != nil {
		return 0, 0, ErrValidation
	}
	bound := int64(len(b)) + p.InputOverhead
	if p.Unit == "paid-credit" {
		// Pilot exposure ceiling, not a tokenizer estimate. Reject large native bodies.
		// Usage beyond the ceiling is held for review; never debit beyond reservation.
		if len(b) > 32768 {
			return 0, 0, ErrBudget
		}
		bound = p.MaxInput
		if p.InputPolicy == CountedInputPolicy {
			if len(verifiedBound) != 1 || verifiedBound[0] < 1 || verifiedBound[0] > p.MaxInput {
				return 0, 0, ErrPrice
			}
			bound = verifiedBound[0]
		} else if len(verifiedBound) != 0 {
			return 0, 0, ErrPrice
		}
	}
	if bound > p.MaxInput || output < 1 || output > 4096 {
		return 0, 0, ErrBudget
	}
	// Take the worst price among every possible input tier; never reserve a cache discount.
	max := int64(0)
	for _, t := range p.Tiers {
		if t.MinInput > bound {
			break
		}
		q, e := quote(bound, 0, int64(output), t, 1, 1)
		if e != nil {
			return 0, 0, e
		}
		if q > max {
			max = q
		}
	}
	if max < 1 {
		max = 1
	}
	return max, bound, nil
}
func quoteUsage(tiers []Tier, u rootflow.Usage, num, den int64) (int64, error) {
	if u.Input == nil || u.Output == nil {
		return 0, ErrPending
	}
	if *u.Input < 0 || *u.Output < 0 || *u.Input > 9007199254740991 || *u.Output > 9007199254740991 || u.Cached != nil && (*u.Cached < 0 || *u.Cached > *u.Input) || u.Reasoning != nil && (*u.Reasoning < 0 || *u.Reasoning > *u.Output) {
		return 0, ErrValidation
	}
	t := tierFor(tiers, *u.Input)
	cached := int64(0)
	if t.Cached != t.Input {
		if u.Cached == nil {
			return 0, ErrPending
		}
		cached = *u.Cached
	}
	return quote(*u.Input, cached, *u.Output, t, num, den)
}
func (p Price) Quote(u rootflow.Usage) (int64, error) {
	if e := p.Validate(); e != nil {
		return 0, e
	}
	if u.Input != nil && *u.Input > p.MaxInput {
		return 0, ErrBudget
	}
	return quoteUsage(p.Tiers, u, 1, 1)
}
func (p PurchasePrice) Validate() error {
	a, e := Amount(p.FenNumerator)
	b, e2 := Amount(p.UnitDenominator)
	if !identifier.MatchString(p.ID) || !validTiers(p.Tiers) || (p.Unit != "CNY-fen" && p.Unit != "provider-credit-subunit") || a < 1 || b < 1 || (p.Unit == "CNY-fen" && (a != 1 || b != 1)) || e != nil || e2 != nil || len(p.Evidence) < 1 || len(p.Evidence) > 256 || len(p.Group) < 1 || len(p.Membership) < 1 {
		return ErrPrice
	}
	return nil
}
func (p PurchasePrice) Quote(u rootflow.Usage) (int64, error) {
	if e := p.Validate(); e != nil {
		return 0, e
	}
	a, _ := Amount(p.FenNumerator)
	b, _ := Amount(p.UnitDenominator)
	return quoteUsage(p.Tiers, u, a, b)
}
func PutPrice(ctx context.Context, tx pgx.Tx, p Price) error {
	if e := p.Validate(); e != nil {
		return e
	}
	return putVersion(ctx, tx, "sales_price_versions", p.ID, p)
}
func PutPurchase(ctx context.Context, tx pgx.Tx, p PurchasePrice) error {
	if e := p.Validate(); e != nil {
		return e
	}
	return putVersion(ctx, tx, "purchase_price_versions", p.ID, p)
}
func putVersion(ctx context.Context, tx pgx.Tx, table, id string, v any) error {
	b, _ := json.Marshal(v)
	fp := fingerprint(v)
	_, e := tx.Exec(ctx, "INSERT INTO "+table+"(id,body,fingerprint) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING", id, b, fp)
	if e != nil {
		return e
	}
	var old string
	if e = tx.QueryRow(ctx, "SELECT fingerprint FROM "+table+" WHERE id=$1", id).Scan(&old); e != nil {
		return e
	}
	if old != fp {
		return ErrConflict
	}
	return nil
}
func PriceTx(ctx context.Context, tx pgx.Tx, id string) (Price, error) {
	var p Price
	var b []byte
	e := tx.QueryRow(ctx, `SELECT body FROM sales_price_versions WHERE id=$1`, id).Scan(&b)
	if errors.Is(e, pgx.ErrNoRows) {
		return p, ErrPrice
	}
	if e != nil {
		return p, e
	}
	if json.Unmarshal(b, &p) != nil {
		return p, ErrPrice
	}
	return p, p.Validate()
}
func PurchaseTx(ctx context.Context, tx pgx.Tx, id string) (PurchasePrice, error) {
	var p PurchasePrice
	var b []byte
	e := tx.QueryRow(ctx, `SELECT body FROM purchase_price_versions WHERE id=$1`, id).Scan(&b)
	if e != nil {
		return p, e
	}
	if json.Unmarshal(b, &p) != nil {
		return p, ErrPrice
	}
	return p, p.Validate()
}
func stamp(t time.Time) time.Time { return t.UTC() }

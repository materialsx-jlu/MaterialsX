package payments

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"math/big"
	"regexp"
	"strconv"
	"time"
)

var (
	ErrValidation = errors.New("PAYMENT_VALIDATION")
	ErrConflict   = errors.New("PAYMENT_CONFLICT")
	ErrNotFound   = errors.New("PAYMENT_NOT_FOUND")
	ErrDisabled   = errors.New("PAYMENT_DISABLED")
	ErrEvidence   = errors.New("PAYMENT_EVIDENCE_MISMATCH")
	ErrRefund     = errors.New("REFUND_NOT_ELIGIBLE")
)
var identifier = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)

func newID() string {
	var b [15]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic("random unavailable")
	}
	return hex.EncodeToString(b[:])
}
func fp(v any) string {
	b, _ := json.Marshal(v)
	d := sha256.Sum256(b)
	return hex.EncodeToString(d[:])
}
func amount(v int64) string { return strconv.FormatInt(v, 10) }

// General live product publishing remains gated. Only immutable TEST products
// and two exact, explicitly authorized development-pilot snapshots are accepted.
// The pilot does not enable production metering or general commercial sales.
type Product struct {
	ID                  string `json:"id"`
	Name                string `json:"name"`
	Kind                string `json:"kind"`
	Currency            string `json:"currency"`
	PriceFen            string `json:"priceFen"`
	Credits             string `json:"credits"`
	ValidDays           int    `json:"validDays"`
	RefundPolicyVersion string `json:"refundPolicyVersion"`
	RefundRule          string `json:"refundRule"`
	TestOnly            bool   `json:"testOnly"`
	DailyLimit          string `json:"dailyLimit"`
	MonthlyLimit        string `json:"monthlyLimit"`
	RequestLimit        int    `json:"requestLimit"`
}

func (p Product) Validate() error {
	daily, de := metering.Amount(p.DailyLimit)
	monthly, me := metering.Amount(p.MonthlyLimit)
	n, e := metering.Amount(p.PriceFen)
	c, e2 := metering.Amount(p.Credits)
	if de != nil || me != nil || daily < 1 || monthly < daily || monthly > 1000000000 || p.RequestLimit < 1 || p.RequestLimit > 10000 || !identifier.MatchString(p.ID) || len(p.Name) < 1 || len(p.Name) > 120 || (p.Kind != "subscription" && p.Kind != "pack") || p.Currency != "CNY" || e != nil || e2 != nil || n < 1 || n > 100000000 || c < 1 || c > 1000000000 || p.ValidDays < 1 || p.ValidDays > 366 || !identifier.MatchString(p.RefundPolicyVersion) || (p.RefundRule != "unused-proportional-v1" && p.RefundRule != "unused-full-v1") || (!p.TestOnly && p != PilotSubscription() && p != PilotDiagnosticPack() && (p.RefundRule != "unused-full-v1" || p.RefundPolicyVersion != "unused-full-v1")) {
		return ErrValidation
	}
	return nil
}

type Order struct {
	CloseRequested bool       `json:"closeRequested"`
	ID             string     `json:"id"`
	Product        Product    `json:"product"`
	AmountFen      string     `json:"amountFen"`
	Currency       string     `json:"currency"`
	Channel        string     `json:"channel"`
	State          string     `json:"state"`
	Checkout       string     `json:"checkoutState"`
	CodeURL        *string    `json:"codeUrl"`
	RefundedFen    string     `json:"refundedFen"`
	Version        int64      `json:"version"`
	Created        time.Time  `json:"createdAt"`
	Expires        time.Time  `json:"expiresAt"`
	PaidAt         *time.Time `json:"paidAt"`
}
type Refund struct {
	ID        string    `json:"id"`
	OrderID   string    `json:"orderId"`
	AmountFen string    `json:"amountFen"`
	Reason    string    `json:"reason"`
	Approval  string    `json:"approval"`
	Execution string    `json:"execution"`
	Frozen    string    `json:"frozenCredits"`
	Version   int64     `json:"version"`
	Created   time.Time `json:"createdAt"`
}
type Preview struct {
	Refund           Refund `json:"refund"`
	OrderVersion     int64  `json:"orderVersion"`
	Eligible         bool   `json:"eligible"`
	RecoverCredits   string `json:"recoverCredits"`
	AvailableCredits string `json:"availableCredits"`
	HeldCredits      string `json:"heldCredits"`
	Explanation      string `json:"explanation"`
}
type Period struct {
	OrderID   string    `json:"orderId"`
	ProductID string    `json:"productId"`
	Starts    time.Time `json:"startsAt"`
	Ends      time.Time `json:"endsAt"`
	State     string    `json:"state"`
}
type Evidence struct {
	ID               string    `json:"id"`
	OrderID          string    `json:"orderId"`
	RefundID         string    `json:"refundId"`
	TransactionID    string    `json:"transactionId"`
	ProviderRefundID string    `json:"providerRefundId"`
	State            string    `json:"state"`
	Currency         string    `json:"currency"`
	Total            int64     `json:"total"`
	Refund           int64     `json:"refund"`
	Merchant         string    `json:"merchant"`
	AppID            string    `json:"appId"`
	Source           string    `json:"source"`
	PaidAt           time.Time `json:"paidAt"`
}

// Evidence must come from a signature-verified query/notification adapter. There is no public mark-paid endpoint.
type Provider interface {
	Create(context.Context, Order) (string, error)
	Query(context.Context, Order) (Evidence, error)
	Close(context.Context, Order) error
	Refund(context.Context, Order, Refund) (Evidence, error)
	QueryRefund(context.Context, Order, Refund) (Evidence, error)
}

func nextMonth(start time.Time, anchor int) time.Time {
	s := start.UTC()
	y, m, _ := s.Date()
	m++
	if m > 12 {
		m = 1
		y++
	}
	last := time.Date(y, m+1, 0, 0, 0, 0, 0, time.UTC).Day()
	if anchor > last {
		anchor = last
	}
	return time.Date(y, m, anchor, s.Hour(), s.Minute(), s.Second(), s.Nanosecond(), time.UTC)
}

// Cumulative ceiling returns the final rounding remainder with the last refund; never exceeds the original grant.
func recoverCredits(credits, refunded, next, total int64) int64 {
	n := new(big.Int).Mul(big.NewInt(credits), big.NewInt(refunded+next))
	n.Add(n, big.NewInt(total-1))
	n.Quo(n, big.NewInt(total))
	return n.Int64()
}

package mxpoints

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const Precision int64 = 1_000_000

var (
	ErrValidation = errors.New("MX_POINT_VALIDATION")
	ErrConflict   = errors.New("MX_POINT_CONFLICT")
	ErrNotFound   = errors.New("MX_POINT_NOT_FOUND")
	ErrDisabled   = errors.New("MX_POINT_SALES_DISABLED")
	ErrEvidence   = errors.New("MX_POINT_EVIDENCE_MISMATCH")
	ErrBalance    = errors.New("MX_POINT_INSUFFICIENT_BALANCE")
	ErrRefund     = errors.New("MX_POINT_REFUND_NOT_ELIGIBLE")
)

var identifier = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)

func id(prefix string) string {
	var b [15]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("random unavailable")
	}
	return prefix + hex.EncodeToString(b[:])
}
func fingerprint(v any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// Decimal strings prevent JavaScript floating-point loss in public APIs.
func Subunits(v string) (int64, error) {
	parts := strings.Split(v, ".")
	if len(parts) > 2 || len(parts[0]) == 0 || (parts[0] != "0" && strings.HasPrefix(parts[0], "0")) || (len(parts) == 2 && (len(parts[1]) == 0 || len(parts[1]) > 6)) {
		return 0, ErrValidation
	}
	for _, r := range strings.ReplaceAll(v, ".", "") {
		if r < '0' || r > '9' {
			return 0, ErrValidation
		}
	}
	whole, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || whole > (1<<63-1)/Precision {
		return 0, ErrValidation
	}
	n := whole * Precision
	if len(parts) == 2 {
		fraction, err := strconv.ParseInt(parts[1]+strings.Repeat("0", 6-len(parts[1])), 10, 64)
		if err != nil || n > (1<<63-1)-fraction {
			return 0, ErrValidation
		}
		n += fraction
	}
	return n, nil
}
func Points(subunits int64) string {
	whole, fraction := subunits/Precision, subunits%Precision
	if fraction == 0 {
		return strconv.FormatInt(whole, 10)
	}
	return strconv.FormatInt(whole, 10) + "." + strings.TrimRight(strconv.FormatInt(fraction+Precision, 10)[1:], "0")
}

type Product struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	AmountFen     string `json:"amountFen"`
	Points        string `json:"points"`
	PolicyVersion string `json:"refundPolicyVersion"`
	Enabled       bool   `json:"enabled"`
	TestOnly      bool   `json:"testOnly"`
}
type Order struct {
	ID             string     `json:"id"`
	ProductID      string     `json:"productVersionId"`
	AmountFen      string     `json:"amountFen"`
	Points         string     `json:"points"`
	Channel        string     `json:"channel"`
	State          string     `json:"state"`
	CheckoutState  string     `json:"checkoutState"`
	CloseRequested bool       `json:"closeRequested"`
	CodeURL        *string    `json:"codeUrl"`
	Version        int64      `json:"version"`
	CreatedAt      time.Time  `json:"createdAt"`
	ExpiresAt      time.Time  `json:"expiresAt"`
	PaidAt         *time.Time `json:"paidAt"`
}
type Wallet struct {
	Unit         string  `json:"unit"`
	Available    string  `json:"available"`
	Held         string  `json:"held"`
	Consumed     string  `json:"consumed"`
	Frozen       string  `json:"refundFrozen"`
	Returned     string  `json:"returned"`
	LedgerCursor *string `json:"ledgerCursor"`
}
type Refund struct {
	ID        string `json:"id"`
	OrderID   string `json:"orderId"`
	AmountFen string `json:"amountFen"`
	Points    string `json:"points"`
	Approval  string `json:"approval"`
	Execution string `json:"execution"`
	Version   int64  `json:"version"`
	Policy    string `json:"policyVersion"`
}

package mxpricing

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const SnapshotVersion = "mx-v0.3-rootflow-svip-20261007-3model-draft"
const ApprovedVersion = "mx-v0.3-rootflow-svip-20261007-3model-approved-v1"
const SnapshotSHA256 = "f2e6f22827a676b3bc9d5c9959af0380b021d3160481dad0833ea19bdb483160"
const rateScale int64 = 10_000
const fxScale int64 = 100_000_000

var (
	ErrSnapshot = errors.New("MX_PRICE_SNAPSHOT_INVALID")
	ErrConflict = errors.New("MX_PRICE_VERSION_CONFLICT")
	ErrPending  = errors.New("MX_PRICE_USAGE_PENDING")
	ErrQuote    = errors.New("MX_PRICE_QUOTE_INVALID")
)

var decimal = regexp.MustCompile(`^(0|[1-9][0-9]{0,12})(\.[0-9]+)?$`)

type snapshot struct {
	Version                      string   `json:"version"`
	Status                       string   `json:"status"`
	Source                       string   `json:"source"`
	CheckedAt                    string   `json:"checkedAt"`
	RootflowQuotaUnitToCny       string   `json:"rootflowQuotaUnitToCny"`
	CnyPerMxPoint                string   `json:"cnyPerMxPoint"`
	RetailPriceCeilDecimalPlaces int      `json:"retailPriceCeilDecimalPlaces"`
	FieldOrder                   []string `json:"fieldOrder"`
	Models                       []struct {
		ID                            string `json:"id"`
		RetailVsOfficialPercentApprox string `json:"retailVsOfficialPercentApprox"`
		Tiers                         []struct {
			ID              string    `json:"id"`
			InputContextLt  *int64    `json:"inputContextLt"`
			InputContextGte *int64    `json:"inputContextGte"`
			Purchase        [4]string `json:"purchaseCnyPer1m"`
			Retail          [4]string `json:"retailMxPointsPer1m"`
		} `json:"tiers"`
	} `json:"models"`
}

type Tier struct {
	ID       string    `json:"id"`
	MinInput int64     `json:"minInputTokens"`
	Purchase [4]string `json:"purchaseQuotaPer1m,omitempty"`
	Retail   [4]string `json:"retailMxPointsPer1m,omitempty"`
}
type Model struct {
	ID                            string `json:"id"`
	RetailVsOfficialPercentApprox string `json:"retailVsOfficialPercentApprox,omitempty"`
	Tiers                         []Tier `json:"tiers"`
}
type Version struct {
	ID             string  `json:"id"`
	SnapshotHash   string  `json:"snapshotSha256"`
	Status         string  `json:"status"`
	Unit           string  `json:"unit"`
	Models         []Model `json:"models,omitempty"`
	SourceCurrency string  `json:"sourceCurrency,omitempty"`
	TargetCurrency string  `json:"targetCurrency,omitempty"`
	Rate           string  `json:"rate,omitempty"`
	SourceRef      string  `json:"sourceRef"`
}
type Bundle struct {
	Purchase Version `json:"purchase"`
	FX       Version `json:"fx"`
	Retail   Version `json:"retail"`
}
type Usage struct {
	// These are disjoint classes. Nil is unknown, not zero.
	Input       *int64 `json:"inputTokens"`
	Output      *int64 `json:"outputTokens"`
	CacheRead   *int64 `json:"cacheReadTokens"`
	CacheCreate *int64 `json:"cacheCreateTokens"`
}
type Quote struct {
	Model                    string `json:"modelId"`
	Tier                     string `json:"tierId"`
	RetailVersion            string `json:"retailVersionId"`
	PurchaseVersion          string `json:"purchaseVersionId"`
	FXVersion                string `json:"fxVersionId"`
	RetailSubunits           int64  `json:"retailSubunits"`
	PurchaseEstimateMicrofen int64  `json:"purchaseEstimateMicrofen"`
}

func parseDecimal(value string, places int) (int64, error) {
	if !decimal.MatchString(value) {
		return 0, ErrSnapshot
	}
	parts := strings.Split(value, ".")
	if len(parts) == 2 && (len(parts[1]) > places || strings.HasSuffix(parts[1], "0")) {
		return 0, ErrSnapshot
	}
	whole, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, ErrSnapshot
	}
	scale := int64(1)
	for range places {
		scale *= 10
	}
	if whole > (1<<63-1)/scale {
		return 0, ErrSnapshot
	}
	n := whole * scale
	if len(parts) == 2 {
		frac, err := strconv.ParseInt(parts[1]+strings.Repeat("0", places-len(parts[1])), 10, 64)
		if err != nil || n > (1<<63-1)-frac {
			return 0, ErrSnapshot
		}
		n += frac
	}
	return n, nil
}

// Reject duplicate JSON keys before parsing a financial snapshot. Different
// parsers otherwise disagree on which price wins.
func rejectDuplicateKeys(raw []byte) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var value func() error
	value = func() error {
		token, err := d.Token()
		if err != nil {
			return ErrSnapshot
		}
		if delimiter, ok := token.(json.Delim); ok {
			switch delimiter {
			case '{':
				seen := map[string]bool{}
				for d.More() {
					key, err := d.Token()
					name, valid := key.(string)
					if err != nil || !valid || seen[name] {
						return ErrSnapshot
					}
					seen[name] = true
					if err = value(); err != nil {
						return err
					}
				}
			case '[':
				for d.More() {
					if err := value(); err != nil {
						return err
					}
				}
			default:
				return ErrSnapshot
			}
			if _, err := d.Token(); err != nil {
				return ErrSnapshot
			}
		}
		return nil
	}
	if err := value(); err != nil {
		return err
	}
	if _, err := d.Token(); !errors.Is(err, io.EOF) {
		return ErrSnapshot
	}
	return nil
}

func ParseSnapshot(raw []byte) (Bundle, error) {
	var out Bundle
	if len(raw) == 0 || len(raw) > 64*1024 || rejectDuplicateKeys(raw) != nil {
		return out, ErrSnapshot
	}
	hash := sha256.Sum256(raw)
	if hex.EncodeToString(hash[:]) != SnapshotSHA256 {
		return out, ErrSnapshot
	}
	var in snapshot
	if json.Unmarshal(raw, &in) != nil || in.Version != SnapshotVersion || in.Status != "draft" || in.RootflowQuotaUnitToCny != "1" || in.CnyPerMxPoint != "0.1" || in.RetailPriceCeilDecimalPlaces != 4 || in.Source != "https://rootflowai.com/pricing" || in.CheckedAt != "2026-10-07" || len(in.FieldOrder) != 4 || len(in.Models) != 3 {
		return out, ErrSnapshot
	}
	for i, field := range []string{"input", "output", "cacheRead", "cacheCreate"} {
		if in.FieldOrder[i] != field {
			return out, ErrSnapshot
		}
	}
	base := Version{SnapshotHash: SnapshotSHA256, Status: "draft", SourceRef: in.Source}
	out.Purchase, out.FX, out.Retail = base, base, base
	out.Purchase.ID, out.Purchase.Unit = in.Version+"-purchase", "ROOTFLOW_QUOTA_PER_1M"
	out.FX.ID, out.FX.Unit = in.Version+"-fx", "SOURCE_TO_CNY"
	out.FX.SourceCurrency, out.FX.TargetCurrency, out.FX.Rate = "ROOTFLOW_QUOTA", "CNY", in.RootflowQuotaUnitToCny
	out.Retail.ID, out.Retail.Unit = in.Version+"-retail", "MX_POINTS_PER_1M"
	if rate, err := parseDecimal(out.FX.Rate, 8); err != nil || rate != fxScale {
		return Bundle{}, ErrSnapshot
	}
	for index, model := range in.Models {
		ids := []string{"gpt-5.6-sol", "claude-opus-5-5", "claude-fable-5-1"}
		if model.ID != ids[index] || len(model.Tiers) != map[bool]int{true: 2, false: 1}[index == 0] {
			return Bundle{}, ErrSnapshot
		}
		purchase := Model{ID: model.ID}
		retail := Model{ID: model.ID, RetailVsOfficialPercentApprox: model.RetailVsOfficialPercentApprox}
		comparison, comparisonErr := parseDecimal(model.RetailVsOfficialPercentApprox, 2)
		if comparisonErr != nil || comparison < 1 || comparison > 10000 {
			return Bundle{}, ErrSnapshot
		}
		for tierIndex, tier := range model.Tiers {
			min := int64(0)
			if index == 0 {
				if tierIndex == 0 && (tier.ID != "standard" || tier.InputContextLt == nil || *tier.InputContextLt != 272000 || tier.InputContextGte != nil) {
					return Bundle{}, ErrSnapshot
				}
				if tierIndex == 1 && (tier.ID != "long_context" || tier.InputContextGte == nil || *tier.InputContextGte != 272000 || tier.InputContextLt != nil) {
					return Bundle{}, ErrSnapshot
				}
				if tierIndex == 1 {
					min = 272000
				}
			} else if tier.ID != "standard" || tier.InputContextLt != nil || tier.InputContextGte != nil {
				return Bundle{}, ErrSnapshot
			}
			p := Tier{ID: tier.ID, MinInput: min, Purchase: tier.Purchase}
			r := Tier{ID: tier.ID, MinInput: min, Retail: tier.Retail}
			for class := range 4 {
				a, ea := parseDecimal(p.Purchase[class], 4)
				b, eb := parseDecimal(r.Retail[class], 4)
				if ea != nil || eb != nil || a < 1 || b < 1 {
					return Bundle{}, ErrSnapshot
				}
			}
			purchase.Tiers = append(purchase.Tiers, p)
			retail.Tiers = append(retail.Tiers, r)
		}
		out.Purchase.Models = append(out.Purchase.Models, purchase)
		out.Retail.Models = append(out.Retail.Models, retail)
	}
	return out, nil
}

func ImportSnapshot(ctx context.Context, pool *pgxpool.Pool, raw []byte) (Bundle, error) {
	bundle, err := ParseSnapshot(raw)
	if err != nil {
		return Bundle{}, err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Bundle{}, err
	}
	defer tx.Rollback(ctx)
	for _, entry := range []struct {
		table   string
		version Version
	}{
		{"mx_purchase_price_versions", bundle.Purchase},
		{"mx_fx_versions", bundle.FX},
		{"mx_retail_price_versions", bundle.Retail},
	} {
		body, _ := json.Marshal(entry.version)
		fingerprint, err := canonicalFingerprint(body)
		if err != nil {
			return Bundle{}, err
		}
		_, err = tx.Exec(ctx, `INSERT INTO `+entry.table+`(id,status,body,fingerprint,source_ref) VALUES($1,'draft',$2,$3,$4) ON CONFLICT(id) DO NOTHING`, entry.version.ID, body, fingerprint, entry.version.SourceRef)
		if err != nil {
			return Bundle{}, err
		}
		var prior string
		if err = tx.QueryRow(ctx, `SELECT fingerprint FROM `+entry.table+` WHERE id=$1`, entry.version.ID).Scan(&prior); err != nil {
			return Bundle{}, err
		}
		if prior != fingerprint {
			return Bundle{}, ErrConflict
		}
	}
	return bundle, tx.Commit(ctx)
}

// ApproveSnapshot publishes new immutable version IDs. The draft rows are never
// mutated; callers must supply the exact reviewed source bytes and opt in via
// the dedicated administrative command.
func ApproveSnapshot(ctx context.Context, pool *pgxpool.Pool, raw []byte) (Bundle, error) {
	bundle, err := ParseSnapshot(raw)
	if err != nil {
		return Bundle{}, err
	}
	for _, version := range []*Version{&bundle.Purchase, &bundle.FX, &bundle.Retail} {
		version.ID = strings.Replace(version.ID, SnapshotVersion, ApprovedVersion, 1)
		version.Status = "approved"
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Bundle{}, err
	}
	defer tx.Rollback(ctx)
	for _, entry := range []struct {
		table   string
		version Version
	}{
		{"mx_purchase_price_versions", bundle.Purchase}, {"mx_fx_versions", bundle.FX}, {"mx_retail_price_versions", bundle.Retail},
	} {
		body, _ := json.Marshal(entry.version)
		fingerprint, err := canonicalFingerprint(body)
		if err != nil {
			return Bundle{}, err
		}
		_, err = tx.Exec(ctx, `INSERT INTO `+entry.table+`(id,status,body,fingerprint,source_ref) VALUES($1,'approved',$2,$3,$4) ON CONFLICT(id) DO NOTHING`, entry.version.ID, body, fingerprint, entry.version.SourceRef)
		if err != nil {
			return Bundle{}, err
		}
		var prior string
		if err = tx.QueryRow(ctx, `SELECT fingerprint FROM `+entry.table+` WHERE id=$1`, entry.version.ID).Scan(&prior); err != nil {
			return Bundle{}, err
		}
		if prior != fingerprint {
			return Bundle{}, ErrConflict
		}
	}
	return bundle, tx.Commit(ctx)
}

func LoadBundle(ctx context.Context, tx pgx.Tx, purchaseID, fxID, retailID string) (Bundle, error) {
	var out Bundle
	for _, entry := range []struct {
		table, id string
		target    *Version
	}{
		{"mx_purchase_price_versions", purchaseID, &out.Purchase},
		{"mx_fx_versions", fxID, &out.FX},
		{"mx_retail_price_versions", retailID, &out.Retail},
	} {
		var body []byte
		var status, storedFP string
		if err := tx.QueryRow(ctx, `SELECT body,status,fingerprint FROM `+entry.table+` WHERE id=$1`, entry.id).Scan(&body, &status, &storedFP); err != nil {
			return Bundle{}, ErrSnapshot
		}
		fingerprint, err := canonicalFingerprint(body)
		if err != nil || fingerprint != storedFP || json.Unmarshal(body, entry.target) != nil || entry.target.ID != entry.id || entry.target.Status != status {
			return Bundle{}, ErrSnapshot
		}
	}
	if out.Purchase.SnapshotHash == "" || out.Purchase.SnapshotHash != out.FX.SnapshotHash || out.FX.SnapshotHash != out.Retail.SnapshotHash || (out.Purchase.SnapshotHash != SnapshotSHA256 && !strings.HasPrefix(out.Purchase.SnapshotHash, "mx-model:")) {
		return Bundle{}, ErrSnapshot
	}
	if out.Purchase.SnapshotHash != SnapshotSHA256 && !validDynamicBundle(out) {
		return Bundle{}, ErrSnapshot
	}
	return out, nil
}

func canonicalFingerprint(body []byte) (string, error) {
	var value any
	if err := json.Unmarshal(body, &value); err != nil {
		return "", ErrSnapshot
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return "", ErrSnapshot
	}
	hash := sha256.Sum256(canonical)
	return hex.EncodeToString(hash[:]), nil
}

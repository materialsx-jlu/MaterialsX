package mxpoints

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"

	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/mxpricing"
	"github.com/jamip/materialsx/control-plane/internal/mxrelease"
	"time"
)

type PricedRequest struct {
	RequestID         string
	TaskID            string
	ModelID           string
	RouteVersion      string
	PurchaseVersionID string
	FXVersionID       string
	RetailVersionID   string
	InputBound        int64
	OutputBound       int64
}

// ReservePriced pins the price and route in the same transaction as the hold.
func (s *Store) ReservePriced(ctx context.Context, owner string, in PricedRequest) (int64, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	bound, err := s.ReservePricedTx(ctx, tx, owner, in)
	if err != nil {
		return 0, err
	}
	return bound, tx.Commit(ctx)
}

// ReservePricedTx lets the gateway commit request admission and the MX hold atomically.
func (s *Store) ReservePricedTx(ctx context.Context, tx pgx.Tx, owner string, in PricedRequest) (int64, error) {
	if s.Mode != "test" && s.Mode != "wechat" && s.Mode != "wechat-live" && s.Mode != "wechat-production" {
		return 0, ErrDisabled
	}
	if err := s.productionReadyTx(ctx, tx); err != nil {
		return 0, err
	}
	if s.Mode == "wechat-production" {
		a, err := mxrelease.Read(s.ReleasePath, time.Now().UTC())
		if err != nil || !a.Allows(in.ModelID, in.RouteVersion) {
			return 0, ErrDisabled
		}
	}
	if s.Mode == "wechat-production" && (in.PurchaseVersionID != s.ReleaseID+"-purchase" || in.FXVersionID != s.ReleaseID+"-fx" || in.RetailVersionID != s.ReleaseID+"-retail") {
		var published bool
		err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM mx_cloud_models WHERE id=$1 AND route_version=$2 AND purchase_version_id=$3 AND fx_version_id=$4 AND retail_version_id=$5 AND status='active' AND deployed_version=version)`, in.ModelID, in.RouteVersion, in.PurchaseVersionID, in.FXVersionID, in.RetailVersionID).Scan(&published)
		if err != nil || !published {
			return 0, ErrDisabled
		}
	}
	if !identifier.MatchString(in.RequestID) || !identifier.MatchString(in.RouteVersion) || (in.TaskID != "" && !identifier.MatchString(in.TaskID)) {
		return 0, ErrValidation
	}
	bundle, err := mxpricing.LoadBundle(ctx, tx, in.PurchaseVersionID, in.FXVersionID, in.RetailVersionID)
	if err != nil {
		return 0, err
	}
	status := "approved"
	if s.Mode == "test" {
		status = "draft"
	}
	if bundle.Purchase.Status != status || bundle.FX.Status != status || bundle.Retail.Status != status {
		return 0, ErrDisabled
	}
	bound, err := mxpricing.ReserveBound(bundle, in.ModelID, in.InputBound, in.OutputBound)
	if err != nil || bound < 1 {
		return 0, ErrValidation
	}
	if err = s.reserveTx(ctx, tx, owner, in.RequestID, bound); err != nil {
		return 0, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO mx_priced_reservations(request_id,account_id,task_id,model_id,route_version,retail_version_id,purchase_version_id,fx_version_id,input_bound,output_bound)
 VALUES($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(request_id) DO NOTHING`,
		in.RequestID, owner, in.TaskID, in.ModelID, in.RouteVersion, in.RetailVersionID, in.PurchaseVersionID, in.FXVersionID, in.InputBound, in.OutputBound)
	if err != nil {
		return 0, err
	}
	var prior PricedRequest
	err = tx.QueryRow(ctx, `SELECT COALESCE(task_id,''),model_id,route_version,purchase_version_id,fx_version_id,retail_version_id,input_bound,output_bound FROM mx_priced_reservations WHERE request_id=$1 AND account_id=$2`, in.RequestID, owner).
		Scan(&prior.TaskID, &prior.ModelID, &prior.RouteVersion, &prior.PurchaseVersionID, &prior.FXVersionID, &prior.RetailVersionID, &prior.InputBound, &prior.OutputBound)
	if err != nil {
		return 0, err
	}
	prior.RequestID = in.RequestID
	if prior != in {
		return 0, ErrConflict
	}
	return bound, nil
}

// SettlePriced requires independent, complete, disjoint-class usage evidence.
// Missing or over-bound evidence leaves the full hold in reconciliation_pending.
// The gateway uses the transaction variant below to make settlement atomic.
func (s *Store) SettlePriced(ctx context.Context, owner, requestID string, usage mxpricing.Usage, evidenceRef string) (mxpricing.Quote, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return mxpricing.Quote{}, err
	}
	defer tx.Rollback(ctx)
	quote, pending, err := s.SettlePricedTx(ctx, tx, owner, requestID, usage, evidenceRef)
	if err != nil {
		return mxpricing.Quote{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return mxpricing.Quote{}, err
	}
	if pending {
		return mxpricing.Quote{}, mxpricing.ErrPending
	}
	return quote, nil
}

// SettlePricedTx returns pending=true after storing an evidence gap; the caller
// must still commit the transaction so the full hold remains for reconciliation.
func (s *Store) SettlePricedTx(ctx context.Context, tx pgx.Tx, owner, requestID string, usage mxpricing.Usage, evidenceRef string) (mxpricing.Quote, bool, error) {
	if s.Mode != "test" && s.Mode != "wechat" && s.Mode != "wechat-live" && s.Mode != "wechat-production" {
		return mxpricing.Quote{}, false, ErrDisabled
	}
	if !identifier.MatchString(requestID) {
		return mxpricing.Quote{}, false, ErrValidation
	}
	if err := lockAccount(ctx, tx, owner, false); err != nil {
		return mxpricing.Quote{}, false, err
	}
	var model, purchaseID, fxID, retailID, state string
	var inputBound, outputBound int64
	var priorUsage []byte
	var priorEvidence *string
	err := tx.QueryRow(ctx, `SELECT p.model_id,p.purchase_version_id,p.fx_version_id,p.retail_version_id,p.input_bound,p.output_bound,r.state,p.usage,p.usage_evidence_ref
 FROM mx_priced_reservations p JOIN mx_point_reservations r ON r.id=p.request_id
 WHERE p.request_id=$1 AND p.account_id=$2 FOR UPDATE OF p,r`, requestID, owner).
		Scan(&model, &purchaseID, &fxID, &retailID, &inputBound, &outputBound, &state, &priorUsage, &priorEvidence)
	if errors.Is(err, pgx.ErrNoRows) {
		return mxpricing.Quote{}, false, ErrNotFound
	}
	if err != nil {
		return mxpricing.Quote{}, false, err
	}
	bundle, err := mxpricing.LoadBundle(ctx, tx, purchaseID, fxID, retailID)
	if err != nil {
		return mxpricing.Quote{}, false, err
	}
	// Some suppliers count reasoning tokens beyond max_output_tokens. Their
	// complete usage is retained for procurement, but a user is charged for at
	// most the output they authorized and that was reserved up front.
	billable := usage
	if usage.Output != nil && *usage.Output > outputBound {
		capped := outputBound
		billable.Output = &capped
	}
	quote, priceErr := mxpricing.Price(bundle, model, billable)
	actualQuote, actualErr := mxpricing.Price(bundle, model, usage)
	if priceErr == nil && actualErr == nil {
		quote.PurchaseEstimateMicrofen = actualQuote.PurchaseEstimateMicrofen
	}
	complete := priceErr == nil && actualErr == nil && identifier.MatchString(evidenceRef) && usage.Input != nil && usage.Output != nil && usage.CacheRead != nil && usage.CacheCreate != nil
	if complete {
		input := *usage.Input + *usage.CacheRead + *usage.CacheCreate
		complete = *usage.Input <= inputBound && *usage.CacheRead <= inputBound && *usage.CacheCreate <= inputBound && input <= inputBound
	}
	if !complete {
		if state == "settled" || state == "released" {
			return mxpricing.Quote{}, false, ErrConflict
		}
		if state == "reserved" {
			_, err = tx.Exec(ctx, `UPDATE mx_point_reservations SET state='reconciliation_pending' WHERE id=$1`, requestID)
			if err != nil {
				return mxpricing.Quote{}, false, err
			}
		}
		return mxpricing.Quote{}, true, nil
	}
	encoded, _ := json.Marshal(usage)
	if state == "released" {
		return mxpricing.Quote{}, false, ErrConflict
	}
	if state == "settled" {
		var old mxpricing.Usage
		if json.Unmarshal(priorUsage, &old) != nil {
			return mxpricing.Quote{}, false, ErrConflict
		}
		oldJSON, _ := json.Marshal(old)
		if priorEvidence == nil || *priorEvidence != evidenceRef || !bytes.Equal(oldJSON, encoded) {
			return mxpricing.Quote{}, false, ErrConflict
		}
		return quote, false, nil
	}
	if err = s.finishReservationTx(ctx, tx, owner, requestID, &quote.RetailSubunits, true); err != nil {
		return mxpricing.Quote{}, false, err
	}
	_, err = tx.Exec(ctx, `UPDATE mx_priced_reservations SET usage=$2,usage_evidence_ref=$3,tier_id=$4,purchase_estimate_microfen=$5,cost_state='estimated' WHERE request_id=$1`,
		requestID, encoded, evidenceRef, quote.Tier, quote.PurchaseEstimateMicrofen)
	if err != nil {
		return mxpricing.Quote{}, false, err
	}
	return quote, false, nil
}

func (s *Store) ReleasePriced(ctx context.Context, owner, requestID string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = s.ReleasePricedTx(ctx, tx, owner, requestID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) ReleasePricedTx(ctx context.Context, tx pgx.Tx, owner, requestID string) error {
	if s.Mode != "test" && s.Mode != "wechat" && s.Mode != "wechat-live" && s.Mode != "wechat-production" {
		return ErrDisabled
	}
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM mx_priced_reservations WHERE request_id=$1 AND account_id=$2)`, requestID, owner).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	if err := s.finishReservationTx(ctx, tx, owner, requestID, nil, true); err != nil {
		return err
	}
	return nil
}

// RecordSupplierBill is for a trusted reconciliation worker. The supplier
// amount is independent of LiteLLM's estimate and never changes the user debit.
func (s *Store) RecordSupplierBill(ctx context.Context, owner, requestID, billRef string, amountMicrofen int64) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = s.RecordSupplierBillTx(ctx, tx, owner, requestID, billRef, amountMicrofen); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// RecordSupplierBillTx lets a trusted reconciler commit the supplier bill and
// wallet settlement together. A different second bill remains a conflict.
func (s *Store) RecordSupplierBillTx(ctx context.Context, tx pgx.Tx, owner, requestID, billRef string, amountMicrofen int64) error {
	if s.Mode != "test" && s.Mode != "wechat" && s.Mode != "wechat-live" && s.Mode != "wechat-production" {
		return ErrDisabled
	}
	if !identifier.MatchString(requestID) || !identifier.MatchString(billRef) || amountMicrofen < 0 {
		return ErrValidation
	}
	var estimated int64
	var priorState string
	var priorAmount *int64
	var priorRef *string
	err := tx.QueryRow(ctx, `SELECT purchase_estimate_microfen,supplier_bill_microfen,supplier_bill_ref,cost_state FROM mx_priced_reservations WHERE request_id=$1 AND account_id=$2 AND cost_state IN ('estimated','verified','disputed') FOR UPDATE`, requestID, owner).Scan(&estimated, &priorAmount, &priorRef, &priorState)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	state := supplierCostState(estimated, amountMicrofen)
	if priorAmount != nil {
		if *priorAmount != amountMicrofen || priorRef == nil || *priorRef != billRef {
			return ErrConflict
		}
		if priorState != state {
			_, err = tx.Exec(ctx, `UPDATE mx_priced_reservations SET cost_state=$2 WHERE request_id=$1`, requestID, state)
			if err != nil {
				return err
			}
		}
		return nil
	}
	_, err = tx.Exec(ctx, `UPDATE mx_priced_reservations SET supplier_bill_microfen=$2,supplier_bill_ref=$3,cost_state=$4 WHERE request_id=$1`, requestID, amountMicrofen, billRef, state)
	if err != nil {
		return err
	}
	return nil
}

func supplierCostState(estimated, amount int64) string {
	// RootFlow's displayed bill rounds each request up to six decimal quota
	// units (100 microfen). Keep the exact bill, while recognizing that one
	// documented rounding step is not a procurement price discrepancy.
	rounded := estimated
	if rest := estimated % 100; rest != 0 && estimated <= math.MaxInt64-(100-rest) {
		rounded += 100 - rest
	}
	if amount == estimated || amount == rounded {
		return "verified"
	}
	return "disputed"
}

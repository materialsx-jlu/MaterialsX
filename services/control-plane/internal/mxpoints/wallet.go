package mxpoints

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

func (s *Store) Wallet(ctx context.Context, owner string) (Wallet, error) {
	var granted, held, consumed, frozen, returned int64
	err := s.Pool.QueryRow(ctx, `SELECT COALESCE(sum(granted),0),COALESCE(sum(held),0),COALESCE(sum(consumed),0),COALESCE(sum(frozen),0),COALESCE(sum(returned),0)
 FROM mx_point_batches WHERE account_id=$1`, owner).Scan(&granted, &held, &consumed, &frozen, &returned)
	if err != nil {
		return Wallet{}, err
	}
	return Wallet{Unit: "mx-point", Available: Points(granted - held - consumed - frozen - returned),
		Held: Points(held), Consumed: Points(consumed), Frozen: Points(frozen), Returned: Points(returned)}, nil
}

type allocation struct {
	order string
	n     int64
}

// Reserve atomically holds exact subunits. Public debit remains unavailable.
func (s *Store) Reserve(ctx context.Context, owner, request string, subunits int64) error {
	if !identifier.MatchString(request) || subunits < 1 {
		return ErrValidation
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = s.reserveTx(ctx, tx, owner, request, subunits); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) reserveTx(ctx context.Context, tx pgx.Tx, owner, request string, subunits int64) error {
	if err := lockAccount(ctx, tx, owner, true); err != nil {
		return err
	}
	var previous int64
	var previousState string
	err := tx.QueryRow(ctx, `SELECT reserved,state FROM mx_point_reservations WHERE id=$1 AND account_id=$2`, request, owner).Scan(&previous, &previousState)
	if err == nil {
		if previous != subunits || previousState != "reserved" {
			return ErrConflict
		}
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT order_id,granted-held-consumed-frozen-returned FROM mx_point_batches
 WHERE account_id=$1 AND granted>held+consumed+frozen+returned ORDER BY order_id FOR UPDATE`, owner)
	if err != nil {
		return err
	}
	remaining := subunits
	parts := []allocation{}
	for rows.Next() {
		var order string
		var available int64
		if err = rows.Scan(&order, &available); err != nil {
			rows.Close()
			return err
		}
		if remaining > 0 {
			take := available
			if take > remaining {
				take = remaining
			}
			parts = append(parts, allocation{order, take})
			remaining -= take
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if remaining != 0 {
		return ErrBalance
	}
	_, err = tx.Exec(ctx, `INSERT INTO mx_point_reservations(id,account_id,reserved,state) VALUES($1,$2,$3,'reserved')`, request, owner, subunits)
	if err != nil {
		return err
	}
	for _, a := range parts {
		if _, err = tx.Exec(ctx, `UPDATE mx_point_batches SET held=held+$2 WHERE order_id=$1`, a.order, a.n); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO mx_point_allocations(reservation_id,order_id,subunits) VALUES($1,$2,$3)`, request, a.order, a.n); err != nil {
			return err
		}
		if err = ledger(ctx, tx, owner, a.order, request, "", "mx:reserve:"+request+":"+a.order, "reserve", 0, a.n, 0, 0, 0); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) finishReservation(ctx context.Context, owner, request string, charge *int64) error {
	if !identifier.MatchString(request) || (charge != nil && *charge < 0) {
		return ErrValidation
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = s.finishReservationTx(ctx, tx, owner, request, charge, false); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) finishReservationTx(ctx context.Context, tx pgx.Tx, owner, request string, charge *int64, priced bool) error {
	if err := lockAccount(ctx, tx, owner, false); err != nil {
		return err
	}
	var reserved int64
	var prior *int64
	var state string
	err := tx.QueryRow(ctx, `SELECT reserved,charged,state FROM mx_point_reservations WHERE id=$1 AND account_id=$2 FOR UPDATE`, request, owner).Scan(&reserved, &prior, &state)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if !priced {
		var linked bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM mx_priced_reservations WHERE request_id=$1)`, request).Scan(&linked); err != nil {
			return err
		}
		if linked {
			return ErrConflict
		}
	}
	requested := int64(0)
	if charge != nil {
		requested = *charge
	}
	if requested > reserved {
		return ErrBalance
	}
	if state == "settled" || state == "released" {
		if prior == nil || *prior != requested || (state == "released") != (charge == nil) {
			return ErrConflict
		}
		return nil
	}
	if state != "reserved" && !(priced && state == "reconciliation_pending") {
		return ErrConflict // Reconciliation holds cannot be spent or released without evidence.
	}
	rows, err := tx.Query(ctx, `SELECT order_id,subunits FROM mx_point_allocations WHERE reservation_id=$1 ORDER BY order_id`, request)
	if err != nil {
		return err
	}
	parts := []allocation{}
	for rows.Next() {
		var a allocation
		if err = rows.Scan(&a.order, &a.n); err != nil {
			rows.Close()
			return err
		}
		parts = append(parts, a)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	remaining := requested
	for _, a := range parts {
		spent := a.n
		if spent > remaining {
			spent = remaining
		}
		remaining -= spent
		if _, err = tx.Exec(ctx, `UPDATE mx_point_batches SET held=held-$2,consumed=consumed+$3 WHERE order_id=$1`, a.order, a.n, spent); err != nil {
			return err
		}
		kind := "settle"
		if charge == nil {
			kind = "release"
		}
		if err = ledger(ctx, tx, owner, a.order, request, "", "mx:"+kind+":"+request+":"+a.order, kind, 0, -a.n, spent, 0, 0); err != nil {
			return err
		}
	}
	if remaining != 0 {
		return ErrConflict
	}
	next := "settled"
	if charge == nil {
		next = "released"
	}
	_, err = tx.Exec(ctx, `UPDATE mx_point_reservations SET state=$2,charged=$3,settled_at=clock_timestamp() WHERE id=$1`, request, next, requested)
	if err != nil {
		return err
	}
	return nil
}
func (s *Store) Settle(ctx context.Context, owner, request string, charge int64) error {
	return s.finishReservation(ctx, owner, request, &charge)
}
func (s *Store) Release(ctx context.Context, owner, request string) error {
	return s.finishReservation(ctx, owner, request, nil)
}

// Exact internal representation is useful to metering, while public values stay decimal strings.
func (s *Store) AvailableSubunits(ctx context.Context, owner string) (int64, error) {
	var n int64
	err := s.Pool.QueryRow(ctx, `SELECT COALESCE(sum(granted-held-consumed-frozen-returned),0) FROM mx_point_batches WHERE account_id=$1`, owner).Scan(&n)
	return n, err
}

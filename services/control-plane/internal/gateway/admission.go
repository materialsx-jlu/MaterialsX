package gateway

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/lifecycle"
)

func paidAdmission(ctx context.Context, tx pgx.Tx, owner, designated string) (bool, error) {
	if designated == "" || (designated != "*" && owner != designated) {
		return false, nil
	}
	if designated == "*" {
		var enrolled bool
		if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM beta_enrollments WHERE account_id=$1 AND state='active')`, owner).Scan(&enrolled); e != nil || !enrolled {
			return false, e
		}
	}
	var ok bool
	e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM subscription_periods sp JOIN payment_orders o ON o.id=sp.order_id JOIN credit_grants g ON g.id=o.grant_id WHERE sp.account_id=$1 AND sp.state='active' AND sp.starts_at<=clock_timestamp() AND sp.ends_at>clock_timestamp() AND o.channel='wechat' AND o.state IN ('paid','partially_refunded') AND g.unit='paid-credit')`, owner).Scan(&ok)
	return ok, e
}

func (s *Store) betaCurrent() bool {
	if s.Config.PaidAccount != "*" {
		return true
	}
	a, e := lifecycle.ReadApprovals(s.Config.ApprovalsPath, RouteVersion)
	return e == nil && len(a.Missing(time.Now().UTC())) == 0
}

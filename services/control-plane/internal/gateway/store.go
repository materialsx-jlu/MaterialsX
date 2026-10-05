package gateway

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/lifecycle"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
	"regexp"
	"time"
)

var identifier = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)

func hash(v string) string { n := sha256.Sum256([]byte(v)); return hex.EncodeToString(n[:]) }
func newID() string {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		panic("secure random unavailable")
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

type Store struct {
	Pool   *pgxpool.Pool
	Config Config
}

func (s *Store) Grant(ctx context.Context, account string, limit int, expires time.Time) error {
	if limit < 1 || limit > 10000 || !expires.After(time.Now()) || expires.After(time.Now().Add(31*24*time.Hour)) {
		return ErrValidation
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	// A grant is an absolute ceiling, not a reset of consumed requests.
	_, e = tx.Exec(ctx, `INSERT INTO cloud_access(account_id,request_limit,expires_at) VALUES($1,$2,$3) ON CONFLICT(account_id) DO UPDATE SET request_limit=EXCLUDED.request_limit,expires_at=EXCLUDED.expires_at,version=cloud_access.version+1`, account, limit, expires)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO audit_events(action,target_id,result,reason) VALUES('cloud.alpha_grant',$1,'succeeded','deployment grant')`, account)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func liveAccount(ctx context.Context, tx pgx.Tx, p identity.Principal) error {
	var active bool
	e := tx.QueryRow(ctx, `SELECT status='active' FROM accounts WHERE id=$1 FOR UPDATE`, p.ID).Scan(&active)
	if e != nil || !active {
		return ErrForbidden
	}
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions s JOIN devices d ON d.id=s.device_id WHERE s.id=$1 AND s.account_id=$2 AND s.revoked_at IS NULL AND d.revoked_at IS NULL AND s.expires_at>clock_timestamp())`, p.SessionID, p.ID).Scan(&active)
	if e != nil {
		return e
	}
	if !active {
		return ErrForbidden
	}
	return nil
}
func (s *Store) Create(ctx context.Context, p identity.Principal, in CreateTask, key string) (Task, error) {
	if !s.betaCurrent() {
		return Task{}, ErrUnavailable
	}
	t := Task{ID: newID(), ClientID: in.ClientID, Model: in.Model, Mode: in.Mode, Budget: in.Budget, Consent: in.Consent, State: "created", Quality: "not_evaluated", Created: time.Now().UTC()}
	t.Deadline = t.Created.Add(time.Duration(in.Budget.MaxDuration) * time.Second)
	if !s.Config.Enabled {
		return t, ErrUnavailable
	}
	if !identifier.MatchString(key) || !identifier.MatchString(in.ClientID) || in.Model != ModelAlias || (in.Mode != "alpha-test" && in.Mode != "test-credits" && in.Mode != "paid-credits") || in.Budget.MaxRequests < 1 || in.Budget.MaxRequests > s.Config.MaxRequests || in.Budget.MaxOutput < 1 || in.Budget.MaxOutput > s.Config.MaxOutputTokens || in.Budget.MaxDuration < 1 || in.Budget.MaxDuration > s.Config.MaxDurationSeconds || in.Consent.Policy != ConsentVersion || !in.Consent.Prompt || in.Consent.History != "platform-only" || in.Consent.Files < 0 || in.Consent.Files > 8 || in.Consent.Skills < 0 || in.Consent.Skills > 8 {
		return t, ErrValidation
	}
	var maxCredits *int64
	var sales, purchase *string
	precision := int64(1)
	if in.Mode == "paid-credits" {
		precision = metering.PaidPrecision
	}
	if (s.Config.PaidAccount != "") != (in.Mode == "paid-credits") {
		return t, ErrValidation
	}
	if in.Mode == "test-credits" || in.Mode == "paid-credits" {
		var n int64
		var e error
		if precision == metering.PaidPrecision {
			n, e = metering.DecimalAmount(in.Budget.MaxCredits)
		} else {
			n, e = metering.Amount(in.Budget.MaxCredits)
		}
		if e != nil || n < 1 {
			return t, ErrValidation
		}
		if s.Config.SalesPriceVersion == "" {
			return t, metering.ErrPrice
		}
		maxCredits = &n
		v := s.Config.SalesPriceVersion
		sales = &v
		if s.Config.PurchasePriceVersion != "" {
			v := s.Config.PurchasePriceVersion
			purchase = &v
		}
	}
	if in.Mode == "alpha-test" && (in.Budget.MaxCredits != "" || s.Config.SalesPriceVersion != "") {
		return t, ErrValidation
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return t, e
	}
	defer tx.Rollback(ctx)
	if e = liveAccount(ctx, tx, p); e != nil {
		return t, e
	}
	fp := fingerprint(in)
	var oldID, oldFingerprint string
	e = tx.QueryRow(ctx, `SELECT id,fingerprint FROM research_tasks WHERE account_id=$1 AND operation_key=$2`, p.ID, key).Scan(&oldID, &oldFingerprint)
	if e == nil {
		if oldFingerprint != fp {
			return t, ErrIdempotency
		}
		if e = tx.Commit(ctx); e != nil {
			return t, e
		}
		return s.Task(ctx, p.ID, oldID)
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return t, e
	}
	if e = cloudAdmission(ctx, tx); e != nil {
		return t, e
	}
	var allowed bool
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM cloud_access WHERE account_id=$1 AND expires_at>clock_timestamp() AND request_count<request_limit)`, p.ID).Scan(&allowed)
	if e != nil {
		return t, e
	}
	if in.Mode == "paid-credits" {
		allowed, e = paidAdmission(ctx, tx, p.ID, s.Config.PaidAccount)
		if e != nil {
			return t, e
		}
	}
	if !allowed {
		return t, ErrForbidden
	}
	if sales != nil {
		price, e := metering.PriceTx(ctx, tx, *sales)
		if e != nil {
			return t, e
		}
		if price.Precision() != precision {
			return t, metering.ErrPrice
		}
	}
	consent, _ := json.Marshal(in.Consent)
	_, e = tx.Exec(ctx, `INSERT INTO research_tasks(id,account_id,client_task_id,model_id,operation_key,fingerprint,max_requests,max_output_tokens,max_duration_seconds,consent,state,created_at,deadline,sales_price_version_id,purchase_price_version_id,max_credits,credit_precision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'created',$11,$12,$13,$14,$15,$16)`, t.ID, p.ID, in.ClientID, in.Model, key, fp, in.Budget.MaxRequests, in.Budget.MaxOutput, in.Budget.MaxDuration, consent, t.Created, t.Deadline, sales, purchase, maxCredits, precision)
	if e != nil {
		var pgErr interface{ SQLState() string }
		if errors.As(e, &pgErr) && pgErr.SQLState() == "23505" {
			return t, ErrConflict
		}
		return t, e
	}
	return t, tx.Commit(ctx)
}
func (s *Store) expire(ctx context.Context) error {
	_, e := s.Pool.Exec(ctx, `UPDATE gateway_requests SET execution='unknown',settlement='reconciliation_pending',error_code='STREAM_INTERRUPTED',finished_at=clock_timestamp() WHERE execution IN ('running','cancel_requested') AND deadline<=clock_timestamp()`)
	return e
}
func (s *Store) Task(ctx context.Context, owner, id string) (Task, error) {
	if _, e := s.Pool.Exec(ctx, `UPDATE research_tasks SET state='interrupted' WHERE id=$1 AND account_id=$2 AND state IN ('created','running') AND deadline<=clock_timestamp()`, id, owner); e != nil {
		return Task{}, e
	}

	var t Task
	var consent []byte
	var maxCredits *int64
	var precision int64
	e := s.Pool.QueryRow(ctx, `SELECT id,client_task_id,model_id,max_requests,max_output_tokens,max_duration_seconds,consent,state,created_at,deadline,request_count,max_credits,credit_precision FROM research_tasks WHERE id=$1 AND account_id=$2`, id, owner).Scan(&t.ID, &t.ClientID, &t.Model, &t.Budget.MaxRequests, &t.Budget.MaxOutput, &t.Budget.MaxDuration, &consent, &t.State, &t.Created, &t.Deadline, &t.Requests, &maxCredits, &precision)
	if errors.Is(e, pgx.ErrNoRows) {
		return t, ErrNotFound
	}
	if e != nil {
		return t, e
	}
	json.Unmarshal(consent, &t.Consent)
	t.Created = t.Created.UTC()
	t.Deadline = t.Deadline.UTC()
	t.Mode = "alpha-test"
	if maxCredits != nil {
		t.Mode = "test-credits"
		if precision == metering.PaidPrecision {
			t.Mode = "paid-credits"
		}
		t.Budget.MaxCredits = metering.Display(*maxCredits, precision)
	}
	t.Quality = "not_evaluated"
	if (t.State == "created" || t.State == "running") && !t.Deadline.After(time.Now()) {
		t.State = "interrupted"
	}
	return t, nil
}
func (s *Store) Claim(ctx context.Context, p identity.Principal, taskID, id, key string, payload map[string]any, phases ...string) (Request, time.Time, error) {
	if !s.betaCurrent() {
		return Request{}, time.Time{}, ErrUnavailable
	}
	phase := "conversation"
	if len(phases) > 0 && phases[0] != "" {
		phase = phases[0]
	}
	if phase != "conversation" && phase != "extraction" && phase != "repair" && phase != "metadata" {
		return Request{}, time.Time{}, ErrValidation
	}
	r := Request{ID: id, TaskID: taskID, Model: ModelAlias, Mode: "alpha-test", Execution: "running", Settlement: "reconciliation_pending", Quality: "not_evaluated", Reserved: "0", Route: RouteVersion}
	if !s.Config.Enabled {
		return r, time.Time{}, ErrUnavailable
	}
	if !identifier.MatchString(id) || !identifier.MatchString(key) {
		return r, time.Time{}, ErrValidation
	}
	var counted *int64
	countEvidence := ""
	if s.Config.PaidAccount == "*" {
		if s.Config.Counter == nil {
			return r, time.Time{}, ErrUnavailable
		}
		n, ev, err := s.Config.Counter.Count(ctx, payload)
		if err != nil {
			return r, time.Time{}, err
		}
		if n < 1 || n > 131072 {
			return r, time.Time{}, ErrBudget
		}
		counted = &n
		countEvidence = ev
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return r, time.Time{}, e
	}
	defer tx.Rollback(ctx)
	// All claims share a short admission lock; provider I/O never runs in this transaction.
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(51202001)`); e != nil {
		return r, time.Time{}, e
	}
	if e = liveAccount(ctx, tx, p); e != nil {
		return r, time.Time{}, e
	}
	var prior, priorID string
	e = tx.QueryRow(ctx, `SELECT fingerprint,id FROM gateway_requests WHERE account_id=$1 AND operation_key=$2`, p.ID, key).Scan(&prior, &priorID)
	if e == nil {
		if prior != fingerprint([]any{taskID, payload, phase}) || priorID != id {
			return r, time.Time{}, ErrIdempotency
		}
		return r, time.Time{}, ErrConflict
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return r, time.Time{}, e
	}
	if e = cloudAdmission(ctx, tx); e != nil {
		return r, time.Time{}, e
	}
	var limit, count, output int
	var deadline time.Time
	var state string
	var sales, purchase *string
	var maxCredits *int64
	var precision int64
	e = tx.QueryRow(ctx, `SELECT max_requests,request_count,max_output_tokens,deadline,state,sales_price_version_id,purchase_price_version_id,max_credits,credit_precision FROM research_tasks WHERE id=$1 AND account_id=$2 FOR UPDATE`, taskID, p.ID).Scan(&limit, &count, &output, &deadline, &state, &sales, &purchase, &maxCredits, &precision)
	if errors.Is(e, pgx.ErrNoRows) {
		return r, deadline, ErrNotFound
	}
	if e != nil {
		return r, deadline, e
	}
	requested, ok := payload["max_output_tokens"].(float64)
	if !ok || requested < 1 {
		return r, deadline, ErrValidation
	}
	if !deadline.After(time.Now()) || count >= limit || requested > float64(output) {
		return r, deadline, ErrBudget
	}
	if state != "created" && state != "running" {
		return r, deadline, ErrConflict
	}
	var uncertain bool
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gateway_requests WHERE task_id=$1 AND (execution NOT IN ('completed') OR settlement='reconciliation_pending'))`, taskID).Scan(&uncertain)
	if e != nil {
		return r, deadline, e
	}
	if uncertain {
		return r, deadline, ErrConflict
	}
	var active int
	e = tx.QueryRow(ctx, `SELECT count(*) FROM gateway_requests WHERE execution IN ('running','cancel_requested') AND deadline>clock_timestamp()`).Scan(&active)
	if e != nil {
		return r, deadline, e
	}
	if active >= s.Config.MaxConcurrent {
		return r, deadline, ErrRate
	}
	var ownActive bool
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gateway_requests WHERE account_id=$1 AND execution IN ('running','cancel_requested') AND deadline>clock_timestamp())`, p.ID).Scan(&ownActive)
	if e != nil {
		return r, deadline, e
	}
	if ownActive {
		return r, deadline, ErrConflict
	}
	if _, e = tx.Exec(ctx, `UPDATE gateway_requests SET execution='unknown',settlement='reconciliation_pending',error_code='STREAM_INTERRUPTED',finished_at=clock_timestamp() WHERE execution IN ('running','cancel_requested') AND deadline<=clock_timestamp()`); e != nil {
		return r, deadline, e
	}
	if precision == metering.PaidPrecision {
		allowed, e := paidAdmission(ctx, tx, p.ID, s.Config.PaidAccount)
		if e != nil {
			return r, deadline, e
		}
		if !allowed {
			return r, deadline, ErrForbidden
		}
	} else {
		tag, e := tx.Exec(ctx, `UPDATE cloud_access SET request_count=request_count+1 WHERE account_id=$1 AND expires_at>clock_timestamp() AND request_count<request_limit`, p.ID)
		if e != nil {
			return r, deadline, e
		}
		if tag.RowsAffected() != 1 {
			return r, deadline, ErrForbidden
		}
	}
	_, e = tx.Exec(ctx, `INSERT INTO gateway_requests(id,task_id,account_id,session_id,operation_key,fingerprint,route_version,execution,settlement,deadline,phase) VALUES($1,$2,$3,$4,$5,$6,$7,'running','reconciliation_pending',$8,$9)`, id, taskID, p.ID, p.SessionID, key, fingerprint([]any{taskID, payload, phase}), RouteVersion, deadline, phase)
	if e != nil {
		var pgErr interface{ SQLState() string }
		if errors.As(e, &pgErr) && pgErr.SQLState() == "23505" {
			return r, deadline, ErrConflict
		}
		return r, deadline, e
	}
	if counted != nil {
		if _, e = tx.Exec(ctx, `UPDATE gateway_requests SET counted_input_tokens=$2,input_count_evidence=$3 WHERE id=$1`, id, *counted, countEvidence); e != nil {
			return r, deadline, e
		}
	}
	if sales != nil && maxCredits != nil {
		pv := ""
		if purchase != nil {
			pv = *purchase
		}
		reservation, e := metering.ReserveTx(ctx, tx, p.ID, taskID, id, *sales, pv, *maxCredits, payload, int(requested), deadline)
		if e != nil {
			return r, deadline, e
		}
		r.Mode = "test-credits"
		if reservation.Precision == metering.PaidPrecision {
			r.Mode = "paid-credits"
		}
		r.Reserved = reservation.Reserved
		r.Settlement = "reserved"
		r.Price = sales
		if _, e = tx.Exec(ctx, `UPDATE gateway_requests SET settlement='reserved' WHERE id=$1`, id); e != nil {
			return r, deadline, e
		}
	}
	_, e = tx.Exec(ctx, `UPDATE research_tasks SET request_count=request_count+1,state='running' WHERE id=$1`, taskID)
	if e != nil {
		return r, deadline, e
	}
	return r, deadline, tx.Commit(ctx)
}
func (s *Store) Request(ctx context.Context, owner, id string) (Request, error) {
	var r Request
	var usage []byte
	if e := s.expire(ctx); e != nil {
		return r, e
	}
	e := s.Pool.QueryRow(ctx, `SELECT id,task_id,execution,settlement,usage,route_version,terminal_received,error_code,dispatched,phase FROM gateway_requests WHERE account_id=$1 AND id=$2`, owner, id).Scan(&r.ID, &r.TaskID, &r.Execution, &r.Settlement, &usage, &r.Route, &r.Terminal, &r.Error, &r.Dispatched, &r.Phase)
	if errors.Is(e, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	if e != nil {
		return r, e
	}
	if len(usage) > 0 {
		var u rootflow.Usage
		if json.Unmarshal(usage, &u) != nil {
			return r, errors.New("invalid_stored_usage")
		}
		r.Usage = &u
	}
	r.Model = ModelAlias
	r.Mode = "alpha-test"
	r.Quality = "not_evaluated"
	r.Reserved = "0"
	reservation, e := (&metering.Store{Pool: s.Pool}).Reservation(ctx, owner, id)
	if e == nil {
		r.Mode = "test-credits"
		if reservation.Precision == metering.PaidPrecision {
			r.Mode = "paid-credits"
		}
		r.Reserved = reservation.Reserved
		r.Charged = reservation.Charged
		r.Price = &reservation.Price
		r.Settlement = reservation.Status
	} else if !errors.Is(e, metering.ErrNotFound) {
		return r, e
	}
	return r, nil
}
func (s *Store) Cancel(ctx context.Context, owner, id string) (Request, error) {
	_, e := s.Pool.Exec(ctx, `UPDATE gateway_requests SET execution='cancel_requested' WHERE id=$1 AND account_id=$2 AND execution='running'`, id, owner)
	if e != nil {
		return Request{}, e
	}
	return s.Request(ctx, owner, id)
}
func (s *Store) RunningAllowed(ctx context.Context, p identity.Principal, id string) (bool, error) {
	var allowed bool
	e := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gateway_requests r JOIN accounts a ON a.id=r.account_id JOIN sessions s ON s.id=r.session_id JOIN devices d ON d.id=s.device_id JOIN research_tasks t ON t.id=r.task_id LEFT JOIN cloud_access c ON c.account_id=r.account_id WHERE r.id=$1 AND r.account_id=$2 AND r.execution='running' AND r.deadline>clock_timestamp() AND a.status='active' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND d.revoked_at IS NULL AND ((t.credit_precision=1 AND c.expires_at>clock_timestamp()) OR (t.credit_precision=10000 AND (r.account_id=$3 OR ($3='*' AND EXISTS(SELECT 1 FROM beta_enrollments b WHERE b.account_id=r.account_id AND b.state='active'))) AND EXISTS(SELECT 1 FROM subscription_periods sp WHERE sp.account_id=r.account_id AND sp.state='active' AND sp.starts_at<=clock_timestamp() AND sp.ends_at>clock_timestamp()))))`, id, p.ID, s.Config.PaidAccount).Scan(&allowed)
	return allowed, e
}
func (s *Store) Dispatched(ctx context.Context, id string) error {
	tag, e := s.Pool.Exec(ctx, `UPDATE gateway_requests SET dispatched=true WHERE id=$1 AND execution='running'`, id)
	if e == nil && tag.RowsAffected() != 1 {
		return ErrConflict
	}
	return e
}
func (s *Store) Finish(ctx context.Context, id, state, code string, upstream int, terminal bool, usage *rootflow.Usage) error {
	var body any
	if usage != nil {
		b, _ := json.Marshal(usage)
		body = b
	}
	settlement := "reconciliation_pending"
	if terminal && usage != nil && usage.Input != nil && usage.Output != nil {
		settlement = "not_billed"
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var owner string
	if e = tx.QueryRow(ctx, `SELECT account_id FROM gateway_requests WHERE id=$1`, id).Scan(&owner); e != nil {
		return e
	}
	var active bool
	if e = tx.QueryRow(ctx, `SELECT status='active' FROM accounts WHERE id=$1 FOR UPDATE`, owner).Scan(&active); e != nil {
		return e
	}
	var current string
	if e = tx.QueryRow(ctx, `SELECT execution FROM gateway_requests WHERE id=$1 FOR UPDATE`, id).Scan(&current); e != nil {
		return e
	}
	if current != "running" && current != "cancel_requested" && current != "unknown" {
		return tx.Commit(ctx)
	}
	_, e = tx.Exec(ctx, `UPDATE gateway_requests SET execution=$2,settlement=$3,error_code=NULLIF($4,''),upstream_status=NULLIF($5,0),terminal_received=$6,usage=$7,finished_at=clock_timestamp() WHERE id=$1`, id, state, settlement, code, upstream, terminal, body)
	if e != nil {
		return e
	}
	var dispatched bool
	if e = tx.QueryRow(ctx, `SELECT dispatched FROM gateway_requests WHERE id=$1`, id).Scan(&dispatched); e != nil {
		return e
	}
	reliable := usage
	if !terminal {
		reliable = nil
	}
	if e = metering.SettleTx(ctx, tx, id, reliable, !dispatched, "provider_terminal_usage"); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Store) EndTask(ctx context.Context, owner, id, state string) (Task, error) {
	if e := s.expire(ctx); e != nil {
		return Task{}, e
	}
	if state != "completed" && state != "cancelled" && state != "failed" && state != "interrupted" {
		return Task{}, ErrValidation
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Task{}, e
	}
	defer tx.Rollback(ctx)
	var current string
	e = tx.QueryRow(ctx, `SELECT state FROM research_tasks WHERE id=$1 AND account_id=$2 FOR UPDATE`, id, owner).Scan(&current)
	if errors.Is(e, pgx.ErrNoRows) {
		return Task{}, ErrNotFound
	}
	if e != nil {
		return Task{}, e
	}
	if current != "created" && current != "running" {
		if current != state {
			return Task{}, ErrConflict
		}
		if e = tx.Commit(ctx); e != nil {
			return Task{}, e
		}
		return s.Task(ctx, owner, id)
	}
	var active bool
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gateway_requests WHERE task_id=$1 AND execution IN ('running','cancel_requested'))`, id).Scan(&active)
	if e != nil {
		return Task{}, e
	}
	if active {
		return Task{}, ErrConflict
	}
	if state == "completed" {
		var valid bool
		e = tx.QueryRow(ctx, `SELECT count(*)>0 AND bool_and(execution='completed' AND terminal_received) FROM gateway_requests WHERE task_id=$1`, id).Scan(&valid)
		if e != nil {
			return Task{}, e
		}
		if !valid {
			return Task{}, ErrConflict
		}
	}
	_, e = tx.Exec(ctx, `UPDATE research_tasks SET state=$2 WHERE id=$1`, id, state)
	if e != nil {
		return Task{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return Task{}, e
	}
	return s.Task(ctx, owner, id)
}

// Cancel the task even between rounds; later requests cannot be admitted.
func (s *Store) CancelTask(ctx context.Context, owner, id string) (Task, error) {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Task{}, e
	}
	defer tx.Rollback(ctx)
	tag, e := tx.Exec(ctx, `UPDATE research_tasks SET state='cancelled' WHERE id=$1 AND account_id=$2 AND state IN ('created','running')`, id, owner)
	if e != nil {
		return Task{}, e
	}
	_ = tag
	_, e = tx.Exec(ctx, `UPDATE gateway_requests SET execution='cancel_requested' WHERE task_id=$1 AND account_id=$2 AND execution='running'`, id, owner)
	if e != nil {
		return Task{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return Task{}, e
	}
	return s.Task(ctx, owner, id)
}

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

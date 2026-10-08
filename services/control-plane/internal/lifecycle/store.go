package lifecycle

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jamip/materialsx/control-plane/internal/delivery"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"regexp"
	"strings"
	"time"
)

var validID = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)
var sha = regexp.MustCompile(`^[a-f0-9]{64}$`)
var credential = regexp.MustCompile(`(?i)(sk-[a-z0-9_-]{12,}|-----BEGIN .*PRIVATE KEY-----|(?:api[_-]?key|authorization|password|secret)\s*[:=]\s*\S+)`)

type Store struct {
	Pool *pgxpool.Pool
	Key  []byte
}
type Ticket struct {
	ID          string       `json:"id"`
	AccountID   string       `json:"accountId"`
	Subject     string       `json:"subject"`
	Category    string       `json:"category"`
	ReferenceID string       `json:"referenceId"`
	State       string       `json:"state"`
	Version     int64        `json:"version,string"`
	Created     time.Time    `json:"createdAt"`
	Events      []Event      `json:"events"`
	Attachments []Attachment `json:"attachments"`
}
type Event struct {
	ID      string    `json:"id"`
	ActorID string    `json:"actorId"`
	Body    string    `json:"body"`
	State   string    `json:"state"`
	Created time.Time `json:"createdAt"`
}
type Attachment struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	SHA     string `json:"sha256"`
	Consent string `json:"consentVersion"`
}
type NewTicket struct {
	Subject     string `json:"subject"`
	Category    string `json:"category"`
	Body        string `json:"body"`
	ReferenceID string `json:"referenceId"`
}

func fingerprint(v any) string { b, _ := json.Marshal(v); return delivery.ID(string(b)) }
func clean(body string, max int) bool {
	return len(strings.TrimSpace(body)) > 0 && len(body) <= max && !strings.ContainsRune(body, 0) && !credential.MatchString(body)
}
func (s Store) Create(ctx context.Context, owner, key string, in NewTicket) (Ticket, error) {
	if !validID.MatchString(key) || !clean(in.Subject, 160) || !clean(in.Body, 8000) || !strings.Contains("|account|payment|usage|research|other|", "|"+in.Category+"|") || (in.ReferenceID != "" && !validID.MatchString(in.ReferenceID)) {
		return Ticket{}, identity.ErrValidation
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Ticket{}, e
	}
	defer tx.Rollback(ctx)
	// Serializes duplicate keys and reference ownership checks with account suspension.
	var status string
	if e = tx.QueryRow(ctx, `SELECT status FROM accounts WHERE id=$1 FOR UPDATE`, owner).Scan(&status); e != nil {
		return Ticket{}, e
	}
	if status != "active" {
		return Ticket{}, identity.ErrForbidden
	}
	id := delivery.ID(owner + ":" + key)
	fp := fingerprint(in)
	var prior string
	e = tx.QueryRow(ctx, `SELECT fingerprint FROM support_tickets WHERE id=$1`, id).Scan(&prior)
	if e == nil {
		if prior != fp {
			return Ticket{}, identity.ErrConflict
		}
		if e = tx.Commit(ctx); e != nil {
			return Ticket{}, e
		}
		return s.Get(ctx, owner, id, false)
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return Ticket{}, e
	}
	if in.ReferenceID != "" {
		var owned bool
		e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM payment_orders WHERE id=$1 AND account_id=$2 UNION ALL SELECT 1 FROM gateway_requests WHERE id=$1 AND account_id=$2)`, in.ReferenceID, owner).Scan(&owned)
		if e != nil {
			return Ticket{}, e
		}
		if !owned {
			return Ticket{}, identity.ErrNotFound
		}
	}
	if _, e = tx.Exec(ctx, `INSERT INTO support_tickets(id,account_id,idempotency_key,fingerprint,subject,category,reference_id) VALUES($1,$2,$3,$4,$5,$6,$7)`, id, owner, key, fp, in.Subject, in.Category, in.ReferenceID); e != nil {
		return Ticket{}, e
	}
	if _, e = tx.Exec(ctx, `INSERT INTO support_events(ticket_id,actor_id,operation_key,fingerprint,body,state) VALUES($1,$2,$3,$4,$5,'open')`, id, owner, key, fp, in.Body); e != nil {
		return Ticket{}, e
	}
	if e = audit(ctx, tx, owner, "support.create", id); e != nil {
		return Ticket{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return Ticket{}, e
	}
	return s.Get(ctx, owner, id, false)
}
func audit(ctx context.Context, tx pgx.Tx, actor, action, target string) error {
	_, e := tx.Exec(ctx, `INSERT INTO audit_events(actor_id,action,target_id,result,reason) VALUES($1,$2,$3,'succeeded','lifecycle operation')`, actor, action, target)
	return e
}
func (s Store) List(ctx context.Context, owner string, admin bool, cursor string) ([]Ticket, string, error) {
	if cursor != "" && !validID.MatchString(cursor) {
		return nil, "", identity.ErrValidation
	}
	rows, e := s.Pool.Query(ctx, `SELECT id FROM support_tickets WHERE ($2 OR account_id=$1) AND ($3='' OR id<$3) ORDER BY id DESC LIMIT 51`, owner, admin, cursor)
	if e != nil {
		return nil, "", e
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			return nil, "", e
		}
		ids = append(ids, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, "", e
	}
	next := ""
	if len(ids) > 50 {
		ids = ids[:50]
		next = ids[49]
	}
	out := []Ticket{}
	for _, id := range ids {
		v, e := s.Get(ctx, owner, id, admin)
		if e != nil {
			return nil, "", e
		}
		out = append(out, v)
	}
	return out, next, nil
}
func (s Store) Get(ctx context.Context, owner, id string, admin bool) (Ticket, error) {
	v := Ticket{Events: []Event{}, Attachments: []Attachment{}}
	e := s.Pool.QueryRow(ctx, `SELECT id,account_id,subject,category,reference_id,state,version,created_at FROM support_tickets WHERE id=$1 AND ($3 OR account_id=$2)`, id, owner, admin).Scan(&v.ID, &v.AccountID, &v.Subject, &v.Category, &v.ReferenceID, &v.State, &v.Version, &v.Created)
	if errors.Is(e, pgx.ErrNoRows) {
		return v, identity.ErrNotFound
	}
	if e != nil {
		return v, e
	}
	v.Created = v.Created.UTC()
	rows, e := s.Pool.Query(ctx, `SELECT id::text,actor_id,body,state,created_at FROM support_events WHERE ticket_id=$1 ORDER BY id LIMIT 200`, id)
	if e != nil {
		return v, e
	}
	for rows.Next() {
		var ev Event
		if e = rows.Scan(&ev.ID, &ev.ActorID, &ev.Body, &ev.State, &ev.Created); e != nil {
			rows.Close()
			return v, e
		}
		ev.Created = ev.Created.UTC()
		v.Events = append(v.Events, ev)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return v, e
	}
	rows, e = s.Pool.Query(ctx, `SELECT id,name,sha256,consent_version FROM support_attachments WHERE ticket_id=$1 ORDER BY created_at LIMIT 10`, id)
	if e != nil {
		return v, e
	}
	defer rows.Close()
	for rows.Next() {
		var a Attachment
		if e = rows.Scan(&a.ID, &a.Name, &a.SHA, &a.Consent); e != nil {
			return v, e
		}
		v.Attachments = append(v.Attachments, a)
	}
	return v, rows.Err()
}

type Reply struct {
	Body            string `json:"body"`
	State           string `json:"state"`
	ExpectedVersion int64  `json:"expectedVersion,string"`
}

func (s Store) Reply(ctx context.Context, actor, id, key string, admin bool, in Reply) (Ticket, error) {
	if !validID.MatchString(key) || !clean(in.Body, 8000) || in.ExpectedVersion < 1 || !strings.Contains("|open|waiting_user|resolved|closed|", "|"+in.State+"|") || (!admin && in.State != "open" && in.State != "closed") {
		return Ticket{}, identity.ErrValidation
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Ticket{}, e
	}
	defer tx.Rollback(ctx)
	var owner, state string
	var version int64
	if e = tx.QueryRow(ctx, `SELECT account_id,state,version FROM support_tickets WHERE id=$1 FOR UPDATE`, id).Scan(&owner, &state, &version); e != nil {
		return Ticket{}, identity.ErrNotFound
	}
	if !admin && owner != actor {
		return Ticket{}, identity.ErrNotFound
	}
	fp := fingerprint(in)
	var prior string
	e = tx.QueryRow(ctx, `SELECT fingerprint FROM support_events WHERE ticket_id=$1 AND operation_key=$2`, id, key).Scan(&prior)
	if e == nil {
		if fp != prior {
			return Ticket{}, identity.ErrConflict
		}
		if e = tx.Commit(ctx); e != nil {
			return Ticket{}, e
		}
		return s.Get(ctx, actor, id, admin)
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return Ticket{}, e
	}
	if version != in.ExpectedVersion || state == "closed" {
		return Ticket{}, identity.ErrConflict
	}
	var count int
	if e = tx.QueryRow(ctx, `SELECT count(*) FROM support_events WHERE ticket_id=$1`, id).Scan(&count); e != nil {
		return Ticket{}, e
	}
	if count >= 200 {
		return Ticket{}, identity.ErrRateLimited
	}
	if _, e = tx.Exec(ctx, `INSERT INTO support_events(ticket_id,actor_id,operation_key,fingerprint,body,state) VALUES($1,$2,$3,$4,$5,$6)`, id, actor, key, fp, in.Body, in.State); e != nil {
		return Ticket{}, e
	}
	if _, e = tx.Exec(ctx, `UPDATE support_tickets SET state=$2,version=version+1 WHERE id=$1`, id, in.State); e != nil {
		return Ticket{}, e
	}
	if admin {
		var email string
		if e = tx.QueryRow(ctx, `SELECT email FROM accounts WHERE id=$1`, owner).Scan(&email); e != nil {
			return Ticket{}, e
		}
		if e = (delivery.Store{Pool: s.Pool, Key: s.Key}).Enqueue(ctx, tx, "support:"+id+":"+key, delivery.Message{To: email, Subject: "MaterialsX 工单状态更新", Text: "工单 " + id + " 已更新为 " + in.State + "。请在 MaterialsX 云服务中心查看处理记录。"}); e != nil {
			return Ticket{}, e
		}
	}
	if e = audit(ctx, tx, actor, "support.reply", id); e != nil {
		return Ticket{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return Ticket{}, e
	}
	return s.Get(ctx, actor, id, admin)
}

type AttachInput struct {
	Name           string `json:"name"`
	Text           string `json:"text"`
	ConsentVersion string `json:"consentVersion"`
}

func (s Store) Attach(ctx context.Context, actor, id string, in AttachInput) (Attachment, error) {
	if in.ConsentVersion != "support-text-v1" || !clean(in.Text, 32768) || !clean(in.Name, 80) || strings.ContainsAny(in.Name, "/\\") {
		return Attachment{}, identity.ErrValidation
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Attachment{}, e
	}
	defer tx.Rollback(ctx)
	var owner, state string
	if e = tx.QueryRow(ctx, `SELECT account_id,state FROM support_tickets WHERE id=$1 FOR UPDATE`, id).Scan(&owner, &state); e != nil || owner != actor {
		return Attachment{}, identity.ErrNotFound
	}
	if state == "closed" {
		return Attachment{}, identity.ErrConflict
	}
	digest := delivery.ID(in.Text)
	a := Attachment{ID: delivery.ID(id + ":" + digest), Name: in.Name, SHA: digest, Consent: in.ConsentVersion}
	var existing Attachment
	e = tx.QueryRow(ctx, `SELECT id,name,sha256,consent_version FROM support_attachments WHERE id=$1`, a.ID).Scan(&existing.ID, &existing.Name, &existing.SHA, &existing.Consent)
	if e == nil {
		return existing, nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return a, e
	}
	var n int
	if e = tx.QueryRow(ctx, `SELECT count(*) FROM support_attachments WHERE ticket_id=$1`, id).Scan(&n); e != nil {
		return a, e
	}
	if n >= 10 {
		return a, identity.ErrRateLimited
	}
	body, e := delivery.Seal(s.Key, a.ID, []byte(in.Text))
	if e != nil {
		return a, e
	}
	if _, e = tx.Exec(ctx, `INSERT INTO support_attachments(id,ticket_id,actor_id,name,payload,sha256,consent_version) VALUES($1,$2,$3,$4,$5,$6,$7)`, a.ID, id, actor, in.Name, body, digest, in.ConsentVersion); e != nil {
		return a, e
	}
	if e = audit(ctx, tx, actor, "support.attach_consent", a.ID); e != nil {
		return a, e
	}
	return a, tx.Commit(ctx)
}
func (s Store) Attachment(ctx context.Context, actor, id string, admin bool) (string, error) {
	var body []byte
	e := s.Pool.QueryRow(ctx, `SELECT a.payload FROM support_attachments a JOIN support_tickets t ON t.id=a.ticket_id WHERE a.id=$1 AND ($3 OR t.account_id=$2)`, id, actor, admin).Scan(&body)
	if e != nil {
		return "", identity.ErrNotFound
	}
	raw, e := delivery.Open(s.Key, id, body)
	return string(raw), e
}

type StatementLine struct {
	RequestID      string `json:"requestId"`
	RouteVersionID string `json:"routeVersionId"`
	SourceRef      string `json:"sourceRef"`
	SourceSHA      string `json:"sourceSha256"`
	CostMicrofen   string `json:"costMicrofen"`
	Reason         string `json:"reason"`
}

func (s Store) ImportStatement(ctx context.Context, actor string, lines []StatementLine) error {
	if len(lines) < 1 || len(lines) > 100 {
		return identity.ErrValidation
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	for _, in := range lines {
		n, e := metering.Amount(in.CostMicrofen)
		if e != nil || n < 0 || n > 100000000000000 || !validID.MatchString(in.RequestID) || !validID.MatchString(in.RouteVersionID) || !clean(in.SourceRef, 160) || !sha.MatchString(in.SourceSHA) || !clean(in.Reason, 256) {
			return identity.ErrValidation
		}
		var route string
		var dispatched bool
		e = tx.QueryRow(ctx, `SELECT route_version,dispatched FROM gateway_requests WHERE id=$1 FOR SHARE`, in.RequestID).Scan(&route, &dispatched)
		if e != nil {
			return identity.ErrNotFound
		}
		if route != in.RouteVersionID || !dispatched {
			return identity.ErrValidation
		}
		fp := fingerprint(in)
		var prior string
		e = tx.QueryRow(ctx, `INSERT INTO procurement_statement_lines(request_id,route_version_id,source_ref,source_sha256,cost_microfen,fingerprint,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(request_id) DO NOTHING RETURNING fingerprint`, in.RequestID, in.RouteVersionID, in.SourceRef, in.SourceSHA, n, fp, actor, in.Reason).Scan(&prior)
		if errors.Is(e, pgx.ErrNoRows) {
			e = tx.QueryRow(ctx, `SELECT fingerprint FROM procurement_statement_lines WHERE request_id=$1`, in.RequestID).Scan(&prior)
		}
		if e != nil {
			return e
		}
		if prior != fp {
			return identity.ErrConflict
		}
		if e = audit(ctx, tx, actor, "procurement.statement_import", in.RequestID); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}

type Costs struct {
	ActualMicrofen    string          `json:"actualMicrofen"`
	StatementRequests int             `json:"statementRequests"`
	UnknownRequests   int             `json:"unknownRequests"`
	Items             []StatementLine `json:"items"`
}

func (s Store) Costs(ctx context.Context) (Costs, error) {
	v := Costs{Items: []StatementLine{}}
	e := s.Pool.QueryRow(ctx, `SELECT COALESCE(sum(l.cost_microfen),0)::text,count(l.request_id),count(*) FILTER(WHERE l.request_id IS NULL AND (c.state IS NULL OR c.state='unknown')) FROM gateway_requests r LEFT JOIN procurement_statement_lines l ON l.request_id=r.id LEFT JOIN procurement_costs c ON c.request_id=r.id`).Scan(&v.ActualMicrofen, &v.StatementRequests, &v.UnknownRequests)
	if e != nil {
		return v, e
	}
	rows, e := s.Pool.Query(ctx, `SELECT request_id,route_version_id,source_ref,source_sha256,cost_microfen::text,reason FROM procurement_statement_lines ORDER BY created_at DESC LIMIT 100`)
	if e != nil {
		return v, e
	}
	defer rows.Close()
	for rows.Next() {
		var l StatementLine
		if e = rows.Scan(&l.RequestID, &l.RouteVersionID, &l.SourceRef, &l.SourceSHA, &l.CostMicrofen, &l.Reason); e != nil {
			return v, e
		}
		v.Items = append(v.Items, l)
	}
	return v, rows.Err()
}

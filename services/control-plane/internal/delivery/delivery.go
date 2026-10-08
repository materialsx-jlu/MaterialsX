// Package delivery owns encrypted, durable notifications. An uncertain SMTP
// outcome is placed in manual review, never automatically sent a second time.
package delivery

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	Pool *pgxpool.Pool
	Key  []byte
}
type Message struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Text    string `json:"text"`
}

func ID(s string) string { v := sha256.Sum256([]byte(s)); return hex.EncodeToString(v[:]) }
func Seal(key []byte, id string, data []byte) ([]byte, error) {
	b, e := aes.NewCipher(key)
	if e != nil {
		return nil, e
	}
	g, e := cipher.NewGCM(b)
	if e != nil {
		return nil, e
	}
	n := make([]byte, g.NonceSize())
	if _, e = rand.Read(n); e != nil {
		return nil, e
	}
	return g.Seal(n, n, data, []byte("mx-lifecycle-v1:"+id)), nil
}
func Open(key []byte, id string, data []byte) ([]byte, error) {
	b, e := aes.NewCipher(key)
	if e != nil {
		return nil, e
	}
	g, e := cipher.NewGCM(b)
	if e != nil || len(data) < g.NonceSize() {
		return nil, errors.New("invalid_cipher")
	}
	return g.Open(nil, data[:g.NonceSize()], data[g.NonceSize():], []byte("mx-lifecycle-v1:"+id))
}
func (s Store) Enqueue(ctx context.Context, tx pgx.Tx, event string, m Message) error {
	addr, e := mail.ParseAddress(m.To)
	if e != nil || addr.Address != m.To || strings.ContainsAny(m.Subject, "\r\n") || len(m.Text) > 16000 {
		return errors.New("invalid_notification")
	}
	id := ID(event)
	raw, _ := json.Marshal(m)
	body, e := Seal(s.Key, id, raw)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO notification_outbox(id,event_key,payload) VALUES($1,$2,$3) ON CONFLICT(event_key) DO NOTHING`, id, event, body)
	return e
}

type Sender interface {
	Send(context.Context, string, Message) error
}
type FileSender struct{ Directory string }

func (s FileSender) Send(ctx context.Context, id string, m Message) error {
	if id == "" || strings.ContainsAny(id, "/\\") || id == "." || id == ".." {
		return errors.New("invalid_delivery_id")
	}
	if !filepath.IsAbs(s.Directory) {
		return errors.New("absolute_private_directory_required")
	}
	if e := os.MkdirAll(s.Directory, 0700); e != nil {
		return e
	}
	info, e := os.Lstat(s.Directory)
	if e != nil || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0077 != 0 {
		return errors.New("private_directory_required")
	}
	raw, _ := json.Marshal(m)
	file := filepath.Join(s.Directory, id+".json")
	f, e := os.OpenFile(file, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if os.IsExist(e) {
		stat, err := os.Lstat(file)
		if err != nil || !stat.Mode().IsRegular() || stat.Mode().Perm()&0077 != 0 {
			return errors.New("private_file_required")
		}
		prior, e := os.ReadFile(file)
		if e == nil && string(prior) == string(raw) {
			return nil
		}
		return errors.New("delivery_conflict")
	}
	if e != nil {
		return e
	}
	defer f.Close()
	_, e = f.Write(raw)
	if e == nil {
		e = f.Sync()
	}
	return e
}

type SMTPSender struct{ Address, Username, Password, From string }

func (s SMTPSender) Send(ctx context.Context, id string, m Message) error {
	host, _, e := net.SplitHostPort(s.Address)
	if e != nil {
		return e
	}
	from, e := mail.ParseAddress(s.From)
	if e != nil || from.Address != s.From {
		return errors.New("invalid_sender")
	}
	conn, e := (&net.Dialer{Timeout: 8 * time.Second}).DialContext(ctx, "tcp", s.Address)
	if e != nil {
		return e
	}
	defer conn.Close()
	deadline := time.Now().Add(12 * time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	conn.SetDeadline(deadline)
	c, e := smtp.NewClient(conn, host)
	if e != nil {
		return e
	}
	defer c.Close()
	if ok, _ := c.Extension("STARTTLS"); !ok {
		return errors.New("smtp_requires_tls")
	}
	if e = c.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}); e != nil {
		return e
	}
	if s.Username != "" {
		if e = c.Auth(smtp.PlainAuth("", s.Username, s.Password, host)); e != nil {
			return e
		}
	}
	if e = c.Mail(s.From); e != nil {
		return e
	}
	if e = c.Rcpt(m.To); e != nil {
		return e
	}
	w, e := c.Data()
	if e != nil {
		return e
	}
	// Subject is RFC 2047 encoded, bodies are UTF-8; no caller-controlled headers.
	subject := mime.QEncoding.Encode("utf-8", m.Subject)
	_, e = fmt.Fprintf(w, "From: %s\r\nTo: %s\r\nSubject: %s\r\nMessage-ID: <%s@%s>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n%s\r\n", s.From, m.To, subject, id, host, strings.ReplaceAll(strings.ReplaceAll(m.Text, "\r\n", "\n"), "\n", "\r\n"))
	if e != nil {
		return e
	}
	if e = w.Close(); e != nil {
		return e
	}
	_ = c.Quit()
	return nil
}
func FromEnv(production bool) (Sender, error) {
	mode := os.Getenv("MATERIALSX_MAIL_MODE")
	switch mode {
	case "", "disabled":
		return nil, nil
	case "file":
		if production {
			return nil, errors.New("file_mail_not_production")
		}
		return FileSender{os.Getenv("MATERIALSX_MAIL_DIRECTORY")}, nil
	case "smtp":
		s := SMTPSender{os.Getenv("MATERIALSX_SMTP_ADDRESS"), os.Getenv("MATERIALSX_SMTP_USER"), os.Getenv("MATERIALSX_SMTP_PASSWORD"), os.Getenv("MATERIALSX_MAIL_FROM")}
		if _, _, e := net.SplitHostPort(s.Address); e != nil {
			return nil, e
		}
		if _, e := mail.ParseAddress(s.From); e != nil {
			return nil, e
		}
		return s, nil
	default:
		return nil, errors.New("invalid_mail_mode")
	}
}
func (s Store) Tick(ctx context.Context, sender Sender) (int, error) {
	if _, e := s.Pool.Exec(ctx, `UPDATE notification_outbox n SET state='expired',completed_at=clock_timestamp() WHERE n.state='pending' AND n.event_key LIKE 'email:%' AND NOT EXISTS(SELECT 1 FROM email_challenges c WHERE 'email:'||c.token_hash=n.event_key AND c.expires_at>clock_timestamp() AND c.consumed_at IS NULL)`); e != nil {
		return 0, e
	}
	// Stale claimed SMTP jobs are ambiguous after a crash. No silent redelivery.
	if _, e := s.Pool.Exec(ctx, `UPDATE notification_outbox SET state='manual' WHERE state='sending' AND available_at<clock_timestamp()-interval '2 minutes'`); e != nil {
		return 0, e
	}
	if sender == nil {
		return 0, nil
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return 0, e
	}
	defer tx.Rollback(ctx)
	var id string
	var payload []byte
	e = tx.QueryRow(ctx, `SELECT id,payload FROM notification_outbox WHERE state='pending' AND available_at<=clock_timestamp() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`).Scan(&id, &payload)
	if errors.Is(e, pgx.ErrNoRows) {
		return 0, nil
	}
	if e != nil {
		return 0, e
	}
	if _, e = tx.Exec(ctx, `UPDATE notification_outbox SET state='sending',attempts=attempts+1,available_at=clock_timestamp() WHERE id=$1`, id); e != nil {
		return 0, e
	}
	if e = tx.Commit(ctx); e != nil {
		return 0, e
	}
	plain, e := Open(s.Key, id, payload)
	var m Message
	if e == nil {
		e = json.Unmarshal(plain, &m)
	}
	if e == nil {
		e = sender.Send(ctx, id, m)
	}
	state := "sent"
	if e != nil {
		state = "manual"
	}
	_, err := s.Pool.Exec(ctx, `UPDATE notification_outbox SET state=$2,completed_at=clock_timestamp() WHERE id=$1 AND state='sending'`, id, state)
	return 1, err
}

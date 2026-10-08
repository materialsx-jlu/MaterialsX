package migrations

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"
)

//go:embed *.sql
var files embed.FS

// Apply is an explicit deploy operation. Runtime does not migrate its database.
func Apply(ctx context.Context, pool *pgxpool.Pool) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(51201001)`); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `CREATE SCHEMA IF NOT EXISTS mx_identity; SET LOCAL search_path=mx_identity,pg_catalog;
 CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`); err != nil {
		return err
	}
	entries, err := files.ReadDir(".")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		body, err := files.ReadFile(entry.Name())
		if err != nil {
			return err
		}
		digest := sha256.Sum256(body)
		sum := hex.EncodeToString(digest[:])
		var prior string
		err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=$1`, entry.Name()).Scan(&prior)
		if err == nil {
			if prior != sum {
				return errors.New("migration_checksum_mismatch")
			}
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if _, err = tx.Exec(ctx, string(body)); err != nil {
			return fmt.Errorf("migration_failed: %w", err)
		}
		if _, err = tx.Exec(ctx, `INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)`, entry.Name(), sum); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func Check(ctx context.Context, pool *pgxpool.Pool) error {
	entries, _ := files.ReadDir(".")
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		b, _ := files.ReadFile(e.Name())
		sum := sha256.Sum256(b)
		var got string
		if err := pool.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=$1`, e.Name()).Scan(&got); err != nil || got != hex.EncodeToString(sum[:]) {
			return errors.New("identity_migrations_not_current")
		}
	}
	return nil
}

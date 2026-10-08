package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jamip/materialsx/control-plane/internal/gateway"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/lifecycle"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"github.com/jamip/materialsx/control-plane/internal/mxpoints"
	"github.com/jamip/materialsx/control-plane/internal/mxpricing"
	"github.com/jamip/materialsx/control-plane/internal/payments"
	"github.com/jamip/materialsx/control-plane/migrations"
	"io"
	"os"
	"time"
)

func main() { os.Exit(run()) }
func run() int {
	command := flag.String("command", "check", "migrate, check, import-mx-price-snapshot, approve-mx-price-snapshot, reconcile-mx-supplier-bill, repair-mx-terminal, repair-mx-gpt-terminal, create-user, create-billing-staff, grant-billing-role, bootstrap-admin, reset-admin, grant-runtime, invalidate-sessions, prune, release-manifest-hash, publish-product, publish-sales-price, publish-purchase-price, grant-test-credits, verify-ledger, repair-output-overrun")
	runtimeRole := flag.String("role", "", "existing restricted PostgreSQL runtime role")
	flag.Parse()
	if *command == "release-manifest-hash" {
		var manifest gateway.ReleaseManifest
		d := json.NewDecoder(io.LimitReader(os.Stdin, 65537))
		d.DisallowUnknownFields()
		if d.Decode(&manifest) != nil || d.Decode(new(any)) != io.EOF {
			fmt.Fprintln(os.Stderr, "identityctl: invalid release manifest")
			return 2
		}
		hash, e := gateway.ReleaseManifestHash(manifest)
		if e != nil {
			fmt.Fprintln(os.Stderr, "identityctl: invalid release manifest")
			return 2
		}
		_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"manifestSha256": hash})
		return 0
	}
	cfg, e := identity.ConfigFromEnv()
	if e != nil {
		fmt.Fprintln(os.Stderr, "identityctl: invalid configuration")
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, e := identity.OpenPool(ctx, cfg)
	if e != nil {
		fmt.Fprintln(os.Stderr, "identityctl: database unavailable or insecure")
		return 2
	}
	defer pool.Close()
	if *command == "migrate" {
		e = migrations.Apply(ctx, pool)
	} else {
		if e = migrations.Check(ctx, pool); e != nil {
			fmt.Fprintln(os.Stderr, "identityctl: migrations not current")
			return 2
		}
		switch *command {
		case "check":
		case "repair-mx-gpt-terminal", "repair-mx-terminal":
			var in struct {
				RequestID string `json:"requestId"`
			}
			d := json.NewDecoder(io.LimitReader(os.Stdin, 4097))
			d.DisallowUnknownFields()
			if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF || os.Getenv("MATERIALSX_MX03_GATEWAY_MODE") != "wallet" {
				e = identity.ErrValidation
				break
			}
			wallet := &mxpoints.Store{Pool: pool, Mode: os.Getenv("MATERIALSX_MX03_PAYMENT_MODE")}
			var quote mxpricing.Quote
			quote, e = (&gateway.Store{Pool: pool, MXPoints: wallet}).RepairMXTerminal(ctx, in.RequestID)
			if e == nil {
				_ = json.NewEncoder(os.Stdout).Encode(quote)
			}
		case "reconcile-mx-supplier-bill":
			var in gateway.MXSupplierEvidence
			d := json.NewDecoder(io.LimitReader(os.Stdin, 4097))
			d.DisallowUnknownFields()
			if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF || os.Getenv("MATERIALSX_MX03_GATEWAY_MODE") != "wallet" {
				e = identity.ErrValidation
				break
			}
			wallet := &mxpoints.Store{Pool: pool, Mode: os.Getenv("MATERIALSX_MX03_PAYMENT_MODE")}
			var quote mxpricing.Quote
			quote, e = (&gateway.Store{Pool: pool, MXPoints: wallet}).ReconcileMXBill(ctx, in)
			if e == nil {
				_ = json.NewEncoder(os.Stdout).Encode(quote)
			}
		case "import-mx-price-snapshot":
			var raw []byte
			raw, e = io.ReadAll(io.LimitReader(os.Stdin, 65537))
			if e == nil && len(raw) <= 65536 {
				var bundle mxpricing.Bundle
				bundle, e = mxpricing.ImportSnapshot(ctx, pool, raw)
				if e == nil {
					fmt.Printf("identityctl: MX price snapshot imported as draft; purchase=%s fx=%s retail=%s\n", bundle.Purchase.ID, bundle.FX.ID, bundle.Retail.ID)
				}
			} else {
				e = mxpricing.ErrSnapshot
			}
		case "approve-mx-price-snapshot":
			var raw []byte
			raw, e = io.ReadAll(io.LimitReader(os.Stdin, 65537))
			if e == nil && len(raw) <= 65536 {
				var bundle mxpricing.Bundle
				bundle, e = mxpricing.ApproveSnapshot(ctx, pool, raw)
				if e == nil {
					fmt.Printf("identityctl: immutable MX price versions approved; purchase=%s fx=%s retail=%s\n", bundle.Purchase.ID, bundle.FX.ID, bundle.Retail.ID)
				}
			} else {
				e = mxpricing.ErrSnapshot
			}
		case "grant-runtime":
			e = identity.GrantRuntime(ctx, pool, *runtimeRole)
		case "invalidate-sessions":
			e = identity.InvalidateSessions(ctx, pool)
		case "create-user", "create-billing-staff", "bootstrap-admin", "reset-admin":
			var in struct {
				Email       string `json:"email"`
				DisplayName string `json:"displayName"`
				Password    string `json:"password"`
				TOTPSecret  string `json:"totpSecret"`
			}
			input, err := io.ReadAll(io.LimitReader(os.Stdin, 8193))
			if err != nil || len(input) > 8192 {
				fmt.Fprintln(os.Stderr, "identityctl: invalid stdin account input")
				return 2
			}
			d := json.NewDecoder(bytes.NewReader(input))
			d.DisallowUnknownFields()
			if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF {
				fmt.Fprintln(os.Stderr, "identityctl: invalid stdin account input")
				return 2
			}
			service, err := identity.New(pool, cfg.MasterKey)
			if err != nil {
				return 2
			}
			if *command == "reset-admin" {
				e = service.ResetAdmin(ctx, in.Email, in.Password, in.TOTPSecret)
				break
			}
			role := "user"
			if *command == "bootstrap-admin" {
				role = "admin"
			} else if *command == "create-billing-staff" {
				role = "billing_staff"
			}
			var user identity.User
			user, e = service.CreateAccount(ctx, in.Email, in.DisplayName, in.Password, role, in.TOTPSecret)
			if e == nil {
				fmt.Printf("identityctl: account created; id=%s; role=%s\n", user.ID, user.Role)
			}
		case "grant-billing-role":
			var in struct {
				ActorID         string `json:"actorId"`
				AccountID       string `json:"accountId"`
				Role            string `json:"role"`
				Action          string `json:"action"`
				Reason          string `json:"reason"`
				ExpectedVersion int64  `json:"expectedVersion"`
			}
			d := json.NewDecoder(io.LimitReader(os.Stdin, 4097))
			d.DisallowUnknownFields()
			if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF || len(in.Reason) < 4 || len(in.Reason) > 256 || (in.Action != "grant" && in.Action != "revoke") {
				e = identity.ErrValidation
				break
			}
			validRole := false
			for _, role := range []string{"billing.viewer", "billing.operator", "billing.finance", "billing.pricing", "billing.admin"} {
				if in.Role == role {
					validRole = true
				}
			}
			if !validRole || len(in.AccountID) < 1 || len(in.AccountID) > 128 || len(in.ActorID) < 1 || len(in.ActorID) > 128 || in.ExpectedVersion < 0 {
				e = identity.ErrValidation
				break
			}
			tx, err := pool.Begin(ctx)
			if err != nil {
				e = err
				break
			}
			defer tx.Rollback(ctx)
			var actorIsAdmin bool
			if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM accounts a JOIN billing_staff_roles b ON b.account_id=a.id WHERE a.id=$1 AND a.status='active' AND b.role='billing.admin' AND b.revoked_at IS NULL)`, in.ActorID).Scan(&actorIsAdmin); err != nil || !actorIsAdmin {
				e = identity.ErrForbidden
				break
			}
			var accountRole string
			if err = tx.QueryRow(ctx, `SELECT role FROM accounts WHERE id=$1 AND status='active' FOR UPDATE`, in.AccountID).Scan(&accountRole); err != nil || (accountRole != "admin" && accountRole != "billing_staff") {
				e = identity.ErrForbidden
				break
			}
			if in.Action == "grant" {
				if in.ExpectedVersion == 0 {
					var tag pgconn.CommandTag
					tag, e = tx.Exec(ctx, `INSERT INTO billing_staff_roles(account_id,role,granted_by) VALUES($1,$2,$3) ON CONFLICT(account_id,role) DO NOTHING`, in.AccountID, in.Role, in.ActorID)
					if e == nil && tag.RowsAffected() != 1 {
						e = identity.ErrConflict
					}
				} else {
					var tag pgconn.CommandTag
					tag, e = tx.Exec(ctx, `UPDATE billing_staff_roles SET revoked_at=NULL,granted_by=$3,granted_at=clock_timestamp(),version=version+1 WHERE account_id=$1 AND role=$2 AND version=$4`, in.AccountID, in.Role, in.ActorID, in.ExpectedVersion)
					if e == nil && tag.RowsAffected() != 1 {
						e = identity.ErrConflict
					}
				}
			} else {
				if in.Role == "billing.admin" {
					if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(20261007035)`); err != nil {
						e = err
						break
					}
					var remaining int
					if err = tx.QueryRow(ctx, `SELECT count(*) FROM billing_staff_roles b JOIN accounts a ON a.id=b.account_id WHERE b.role='billing.admin' AND b.revoked_at IS NULL AND a.status='active' AND b.account_id<>$1`, in.AccountID).Scan(&remaining); err != nil || remaining == 0 {
						e = identity.ErrForbidden
						break
					}
				}
				tag, err := tx.Exec(ctx, `UPDATE billing_staff_roles SET revoked_at=clock_timestamp(),version=version+1 WHERE account_id=$1 AND role=$2 AND revoked_at IS NULL AND version=$3`, in.AccountID, in.Role, in.ExpectedVersion)
				e = err
				if e == nil && tag.RowsAffected() != 1 {
					e = identity.ErrNotFound
				}
			}
			if e == nil {
				_, e = tx.Exec(ctx, `INSERT INTO audit_events(actor_id,action,target_id,result,reason) VALUES($1,$2,$3,'succeeded',$4)`, in.ActorID, "billing.role_"+in.Action, in.AccountID+":"+in.Role, in.Reason)
			}
			if e == nil {
				e = tx.Commit(ctx)
			}
		case "grant-cloud":
			var in struct {
				AccountID    string    `json:"accountId"`
				RequestLimit int       `json:"requestLimit"`
				ExpiresAt    time.Time `json:"expiresAt"`
			}
			d := json.NewDecoder(io.LimitReader(os.Stdin, 8193))
			d.DisallowUnknownFields()
			if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF {
				e = identity.ErrValidation
				break
			}
			e = (&gateway.Store{Pool: pool}).Grant(ctx, in.AccountID, in.RequestLimit, in.ExpiresAt)
		case "publish-product":
			var in payments.Product
			d := json.NewDecoder(io.LimitReader(os.Stdin, 32769))
			d.DisallowUnknownFields()
			if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF {
				e = identity.ErrValidation
				break
			}
			if !in.TestOnly && in != payments.PilotSubscription() && in != payments.PilotDiagnosticPack() {
				a, err := lifecycle.ReadApprovals(os.Getenv("MATERIALSX_BETA_APPROVALS_FILE"), gateway.RouteVersion)
				if err != nil || len(a.Missing(time.Now().UTC())) > 0 {
					e = identity.ErrForbidden
					break
				}
			}
			tx, err := pool.Begin(ctx)
			if err != nil {
				e = err
				break
			}
			defer tx.Rollback(ctx)
			e = payments.PutProduct(ctx, tx, in)
			if e == nil {
				_, e = tx.Exec(ctx, `INSERT INTO audit_events(action,target_id,result,reason) VALUES('payment.product_publish',$1,'succeeded','immutable deployment product snapshot')`, in.ID)
			}
			if e == nil {
				e = tx.Commit(ctx)
			}
		case "publish-sales-price", "publish-purchase-price", "grant-test-credits":
			tx, err := pool.Begin(ctx)
			if err != nil {
				e = err
				break
			}
			defer tx.Rollback(ctx)
			d := json.NewDecoder(io.LimitReader(os.Stdin, 32769))
			d.DisallowUnknownFields()
			if *command == "grant-test-credits" {
				var in metering.Grant
				if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF {
					e = identity.ErrValidation
					break
				}
				_ = tx.Rollback(ctx)
				e = (&metering.Store{Pool: pool}).Grant(ctx, in)
				break
			}
			if *command == "publish-sales-price" {
				var in metering.Price
				if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF {
					e = identity.ErrValidation
					break
				}
				e = metering.PutPrice(ctx, tx, in)
			} else {
				var in metering.PurchasePrice
				if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF {
					e = identity.ErrValidation
					break
				}
				e = metering.PutPurchase(ctx, tx, in)
			}
			if e == nil {
				_, e = tx.Exec(ctx, `INSERT INTO audit_events(action,result,reason) VALUES('billing.price_publish','succeeded','immutable deployment price version')`)
			}
			if e == nil {
				e = tx.Commit(ctx)
			}
		case "verify-ledger":
			var n int
			n, e = (&metering.Store{Pool: pool}).Verify(ctx)
			if e == nil {
				fmt.Printf("identityctl: ledger verified; grants=%d\n", n)
			}
		case "repair-output-overrun":
			var in struct {
				RequestID string `json:"requestId"`
			}
			d := json.NewDecoder(io.LimitReader(os.Stdin, 4097))
			d.DisallowUnknownFields()
			if d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF {
				e = identity.ErrValidation
				break
			}
			e = (&gateway.Store{Pool: pool}).RepairOutputOverrun(ctx, in.RequestID)
		case "prune":
			_, e = pool.Exec(ctx, `DELETE FROM auth_flows WHERE expires_at<clock_timestamp()-interval '1 day'; DELETE FROM access_tokens WHERE expires_at<clock_timestamp(); DELETE FROM refresh_tokens WHERE expires_at<clock_timestamp(); DELETE FROM rate_limits WHERE window_start<clock_timestamp()-interval '1 day'`)
		default:
			e = identity.ErrValidation
		}
	}
	if e != nil {
		fmt.Fprintln(os.Stderr, "identityctl: operation rejected or database operation failed")
		return 2
	}
	fmt.Println("identityctl: operation completed")
	return 0
}

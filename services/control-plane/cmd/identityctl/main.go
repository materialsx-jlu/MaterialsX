package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/jamip/materialsx/control-plane/internal/gateway"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/lifecycle"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"github.com/jamip/materialsx/control-plane/internal/payments"
	"github.com/jamip/materialsx/control-plane/migrations"
	"io"
	"os"
	"time"
)

func main() { os.Exit(run()) }
func run() int {
	command := flag.String("command", "check", "migrate, check, create-user, bootstrap-admin, reset-admin, grant-runtime, invalidate-sessions, prune, release-manifest-hash, publish-product, publish-sales-price, publish-purchase-price, grant-test-credits, verify-ledger")
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
		case "grant-runtime":
			e = identity.GrantRuntime(ctx, pool, *runtimeRole)
		case "invalidate-sessions":
			e = identity.InvalidateSessions(ctx, pool)
		case "create-user", "bootstrap-admin", "reset-admin":
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
			}
			var user identity.User
			user, e = service.CreateAccount(ctx, in.Email, in.DisplayName, in.Password, role, in.TOTPSecret)
			if e == nil {
				fmt.Printf("identityctl: account created; id=%s; role=%s\n", user.ID, user.Role)
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

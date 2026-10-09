package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/billingadmin"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/migrations"
)

func main() {
	once := flag.Bool("once", false, "claim at most one deployment job")
	reconcile := flag.String("reconcile", "", "inspect one uncertain job without re-dispatching")
	restore := flag.String("restore", "", "restore the previous proxy release for one uncertain job")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	cfg, e := identity.ConfigFromEnv()
	if e != nil {
		log.Fatal("model deploy: invalid identity configuration")
	}
	runtime := os.Getenv("MX_LITELLM_RUNTIME")
	runner := os.Getenv("MATERIALSX_MODEL_DEPLOY_RUNNER")
	if !filepath.IsAbs(runtime) || !filepath.IsAbs(runner) {
		log.Fatal("model deploy: absolute runtime and runner required")
	}
	startup, cancel := context.WithTimeout(ctx, 15*time.Second)
	pool, e := identity.OpenPool(startup, cfg)
	if e != nil {
		log.Fatal("model deploy: database unavailable")
	}
	defer pool.Close()
	if migrations.Check(startup, pool) != nil {
		log.Fatal("model deploy: migrations not current")
	}
	if cfg.Environment == "production" && identity.CheckRuntimeRole(startup, pool) != nil {
		log.Fatal("model deploy: restricted database role required")
	}
	lockConn, e := pool.Acquire(startup)
	if e != nil {
		log.Fatal("model deploy: singleton lock unavailable")
	}
	defer lockConn.Release()
	const lockID int64 = 0x4d584d4f44454c
	var locked bool
	if e = lockConn.QueryRow(startup, `SELECT pg_try_advisory_lock($1)`, lockID).Scan(&locked); e != nil || !locked {
		log.Fatal("model deploy: another worker owns the queue")
	}
	defer lockConn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, lockID)
	service, e := identity.New(pool, cfg.MasterKey)
	if e != nil {
		log.Fatal("model deploy: identity key unavailable")
	}
	if e = billingadmin.MarkInterruptedDeploys(startup, pool); e != nil {
		log.Fatal("model deploy: recovery marker failed")
	}
	cancel()
	if *reconcile != "" || *restore != "" {
		if *reconcile != "" && *restore != "" {
			log.Fatal("model deploy: choose one recovery action")
		}
		id, mode := *reconcile, "reconcile"
		if *restore != "" {
			id, mode = *restore, "restore"
		}
		job, err := billingadmin.LoadUncertainDeploy(ctx, pool, id)
		if err != nil {
			log.Fatal("model deploy: uncertain job not found")
		}
		state, receipt := invokeRunner(ctx, runtime, runner, job, mode)
		if err = billingadmin.ReconcileModelDeploy(ctx, pool, job, state, receipt); err != nil {
			log.Fatal("model deploy: reconciliation receipt failed")
		}
		log.Printf("model deploy: reconciliation %s state=%s", job.ID, state)
		return
	}
	exporter := &billingadmin.HTTP{Pool: pool, Identity: service}
	for ctx.Err() == nil {
		job, e := billingadmin.ClaimModelDeploy(ctx, pool)
		if errors.Is(e, pgx.ErrNoRows) {
			if *once {
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
			}
			continue
		}
		if e != nil {
			log.Print("model deploy: claim failed")
			if *once {
				return
			}
			time.Sleep(2 * time.Second)
			continue
		}
		state, receipt := process(ctx, exporter, runtime, runner, job)
		finish, done := context.WithTimeout(context.Background(), 15*time.Second)
		if e = billingadmin.FinishModelDeploy(finish, pool, job, state, receipt); e != nil {
			log.Print("model deploy: receipt write failed; inspect original job")
		}
		done()
		if *once {
			return
		}
	}
}

func process(ctx context.Context, h *billingadmin.HTTP, runtime, runner string, job billingadmin.DeployJob) (string, map[string]any) {
	current, _, e := billingadmin.CatalogRevision(ctx, h.Pool)
	if e != nil {
		return "uncertain", map[string]any{"reason": "CATALOG_READ_FAILED"}
	}
	if current != job.ExpectedRevision {
		return "failed", map[string]any{"reason": "CATALOG_VERSION_CHANGED"}
	}
	dir := filepath.Join(runtime, "deploy-jobs", job.ID)
	if e = os.MkdirAll(dir, 0700); e != nil {
		return "failed", map[string]any{"reason": "STAGING_DIRECTORY_FAILED"}
	}
	path := filepath.Join(dir, "model-registry.json")
	if e = h.ExportModelManifest(ctx, path); e != nil {
		return "failed", map[string]any{"reason": "MANIFEST_EXPORT_FAILED"}
	}
	current, _, e = billingadmin.CatalogRevision(ctx, h.Pool)
	if e != nil || current != job.ExpectedRevision {
		return "failed", map[string]any{"reason": "CATALOG_CHANGED_DURING_EXPORT"}
	}
	return invokeRunner(ctx, runtime, runner, job, "deploy")
}

func invokeRunner(ctx context.Context, runtime, runner string, job billingadmin.DeployJob, mode string) (string, map[string]any) {
	call, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	args := []string{runner, "--candidate", filepath.Join(runtime, "deploy-jobs", job.ID, "model-registry.json"), "--job", job.ID}
	if mode != "deploy" {
		args = append(args, "--"+mode)
	}
	cmd := exec.CommandContext(call, processExecutable(), args...)
	cmd.Env = append(os.Environ(), "MATERIALSX_MODEL_DEPLOY_EXPECTED_REVISION="+job.ExpectedRevision)
	var output boundedReceipt
	cmd.Stdout = &output
	cmd.Stderr = io.Discard
	e := cmd.Run()
	var result struct {
		State             string `json:"state"`
		Reason            string `json:"reason"`
		ManifestSha256    string `json:"manifestSha256"`
		ConfigSha256      string `json:"configSha256"`
		ProxyChecked      bool   `json:"proxyChecked"`
		RollbackConfirmed bool   `json:"rollbackConfirmed"`
	}
	if output.truncated || json.Unmarshal(output.Bytes(), &result) != nil {
		return "uncertain", map[string]any{"reason": "RUNNER_RECEIPT_UNKNOWN"}
	}
	if e == nil && result.State == "succeeded" && result.ProxyChecked {
		return "succeeded", map[string]any{"manifestSha256": result.ManifestSha256, "configSha256": result.ConfigSha256, "proxyChecked": true}
	}
	if result.State == "failed" && result.RollbackConfirmed {
		return "failed", map[string]any{"reason": result.Reason, "rollbackConfirmed": true}
	}
	return "uncertain", map[string]any{"reason": "RUNNER_OUTCOME_UNKNOWN"}
}

type boundedReceipt struct {
	bytes.Buffer
	truncated bool
}

func (b *boundedReceipt) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 16384 {
		b.truncated = true
		return len(p), nil
	}
	return b.Buffer.Write(p)
}

func processExecutable() string {
	if p := os.Getenv("MATERIALSX_NODE_BINARY"); filepath.IsAbs(p) {
		return p
	}
	return "node"
}

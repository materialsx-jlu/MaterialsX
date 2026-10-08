package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
)

func main() {
	os.Exit(run())
}

func run() int {
	mode := flag.String("mode", "inspect", "inspect (no network), discover (models only), live (bounded generation)")
	protocol := flag.String("protocol", "responses", "responses or independently tested chat-completions")
	output := flag.String("output", "runtime/m5/rootflowai-probe.json", "redacted report destination")
	keyStdin := flag.Bool("key-stdin", false, "read credential from private stdin, not command arguments")
	unbudgeted := flag.Bool("unbudgeted-test", false, "explicitly authorized diagnostic run without monetary cap; live only, prices remain unknown")
	flag.Parse()
	cfg, err := rootflow.ConfigFromEnv(*protocol)
	if err != nil {
		fmt.Fprintln(os.Stderr, "M5 probe: invalid configuration; no request sent")
		return 2
	}
	if *keyStdin {
		key, readErr := io.ReadAll(io.LimitReader(os.Stdin, 4097))
		if readErr != nil || len(key) > 4096 {
			fmt.Fprintln(os.Stderr, "M5 probe: invalid stdin credential")
			return 2
		}
		cfg.Key = strings.TrimSpace(string(key))
	}
	cfg.UnbudgetedTest = *unbudgeted
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	var report rootflow.Report
	// Stable path independent of report filename. Documented npm commands run
	// in services/control-plane; preserve this file across all test runs.
	if *mode == "live" && !cfg.UnbudgetedTest && cfg.Key != "" && cfg.PriceConfirmed && cfg.PriceReference != "" &&
		cfg.Group != "" && cfg.Membership != "" && cfg.InputPrice > 0 && cfg.OutputPrice > 0 {
		campaign, err := rootflow.OpenCampaign("../../runtime/m5/rootflowai-budget.json", cfg.BudgetFen)
		if err != nil {
			report = rootflow.RunProbe(ctx, cfg, "inspect")
			report.Status = "blocked"
			report.Checks = append(report.Checks, rootflow.Check{ID: "campaign_budget", Status: "blocked", Reason: err.Error()})
		} else {
			defer campaign.Close()
			rootflow.AttachCampaign(&cfg, campaign)
		}
	}
	if report.SchemaVersion == "" {
		report = rootflow.RunProbe(ctx, cfg, *mode)
	}
	body, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, "M5 probe: report encoding failed")
		return 2
	}
	if os.MkdirAll(filepath.Dir(*output), 0700) != nil || os.WriteFile(*output, append(body, '\n'), 0600) != nil {
		fmt.Fprintln(os.Stderr, "M5 probe: report write failed")
		return 2
	}
	fmt.Printf("M5 probe: %s; generation calls=%d; redacted report written\n", report.Status, report.GenerationCalls)
	if *mode != "inspect" && report.Status == "blocked" {
		return 2
	}
	return 0
}

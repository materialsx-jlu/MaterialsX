package rootflow

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// Campaign is a local test safety guard, not the production credits ledger.
// Each possibly billed attempt keeps its full bound across process restarts.
type Campaign struct {
	path, lock       string
	budget, reserved int64
	closed           bool
}
type campaignState struct {
	Version  string `json:"version"`
	Reserved int64  `json:"reservedUpperFen,string"`
}

func OpenCampaign(path string, budget int64) (*Campaign, error) {
	if budget <= 0 || budget > 3000 {
		return nil, errors.New("invalid_campaign_budget")
	}
	if os.MkdirAll(filepath.Dir(path), 0700) != nil {
		return nil, errors.New("campaign_directory_failed")
	}
	lock := path + ".lock"
	file, err := os.OpenFile(lock, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, errors.New("campaign_busy_or_stale_lock")
	}
	_, writeErr := fmt.Fprintf(file, "pid=%d\n", os.Getpid())
	if closeErr := file.Close(); writeErr != nil || closeErr != nil {
		os.Remove(lock)
		return nil, errors.New("campaign_lock_failed")
	}
	c := &Campaign{path: path, lock: lock, budget: budget}
	b, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		c.Close()
		return nil, errors.New("campaign_read_failed")
	}
	if err == nil {
		var state campaignState
		if json.Unmarshal(b, &state) != nil || state.Version != "m5.0-v1" || state.Reserved < 0 || state.Reserved > 3000 {
			c.Close()
			return nil, errors.New("campaign_state_invalid")
		}
		c.reserved = state.Reserved
	}
	if c.reserved > budget {
		c.Close()
		return nil, errors.New("campaign_already_exceeds_configured_budget")
	}
	return c, nil
}
func (c *Campaign) Reserve(amount int64) error {
	if c.closed || amount <= 0 || amount > c.budget-c.reserved {
		return errors.New("campaign_budget_exceeded")
	}
	next := c.reserved + amount
	b, err := json.Marshal(campaignState{Version: "m5.0-v1", Reserved: next})
	if err != nil {
		return errors.New("campaign_encode_failed")
	}
	f, err := os.CreateTemp(filepath.Dir(c.path), ".m5-budget-*")
	if err != nil {
		return errors.New("campaign_write_failed")
	}
	name := f.Name()
	defer os.Remove(name)
	_, err = f.Write(append(b, '\n'))
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil || closeErr != nil || os.Rename(name, c.path) != nil {
		return errors.New("campaign_write_failed")
	}
	c.reserved = next
	return nil
}
func (c *Campaign) Close() error {
	if c.closed {
		return nil
	}
	c.closed = true
	return os.Remove(c.lock)
}

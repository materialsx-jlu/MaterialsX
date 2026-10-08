package rootflow

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCampaignPersistsBoundsAndRejectsConcurrentRun(t *testing.T) {
	path := filepath.Join(t.TempDir(), "budget.json")
	c, err := OpenCampaign(path, 3000)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := OpenCampaign(path, 3000); err == nil {
		t.Fatal("parallel campaign allowed")
	}
	if c.Reserve(2000) != nil {
		t.Fatal("reserve failed")
	}
	if c.Reserve(1001) == nil {
		t.Fatal("budget exceeded")
	}
	if c.Close() != nil {
		t.Fatal("close failed")
	}
	c, err = OpenCampaign(path, 3000)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if c.Reserve(1001) == nil {
		t.Fatal("restart reset campaign")
	}
	if c.Reserve(1000) != nil || c.Reserve(1) == nil {
		t.Fatal("exact budget boundary failed")
	}
}
func TestCampaignRejectsCorruptStateWithoutReset(t *testing.T) {
	path := filepath.Join(t.TempDir(), "budget.json")
	os.WriteFile(path, []byte(`{"version":"m5.0-v1","reservedUpperFen":"-1"}`), 0600)
	if _, err := OpenCampaign(path, 3000); err == nil {
		t.Fatal("corrupt state reset")
	}
	if _, err := os.Stat(path + ".lock"); !os.IsNotExist(err) {
		t.Fatal("failed open leaked lock")
	}
}

package delivery

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCipherAADAndPrivateSink(t *testing.T) {
	key := []byte(strings.Repeat("K", 32))
	body, e := Seal(key, "id", []byte("secret-token"))
	if e != nil {
		t.Fatal(e)
	}
	if strings.Contains(string(body), "secret-token") {
		t.Fatal("plaintext")
	}
	if _, e = Open(key, "other", body); e == nil {
		t.Fatal("AAD bypass")
	}
	body[12] ^= 1
	if _, e = Open(key, "id", body); e == nil {
		t.Fatal("tamper")
	}
	dir := filepath.Join(t.TempDir(), "mail")
	s := FileSender{dir}
	m := Message{To: "fixture@example.test", Subject: "验证", Text: "fixture"}
	if e = s.Send(context.Background(), "id", m); e != nil {
		t.Fatal(e)
	}
	if e = s.Send(context.Background(), "id", m); e != nil {
		t.Fatal("replay", e)
	}
	info, _ := os.Stat(filepath.Join(dir, "id.json"))
	if info.Mode().Perm() != 0600 {
		t.Fatal("mode")
	}
	m.Text = "changed"
	if e = s.Send(context.Background(), "id", m); e == nil {
		t.Fatal("conflict")
	}
}

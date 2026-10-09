package identity

import (
	"bytes"
	"testing"
)

func TestModelCredentialEncryptionBindsModelID(t *testing.T) {
	service, err := New(nil, bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	const secret = "synthetic-provider-key"
	sealed, err := service.SealModelKey("model-a", secret)
	if err != nil || bytes.Contains(sealed, []byte(secret)) {
		t.Fatal("credential not sealed")
	}
	opened, err := service.OpenModelKey("model-a", sealed)
	if err != nil || opened != secret {
		t.Fatal("credential could not be recovered")
	}
	if _, err := service.OpenModelKey("model-b", sealed); err == nil {
		t.Fatal("credential accepted for another model")
	}
	sealed[0] ^= 1
	if _, err := service.OpenModelKey("model-a", sealed); err == nil {
		t.Fatal("tampered credential accepted")
	}
}

package identity

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
)

// SealModelKey binds a supplier credential to one model ID. Neither the
// ciphertext nor the plaintext is exposed by the billing administration API.
func (s *Service) SealModelKey(modelID, value string) ([]byte, error) {
	block, err := aes.NewCipher(s.key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, []byte(value), []byte("mx-model-key-v1:"+modelID)), nil
}

func (s *Service) OpenModelKey(modelID string, body []byte) (string, error) {
	block, err := aes.NewCipher(s.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil || len(body) < gcm.NonceSize() {
		return "", errors.New("invalid_model_key_cipher")
	}
	plain, err := gcm.Open(nil, body[:gcm.NonceSize()], body[gcm.NonceSize():], []byte("mx-model-key-v1:"+modelID))
	if err != nil {
		return "", errors.New("invalid_model_key_cipher")
	}
	return string(plain), nil
}

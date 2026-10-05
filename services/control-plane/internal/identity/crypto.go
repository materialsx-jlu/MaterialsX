package identity

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" // RFC 6238 TOTP SHA-1; not used for passwords or token hashes.
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"golang.org/x/crypto/argon2"
	"strconv"
	"strings"
	"time"
)

func randomID() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic("secure_random_unavailable")
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func digest(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func Challenge(s string) string {
	h := sha256.Sum256([]byte(s))
	return base64.RawURLEncoding.EncodeToString(h[:])
}
func passwordHash(password string) (string, error) {
	if len(password) < 12 || len(password) > 128 {
		return "", ErrValidation
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(password), salt, 2, 19456, 1, 32)
	return "$argon2id$v=19$m=19456,t=2,p=1$" + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(hash), nil
}
func passwordMatches(encoded, password string) bool {
	if len(password) > 128 {
		return false
	}
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || strings.Join(parts[:4], "$") != "$argon2id$v=19$m=19456,t=2,p=1" {
		return false
	}
	salt, e := base64.RawStdEncoding.DecodeString(parts[4])
	hash, e2 := base64.RawStdEncoding.DecodeString(parts[5])
	if e != nil || e2 != nil || len(salt) != 16 || len(hash) != 32 {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, 2, 19456, 1, 32)
	return subtle.ConstantTimeCompare(actual, hash) == 1
}
func encryptSecret(key []byte, accountID, secret string) ([]byte, error) {
	block, e := aes.NewCipher(key)
	if e != nil {
		return nil, e
	}
	g, e := cipher.NewGCM(block)
	if e != nil {
		return nil, e
	}
	nonce := make([]byte, g.NonceSize())
	if _, e = rand.Read(nonce); e != nil {
		return nil, e
	}
	return g.Seal(nonce, nonce, []byte(secret), []byte("mx-mfa-v1:"+accountID)), nil
}
func decryptSecret(key []byte, accountID string, body []byte) (string, error) {
	block, e := aes.NewCipher(key)
	if e != nil {
		return "", e
	}
	g, e := cipher.NewGCM(block)
	if e != nil || len(body) < g.NonceSize() {
		return "", errors.New("invalid_mfa_cipher")
	}
	plain, e := g.Open(nil, body[:g.NonceSize()], body[g.NonceSize():], []byte("mx-mfa-v1:"+accountID))
	return string(plain), e
}
func TOTP(secret string, step int64) (string, error) {
	key, e := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(secret))
	if e != nil || len(key) < 20 {
		return "", ErrValidation
	}
	b := make([]byte, 8)
	binary.BigEndian.PutUint64(b, uint64(step))
	h := hmac.New(sha1.New, key)
	h.Write(b)
	v := h.Sum(nil)
	o := int(v[len(v)-1] & 15)
	n := binary.BigEndian.Uint32(v[o:o+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", n%1000000), nil
}
func matchTOTP(secret, code string, now time.Time, last int64) (int64, bool) {
	if len(code) != 6 {
		return 0, false
	}
	if _, e := strconv.Atoi(code); e != nil {
		return 0, false
	}
	for d := int64(-1); d <= 1; d++ {
		step := now.Unix()/30 + d
		if step <= last {
			continue
		}
		expect, e := TOTP(secret, step)
		if e == nil && subtle.ConstantTimeCompare([]byte(expect), []byte(code)) == 1 {
			return step, true
		}
	}
	return 0, false
}

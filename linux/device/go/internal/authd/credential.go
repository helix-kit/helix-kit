// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
)

// The persistent credential format.
//
//	hlx1_D7K4P9QX_1tBc9hWz0jlyHNhQd6X9B3h7IyMdxk9BqCEgTlePgeQ
//	^     ^        ^
//	|     |        the secret: 256 bits, base64url, unpadded
//	|     the credential id, which is not secret and identifies the record
//	the format version, so a future format is a parse error and not a guess
const (
	credentialPrefix   = "hlx1"
	credentialIDChars  = 8
	credentialIDBytes  = 5
	credentialSecretSz = 32
)

// PersistentCredential is a parsed credential. The secret is only ever held for
// as long as it takes to verify or relay it.
type PersistentCredential struct {
	ID     string
	Secret []byte
}

// String renders the credential the way the user holds it.
func (c PersistentCredential) String() string {
	return credentialPrefix + "_" + c.ID + "_" +
		base64.RawURLEncoding.EncodeToString(c.Secret)
}

// LogValue keeps the secret out of logs even if a credential is passed to one.
func (c PersistentCredential) LogValue() string {
	return credentialPrefix + "_" + c.ID + "_[redacted]"
}

// NewPersistentCredential mints a credential with a fresh id and secret.
func NewPersistentCredential(readRandom func([]byte) error) (PersistentCredential, error) {
	if readRandom == nil {
		readRandom = func(buf []byte) error {
			_, err := rand.Read(buf)
			return err
		}
	}

	idBytes := make([]byte, credentialIDBytes)
	if err := readRandom(idBytes); err != nil {
		return PersistentCredential{}, fmt.Errorf("read random: %w", err)
	}
	id, err := encodeCode(idBytes)
	if err != nil {
		return PersistentCredential{}, err
	}

	secret := make([]byte, credentialSecretSz)
	if err := readRandom(secret); err != nil {
		return PersistentCredential{}, fmt.Errorf("read random: %w", err)
	}
	return PersistentCredential{ID: id, Secret: secret}, nil
}

// ParseCredential reads a credential the user pasted.
//
// Parsing is strict on purpose: anything that is not exactly this format is
// rejected rather than coerced, so a truncated paste fails loudly instead of
// being verified against something shorter.
func ParseCredential(token string) (PersistentCredential, error) {
	// SplitN, not Split: the secret is base64url, whose alphabet includes "_",
	// so splitting on every underscore would tear the secret apart.
	parts := strings.SplitN(strings.TrimSpace(token), "_", 3)
	if len(parts) != 3 {
		return PersistentCredential{}, fmt.Errorf("credential must look like %s_<id>_<secret>", credentialPrefix)
	}
	if parts[0] != credentialPrefix {
		return PersistentCredential{}, fmt.Errorf("unknown credential format %q", parts[0])
	}

	id := parts[1]
	if len(id) != credentialIDChars {
		return PersistentCredential{}, fmt.Errorf("credential id must be %d characters", credentialIDChars)
	}
	if _, err := decodeCode(id); err != nil {
		return PersistentCredential{}, fmt.Errorf("credential id is not valid: %w", err)
	}

	secret, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return PersistentCredential{}, fmt.Errorf("credential secret is not valid base64url: %w", err)
	}
	if len(secret) != credentialSecretSz {
		return PersistentCredential{}, fmt.Errorf("credential secret must be %d bytes, got %d",
			credentialSecretSz, len(secret))
	}
	return PersistentCredential{ID: id, Secret: secret}, nil
}

// CredentialVerifier is what the device keeps instead of the credential.
//
// It is a keyed digest, not a hash of the secret alone: without the device's own
// key, a stolen state database yields nothing that can be replayed or attacked
// offline.
func CredentialVerifier(deviceKey, secret []byte) (string, error) {
	if len(deviceKey) == 0 {
		return "", fmt.Errorf("credential device key is empty")
	}
	mac := hmac.New(sha256.New, deviceKey)
	mac.Write([]byte("HXCRED1"))
	mac.Write(secret)
	return hex.EncodeToString(mac.Sum(nil)), nil
}

// VerifierMatches compares in constant time.
func VerifierMatches(expected, got string) bool {
	return subtle.ConstantTimeCompare([]byte(expected), []byte(got)) == 1
}

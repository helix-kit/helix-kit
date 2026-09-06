// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestCredentialRoundTrip(t *testing.T) {
	cred, err := NewPersistentCredential(nil)
	if err != nil {
		t.Fatalf("NewPersistentCredential: %v", err)
	}

	parsed, err := ParseCredential(cred.String())
	if err != nil {
		t.Fatalf("ParseCredential: %v", err)
	}
	if parsed.ID != cred.ID {
		t.Errorf("id = %q, want %q", parsed.ID, cred.ID)
	}
	if string(parsed.Secret) != string(cred.Secret) {
		t.Error("the secret did not survive the round trip")
	}
	if len(cred.Secret) != credentialSecretSz {
		t.Errorf("secret is %d bytes, want %d", len(cred.Secret), credentialSecretSz)
	}
}

// base64url includes "-" and "_", so a secret containing an underscore must not
// be torn apart by the parser. This is a real format hazard, not a hypothetical.
func TestParseCredentialHandlesUnderscoresInTheSecret(t *testing.T) {
	secret := make([]byte, credentialSecretSz)
	// 0xFB 0xF0 encodes to "-_" in base64url, guaranteeing both characters appear.
	for i := range secret {
		secret[i] = 0xFB
		if i%2 == 1 {
			secret[i] = 0xF0
		}
	}
	encoded := base64.RawURLEncoding.EncodeToString(secret)
	if !strings.Contains(encoded, "_") {
		t.Fatalf("this test needs a secret encoding that contains an underscore, got %s", encoded)
	}

	cred := PersistentCredential{ID: "D7K4P9QX", Secret: secret}
	parsed, err := ParseCredential(cred.String())
	if err != nil {
		t.Fatalf("ParseCredential: %v", err)
	}
	if string(parsed.Secret) != string(secret) {
		t.Fatal("the secret was mangled by the parser")
	}
}

func TestParseCredentialRejectsBadInput(t *testing.T) {
	valid, err := NewPersistentCredential(nil)
	if err != nil {
		t.Fatalf("NewPersistentCredential: %v", err)
	}
	encodedSecret := base64.RawURLEncoding.EncodeToString(valid.Secret)
	shortSecret := base64.RawURLEncoding.EncodeToString(valid.Secret[:16])

	cases := map[string]string{
		"empty":              "",
		"no parts":           "hlx1",
		"missing secret":     "hlx1_" + valid.ID,
		"unknown version":    "hlx9_" + valid.ID + "_" + encodedSecret,
		"short id":           "hlx1_ABC_" + encodedSecret,
		"id outside the set": "hlx1_ABCDEFG0_" + encodedSecret,
		"secret not base64":  "hlx1_" + valid.ID + "_not base64!",
		"truncated secret":   "hlx1_" + valid.ID + "_" + shortSecret,
	}
	for name, token := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := ParseCredential(token); err == nil {
				t.Fatalf("ParseCredential(%q) was accepted", token)
			}
		})
	}
}

func TestCredentialsAreUnique(t *testing.T) {
	seen := make(map[string]bool)
	for range 50 {
		cred, err := NewPersistentCredential(nil)
		if err != nil {
			t.Fatalf("NewPersistentCredential: %v", err)
		}
		if seen[cred.ID] {
			t.Fatalf("credential id %s was issued twice", cred.ID)
		}
		seen[cred.ID] = true
	}
}

// The verifier is keyed, so a stolen state database yields nothing to attack
// offline without the device's own key.
func TestCredentialVerifierIsKeyed(t *testing.T) {
	secret := []byte(strings.Repeat("s", 32))

	first, err := CredentialVerifier([]byte(strings.Repeat("k", 32)), secret)
	if err != nil {
		t.Fatalf("CredentialVerifier: %v", err)
	}
	second, err := CredentialVerifier([]byte(strings.Repeat("j", 32)), secret)
	if err != nil {
		t.Fatalf("CredentialVerifier: %v", err)
	}
	if first == second {
		t.Fatal("two different device keys produced the same verifier")
	}
	if strings.Contains(first, string(secret)) {
		t.Fatal("the verifier contains the secret")
	}

	if _, err := CredentialVerifier(nil, secret); err == nil {
		t.Error("an empty device key was accepted")
	}
}

func TestVerifierMatches(t *testing.T) {
	if !VerifierMatches("abc", "abc") {
		t.Error("identical verifiers did not match")
	}
	if VerifierMatches("abc", "abd") || VerifierMatches("abc", "") {
		t.Error("different verifiers matched")
	}
}

// A credential must not be able to leak through a log line.
func TestCredentialLogValueRedactsTheSecret(t *testing.T) {
	cred, err := NewPersistentCredential(nil)
	if err != nil {
		t.Fatalf("NewPersistentCredential: %v", err)
	}

	logged := cred.LogValue()
	if strings.Contains(logged, base64.RawURLEncoding.EncodeToString(cred.Secret)) {
		t.Fatalf("the secret survived redaction: %s", logged)
	}
	if !strings.Contains(logged, cred.ID) {
		t.Errorf("the id should still be logged for correlation: %s", logged)
	}
}

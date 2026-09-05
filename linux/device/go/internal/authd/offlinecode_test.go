// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// vectorsPath is read by this suite and by the TypeScript cloud implementation,
// so the two can never drift apart on what a valid response is.
const vectorsPath = "testdata/offline-response-vectors.json"

type offlineVector struct {
	Name      string `json:"name"`
	SecretHex string `json:"secretHex"`
	DeviceID  string `json:"deviceId"`
	UserID    string `json:"userId"`
	LinuxUID  uint32 `json:"linuxUid"`
	Challenge string `json:"challenge"`
	Response  string `json:"response"`
}

type offlineVectorFile struct {
	Description string          `json:"description"`
	Algorithm   string          `json:"algorithm"`
	Alphabet    string          `json:"alphabet"`
	Vectors     []offlineVector `json:"vectors"`
}

func (v offlineVector) binding() OfflineBinding {
	return OfflineBinding{
		DeviceID:  v.DeviceID,
		UserID:    v.UserID,
		LinuxUID:  v.LinuxUID,
		Challenge: v.Challenge,
	}
}

func (v offlineVector) secret(t *testing.T) []byte {
	t.Helper()
	secret, err := hex.DecodeString(v.SecretHex)
	if err != nil {
		t.Fatalf("vector %q has an unreadable secret: %v", v.Name, err)
	}
	return secret
}

// TestOfflineResponseVectors pins the wire format. Run with
// UPDATE_OFFLINE_VECTORS=1 to regenerate after a deliberate change -- and expect
// the TypeScript side to fail until it is updated too.
func TestOfflineResponseVectors(t *testing.T) {
	raw, err := os.ReadFile(vectorsPath)
	if err != nil {
		t.Fatalf("read vectors: %v", err)
	}
	var file offlineVectorFile
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatalf("parse vectors: %v", err)
	}
	if len(file.Vectors) == 0 {
		t.Fatal("the vector file is empty")
	}

	updating := os.Getenv("UPDATE_OFFLINE_VECTORS") == "1"
	for i, vector := range file.Vectors {
		got, err := OfflineResponse(vector.secret(t), vector.binding())
		if err != nil {
			t.Fatalf("vector %q: %v", vector.Name, err)
		}
		if updating {
			file.Vectors[i].Response = got
			continue
		}
		if got != vector.Response {
			t.Errorf("vector %q: response = %s, want %s", vector.Name, got, vector.Response)
		}
	}

	if updating {
		encoded, err := json.MarshalIndent(file, "", "  ")
		if err != nil {
			t.Fatalf("encode vectors: %v", err)
		}
		if err := os.WriteFile(vectorsPath, append(encoded, '\n'), 0o644); err != nil {
			t.Fatalf("write vectors: %v", err)
		}
		t.Log("vectors regenerated; update the TypeScript implementation to match")
	}
}

// Every field is bound into the digest, so changing any one of them must change
// the response. This is what makes a code useless for anyone but its owner.
func TestOfflineResponseIsBoundToEveryField(t *testing.T) {
	secret := []byte(strings.Repeat("k", 32))
	base := OfflineBinding{
		DeviceID: "D123", UserID: "user_alice", LinuxUID: 200001, Challenge: "K7MPQ29X",
	}

	original, err := OfflineResponse(secret, base)
	if err != nil {
		t.Fatalf("OfflineResponse: %v", err)
	}

	variants := map[string]OfflineBinding{
		"another device":    {DeviceID: "D999", UserID: base.UserID, LinuxUID: base.LinuxUID, Challenge: base.Challenge},
		"another user":      {DeviceID: base.DeviceID, UserID: "user_bob", LinuxUID: base.LinuxUID, Challenge: base.Challenge},
		"another uid":       {DeviceID: base.DeviceID, UserID: base.UserID, LinuxUID: 200002, Challenge: base.Challenge},
		"another challenge": {DeviceID: base.DeviceID, UserID: base.UserID, LinuxUID: base.LinuxUID, Challenge: "ABCD2345"},
	}
	for name, binding := range variants {
		t.Run(name, func(t *testing.T) {
			got, variantErr := OfflineResponse(secret, binding)
			if variantErr != nil {
				t.Fatalf("OfflineResponse: %v", variantErr)
			}
			if got == original {
				t.Fatalf("%s produced the same response %s", name, got)
			}
		})
	}

	other, err := OfflineResponse([]byte(strings.Repeat("j", 32)), base)
	if err != nil {
		t.Fatalf("OfflineResponse: %v", err)
	}
	if other == original {
		t.Fatal("a different device secret produced the same response")
	}
}

// Length-prefixing keeps adjacent fields from running together: a device id of
// "D1" with user "23x" must not digest the same as "D12" with user "3x".
func TestOfflineResponseFieldsCannotBeConfused(t *testing.T) {
	secret := []byte(strings.Repeat("k", 32))

	first, err := OfflineResponse(secret, OfflineBinding{
		DeviceID: "D1", UserID: "23x", LinuxUID: 1, Challenge: "K7MPQ29X"})
	if err != nil {
		t.Fatalf("OfflineResponse: %v", err)
	}
	second, err := OfflineResponse(secret, OfflineBinding{
		DeviceID: "D12", UserID: "3x", LinuxUID: 1, Challenge: "K7MPQ29X"})
	if err != nil {
		t.Fatalf("OfflineResponse: %v", err)
	}
	if first == second {
		t.Fatal("adjacent fields ran together in the digest")
	}
}

func TestCodeRoundTrip(t *testing.T) {
	raw := []byte{0x01, 0x23, 0x45, 0x67, 0x89}

	code, err := encodeCode(raw)
	if err != nil {
		t.Fatalf("encodeCode: %v", err)
	}
	if len(code) != codeChars {
		t.Fatalf("code %q is %d characters, want %d", code, len(code), codeChars)
	}

	decoded, err := decodeCode(code)
	if err != nil {
		t.Fatalf("decodeCode: %v", err)
	}
	if string(decoded) != string(raw) {
		t.Fatalf("round trip gave %x, want %x", decoded, raw)
	}
}

// People retype these by hand, so the parser has to forgive presentation.
func TestDecodeCodeAcceptsWhatPeopleType(t *testing.T) {
	const canonical = "K7MPQ29X"

	for _, typed := range []string{"K7MPQ29X", "k7mpq29x", "K7MP-Q29X", " k7mp-q29x ", "K7MP Q29X"} {
		decoded, err := decodeCode(typed)
		if err != nil {
			t.Fatalf("decodeCode(%q): %v", typed, err)
		}
		reencoded, err := encodeCode(decoded)
		if err != nil {
			t.Fatalf("encodeCode: %v", err)
		}
		if reencoded != canonical {
			t.Errorf("decodeCode(%q) round-tripped to %q", typed, reencoded)
		}
	}
}

func TestDecodeCodeRejectsBadInput(t *testing.T) {
	// I, L, O, 0 and 1 are deliberately absent from the alphabet.
	for _, bad := range []string{"", "K7MPQ29", "K7MPQ29XY", "K7MPQ29I", "K7MPQ290", "K7MPQ29!"} {
		if _, err := decodeCode(bad); err == nil {
			t.Errorf("decodeCode(%q) was accepted", bad)
		}
	}
}

func TestFormatCode(t *testing.T) {
	if got := formatCode("K7MPQ29X"); got != "K7MP-Q29X" {
		t.Errorf("formatCode = %q, want K7MP-Q29X", got)
	}
	if got := formatCode("k7mp-q29x"); got != "K7MP-Q29X" {
		t.Errorf("formatCode = %q, want K7MP-Q29X", got)
	}
}

func TestEncodeCodeRejectsWrongLength(t *testing.T) {
	if _, err := encodeCode([]byte{1, 2, 3}); err == nil {
		t.Fatal("encodeCode accepted the wrong number of bytes")
	}
}

func TestOfflineResponseRejectsBadInput(t *testing.T) {
	if _, err := OfflineResponse(nil, OfflineBinding{DeviceID: "D1", Challenge: "K7MPQ29X"}); err == nil {
		t.Error("an empty device secret was accepted")
	}
	if _, err := OfflineResponse([]byte("k"), OfflineBinding{DeviceID: "D1", Challenge: "nope"}); err == nil {
		t.Error("an unparseable challenge was accepted")
	}
}

func TestVectorsFileIsWhereTypeScriptExpects(t *testing.T) {
	// The cloud test reaches across the repo for this exact path; moving it
	// silently would leave the two implementations unpinned.
	if _, err := os.Stat(filepath.FromSlash(vectorsPath)); err != nil {
		t.Fatalf("the shared vector file is missing: %v", err)
	}
}

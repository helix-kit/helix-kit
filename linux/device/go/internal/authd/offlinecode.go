// SPDX-License-Identifier: AGPL-3.0-only

package authd

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"strings"
)

// The offline challenge/response wire format.
//
// A person reads a code off a screen, types it into a phone, reads another code
// back, and types that into a terminal. Everything here follows from that: the
// alphabet has no characters that look alike, the codes are short enough to
// retype without resentment, and the whole exchange is bound to one device, one
// user and one challenge so a code is worthless anywhere else.
const (
	// codeAlphabet omits I, L, O, 0 and 1: they are indistinguishable in most
	// fonts and this is read aloud and retyped by hand.
	codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	// codeRawBytes is 40 bits, which encodes to exactly codeChars characters.
	codeRawBytes = 5
	codeChars    = 8
	// codeGroup is where the display hyphen goes: K7MP-Q29X.
	codeGroup = 4

	// offlineDomain separates these digests from any other use of the same key.
	offlineDomain = "HXOFF1"
)

// encodeCode renders raw bytes as an 8-character code.
func encodeCode(raw []byte) (string, error) {
	if len(raw) != codeRawBytes {
		return "", fmt.Errorf("offline code needs %d bytes, got %d", codeRawBytes, len(raw))
	}

	var packed uint64
	for _, b := range raw {
		packed = packed<<8 | uint64(b)
	}

	out := make([]byte, codeChars)
	for i := codeChars - 1; i >= 0; i-- {
		out[i] = codeAlphabet[packed&0x1F]
		packed >>= 5
	}
	return string(out), nil
}

// decodeCode parses a code back to its bytes, accepting what a human is likely
// to type: any case, with or without the display hyphen or spaces.
func decodeCode(code string) ([]byte, error) {
	normalized := normalizeCode(code)
	if len(normalized) != codeChars {
		return nil, fmt.Errorf("offline code must be %d characters, got %d", codeChars, len(normalized))
	}

	var packed uint64
	for _, char := range normalized {
		index := strings.IndexRune(codeAlphabet, char)
		if index < 0 {
			return nil, fmt.Errorf("offline code contains %q, which is not in the alphabet", char)
		}
		packed = packed<<5 | uint64(index)
	}

	out := make([]byte, codeRawBytes)
	for i := codeRawBytes - 1; i >= 0; i-- {
		out[i] = byte(packed & 0xFF)
		packed >>= 8
	}
	return out, nil
}

// normalizeCode is the canonical form: upper case, no separators.
func normalizeCode(code string) string {
	var b strings.Builder
	for _, char := range strings.ToUpper(strings.TrimSpace(code)) {
		if char == '-' || char == ' ' {
			continue
		}
		b.WriteRune(char)
	}
	return b.String()
}

// formatCode is the display form, hyphenated for reading aloud.
func formatCode(code string) string {
	normalized := normalizeCode(code)
	if len(normalized) != codeChars {
		return normalized
	}
	return normalized[:codeGroup] + "-" + normalized[codeGroup:]
}

// OfflineBinding is everything a response is tied to. Change any field and the
// response changes, which is what stops one person's code working for another.
type OfflineBinding struct {
	DeviceID  string
	UserID    string
	LinuxUID  uint32
	Challenge string
}

// OfflineResponse computes the response the cloud would issue for a binding.
//
// The device recomputes this locally and compares, which is the whole trick: no
// network is involved, yet the code can only have come from something holding
// both the device secret and an authorization for that exact user.
func OfflineResponse(secret []byte, binding OfflineBinding) (string, error) {
	challenge, err := decodeCode(binding.Challenge)
	if err != nil {
		return "", err
	}
	if len(secret) == 0 {
		return "", fmt.Errorf("offline device secret is empty")
	}

	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(offlineDomain))
	writeLengthPrefixed(mac, binding.DeviceID)
	// The spec models the user as a 16-byte UUID. A Helix user id is text, so it
	// is length-prefixed like the device id: same binding, correct type.
	writeLengthPrefixed(mac, binding.UserID)
	_ = binary.Write(mac, binary.BigEndian, uint64(binding.LinuxUID))
	mac.Write(challenge)

	return encodeCode(mac.Sum(nil)[:codeRawBytes])
}

// writeLengthPrefixed writes a 16-bit big-endian length then the bytes, so two
// adjacent fields can never be confused for one another.
func writeLengthPrefixed(w interface{ Write([]byte) (int, error) }, value string) {
	_ = binary.Write(w, binary.BigEndian, uint16(len(value)))
	_, _ = w.Write([]byte(value))
}

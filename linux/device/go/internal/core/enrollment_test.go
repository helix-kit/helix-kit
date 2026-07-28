// SPDX-License-Identifier: AGPL-3.0-only

package core

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/helix-kit/helix-device/internal/shared/config"
)

// signCSRForCN issues a short self-signed leaf with the requested CN, standing
// in for step-ca in tests.
func signCSRForCN(t *testing.T, cn string, notAfter time.Time) string {
	t.Helper()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: cn},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     notAfter,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
}

func TestEnrollWritesCertAndKey(t *testing.T) {
	t.Setenv("HELIX_ROOT", t.TempDir())

	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		var body struct {
			CSR string `json:"csr"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.CSR == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{
			"certificate": signCSRForCN(t, "dev-1", time.Now().Add(30*24*time.Hour)),
			"ca":          "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----\n",
		})
	}))
	defer srv.Close()

	tokFile := filepath.Join(t.TempDir(), "token")
	_ = os.WriteFile(tokFile, []byte("hd-secret\n"), 0o600)

	cfg := &config.Config{
		Device:     config.Device{ID: "dev-1"},
		Enrollment: config.Enrollment{APIURL: srv.URL, AccessTokenFile: tokFile},
	}
	e := newEnroller(cfg, quietLog())

	rotated, err := e.ensure()
	if err != nil || !rotated {
		t.Fatalf("ensure rotated=%v err=%v", rotated, err)
	}
	if gotAuth != "Bearer hd-secret" {
		t.Errorf("authorization header = %q", gotAuth)
	}
	if _, statErr := os.Stat(e.keyPath()); statErr != nil {
		t.Errorf("device key not written: %v", statErr)
	}
	leaf, err := loadLeaf(e.certPath())
	if err != nil || leaf.Subject.CommonName != "dev-1" {
		t.Errorf("leaf = %v err=%v", leaf, err)
	}

	// A healthy leaf means the next ensure is a no-op.
	rotated, err = e.ensure()
	if err != nil || rotated {
		t.Errorf("second ensure rotated=%v err=%v (should be no-op)", rotated, err)
	}
}

func TestEnrollRenewsNearExpiry(t *testing.T) {
	t.Setenv("HELIX_ROOT", t.TempDir())
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{
			"certificate": signCSRForCN(t, "dev-1", time.Now().Add(30*24*time.Hour)),
		})
	}))
	defer srv.Close()
	cfg := &config.Config{Device: config.Device{ID: "dev-1"}, Enrollment: config.Enrollment{APIURL: srv.URL}}
	e := newEnroller(cfg, quietLog())

	// Seed a leaf that is within the renewal window.
	nearExpiry := signCSRForCN(t, "dev-1", time.Now().Add(1*time.Hour))
	if err := writePEM(e.certPath(), []byte(nearExpiry), 0o640); err != nil {
		t.Fatal(err)
	}
	rotated, err := e.ensure()
	if err != nil || !rotated {
		t.Errorf("expected renewal near expiry: rotated=%v err=%v", rotated, err)
	}
}

func TestEnrollDisabledWithoutAPIURL(t *testing.T) {
	e := newEnroller(&config.Config{Device: config.Device{ID: "dev-1"}}, quietLog())
	rotated, err := e.ensure()
	if err != nil || rotated {
		t.Errorf("disabled enroller should be a no-op: rotated=%v err=%v", rotated, err)
	}
}

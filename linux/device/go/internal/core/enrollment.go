// SPDX-License-Identifier: AGPL-3.0-only

package core

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/helix-kit/helix-device/internal/shared/config"
)

// renewWindow is how close to expiry a leaf may be before rotation re-enrolls.
const renewWindow = 6 * time.Hour

// enroller does CSR-based cert enrollment/renewal; active only when Enrollment.APIURL is set.
type enroller struct {
	cfg *config.Config
	log *slog.Logger
	hc  *http.Client
}

func newEnroller(cfg *config.Config, log *slog.Logger) *enroller {
	return &enroller{cfg: cfg, log: log, hc: &http.Client{Timeout: 20 * time.Second}}
}

func (e *enroller) enabled() bool { return e.cfg.Enrollment.APIURL != "" }

func (e *enroller) keyPath() string {
	return orPath(e.cfg.MQTT.ClientKey, filepath.Join(config.PKIDir(), "device.key"))
}
func (e *enroller) certPath() string {
	return orPath(e.cfg.MQTT.ClientCert, filepath.Join(config.PKIDir(), "chain.pem"))
}
func (e *enroller) caPath() string {
	return orPath(e.cfg.MQTT.CACert, filepath.Join(config.PKIDir(), "root.pem"))
}

// ensure enrolls if there is no valid leaf yet, returning whether it (re)enrolled.
func (e *enroller) ensure() (rotated bool, err error) {
	if !e.enabled() {
		return false, nil
	}
	if leaf, err := loadLeaf(e.certPath()); err == nil && e.leafHealthy(leaf) {
		return false, nil
	}
	return true, e.enroll()
}

func (e *enroller) leafHealthy(leaf *x509.Certificate) bool {
	now := time.Now()
	if now.Before(leaf.NotBefore) || now.After(leaf.NotAfter) {
		return false
	}
	if leaf.Subject.CommonName != e.cfg.Device.ID {
		return false
	}
	return leaf.NotAfter.Sub(now) > renewWindow
}

func (e *enroller) enroll() error {
	key, err := e.ensureKey()
	if err != nil {
		return err
	}
	csrDER, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{
		Subject: pkix.Name{CommonName: e.cfg.Device.ID},
	}, key)
	if err != nil {
		return fmt.Errorf("create csr: %w", err)
	}
	csrPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csrDER})

	chain, ca, err := e.exchange(csrPEM)
	if err != nil {
		return err
	}
	if err := writePEM(e.certPath(), chain, 0o640); err != nil {
		return err
	}
	if ca != nil {
		if err := writePEM(e.caPath(), ca, 0o640); err != nil {
			return err
		}
	}
	e.log.Info("enrolled device certificate", "device", e.cfg.Device.ID)
	return nil
}

func (e *enroller) ensureKey() (*ecdsa.PrivateKey, error) {
	if data, err := os.ReadFile(e.keyPath()); err == nil {
		block, _ := pem.Decode(data)
		if block != nil {
			if k, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
				return k, nil
			}
			if k, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
				if ec, ok := k.(*ecdsa.PrivateKey); ok {
					return ec, nil
				}
			}
		}
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	der, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, err
	}
	if err := writePEM(e.keyPath(), pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: der}), 0o600); err != nil {
		return nil, err
	}
	return key, nil
}

func (e *enroller) exchange(csrPEM []byte) (chain, ca []byte, err error) {
	token, err := e.accessToken()
	if err != nil {
		return nil, nil, err
	}
	body, _ := json.Marshal(map[string]string{"deviceId": e.cfg.Device.ID, "csr": string(csrPEM)})
	req, err := http.NewRequest(http.MethodPost, e.cfg.Enrollment.APIURL, bytes.NewReader(body))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := e.hc.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("enrollment failed: %s", resp.Status)
	}
	var out struct {
		Certificate string `json:"certificate"`
		CA          string `json:"ca"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, nil, err
	}
	if out.Certificate == "" {
		return nil, nil, fmt.Errorf("enrollment response missing certificate")
	}
	ca = nil
	if out.CA != "" {
		ca = []byte(out.CA)
	}
	return []byte(out.Certificate), ca, nil
}

func (e *enroller) accessToken() (string, error) {
	path := e.cfg.Enrollment.AccessTokenFile
	if path == "" {
		return "", nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read access token: %w", err)
	}
	return string(bytes.TrimSpace(data)), nil
}

func loadLeaf(path string) (*x509.Certificate, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	for {
		var block *pem.Block
		block, data = pem.Decode(data)
		if block == nil {
			return nil, fmt.Errorf("no certificate in %s", path)
		}
		if block.Type == "CERTIFICATE" {
			return x509.ParseCertificate(block.Bytes)
		}
	}
}

func writePEM(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, mode); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func orPath(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

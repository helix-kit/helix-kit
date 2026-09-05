// SPDX-License-Identifier: AGPL-3.0-only

package config

import (
	"testing"
	"time"
)

const testDSN = "postgres://helix:pw@postgres:5432/helix"

func TestLoadDefaults(t *testing.T) {
	t.Setenv("LDAP_BIND_PASSWORD", "secret")
	t.Setenv("DATABASE_URL", testDSN)

	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.ListenAddr != ":3389" {
		t.Errorf("ListenAddr = %q", c.ListenAddr)
	}
	if c.BaseDN != "dc=helix,dc=local" {
		t.Errorf("BaseDN = %q", c.BaseDN)
	}
	if c.SearchLimit != 1000 {
		t.Errorf("SearchLimit = %d, want 1000", c.SearchLimit)
	}
	if c.LoginShell != "/usr/libexec/helix/session-launcher" {
		t.Errorf("LoginShell = %q", c.LoginShell)
	}
	if c.DBTimeout != 5*time.Second {
		t.Errorf("DBTimeout = %s", c.DBTimeout)
	}
}

// Secrets must come from the environment; there is no built-in fallback to fall
// back to when one is missing.
func TestLoadRequiresSecrets(t *testing.T) {
	t.Run("bind password", func(t *testing.T) {
		t.Setenv("DATABASE_URL", testDSN)
		t.Setenv("LDAP_BIND_PASSWORD", "")
		if _, err := Load(); err == nil {
			t.Fatal("Load succeeded with no bind password")
		}
	})

	t.Run("database url", func(t *testing.T) {
		t.Setenv("LDAP_BIND_PASSWORD", "secret")
		t.Setenv("DATABASE_URL", "")
		if _, err := Load(); err == nil {
			t.Fatal("Load succeeded with no database url")
		}
	})
}

func TestLoadRejectsBadValues(t *testing.T) {
	cases := map[string][2]string{
		"search limit is not a number": {"LDAP_SEARCH_LIMIT", "many"},
		"search limit is zero":         {"LDAP_SEARCH_LIMIT", "0"},
		"search limit is negative":     {"LDAP_SEARCH_LIMIT", "-1"},
		"timeout is not a duration":    {"DB_QUERY_TIMEOUT", "soon"},
		"login shell is relative":      {"HELIX_LOGIN_SHELL", "bash"},
	}
	for name, kv := range cases {
		t.Run(name, func(t *testing.T) {
			t.Setenv("LDAP_BIND_PASSWORD", "secret")
			t.Setenv("DATABASE_URL", testDSN)
			t.Setenv(kv[0], kv[1])
			if _, err := Load(); err == nil {
				t.Fatalf("Load succeeded with %s=%q", kv[0], kv[1])
			}
		})
	}
}

func TestLoadOverrides(t *testing.T) {
	t.Setenv("LDAP_BIND_PASSWORD", "secret")
	t.Setenv("DATABASE_URL", testDSN)
	t.Setenv("LDAP_LISTEN_ADDR", ":1389")
	t.Setenv("LDAP_SEARCH_LIMIT", "50")
	t.Setenv("DB_QUERY_TIMEOUT", "250ms")
	t.Setenv("HELIX_HOME_ROOT", "/srv/home")

	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.ListenAddr != ":1389" || c.SearchLimit != 50 || c.DBTimeout != 250*time.Millisecond || c.HomeRoot != "/srv/home" {
		t.Fatalf("overrides not applied: %+v", c)
	}
}

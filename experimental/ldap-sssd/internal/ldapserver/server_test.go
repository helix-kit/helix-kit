// SPDX-License-Identifier: AGPL-3.0-only

package ldapserver_test

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"sort"
	"testing"
	"time"

	goldap "github.com/go-ldap/ldap/v3"
	"github.com/google/uuid"
	ldapd "github.com/vjeantet/ldapserver"

	"github.com/helix-kit/experimental-ldap/internal/identity"
	"github.com/helix-kit/experimental-ldap/internal/ldapserver"
	"github.com/helix-kit/experimental-ldap/internal/store/memstore"
)

const (
	baseDN   = "dc=helix,dc=local"
	peopleDN = "ou=People,dc=helix,dc=local"
	groupsDN = "ou=Groups,dc=helix,dc=local"
	bindDN   = "cn=sssd,dc=helix,dc=local"
	bindPW   = "test-only-password"
	shell    = "/usr/libexec/helix/session-launcher"
)

func user(name, email string, uid uint32, id byte) identity.UnixUser {
	return identity.UnixUser{
		UUID:     uuid.UUID{15: id},
		Email:    email,
		Username: name,
		UID:      uid,
	}
}

var (
	alice = user("alice", "alice@example.com", 200001, 1)
	bob   = user("bob", "bob@example.com", 200002, 2)
)

// newTestServer starts the facade on a random port with an in-memory store, so
// the protocol surface is exercised by a real client without PostgreSQL.
func newTestServer(t *testing.T, users ...identity.UnixUser) (*memstore.Store, string) {
	t.Helper()
	ldapd.Logger = ldapd.DiscardingLogger

	st := memstore.New(users...)
	srv := ldapserver.New(st, ldapserver.Options{
		Directory:    identity.NewDirectory(baseDN, "/home", shell),
		BindDN:       bindDN,
		BindPassword: bindPW,
		SearchLimit:  1000,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 5 * time.Second,
		Logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := lis.Addr().String()

	done := make(chan error, 1)
	go func() { done <- srv.Serve(lis) }()
	select {
	case <-srv.Started():
	case err := <-done:
		t.Fatalf("server exited early: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("server did not start")
	}
	t.Cleanup(srv.Stop)

	return st, addr
}

func dial(t *testing.T, addr string) *goldap.Conn {
	t.Helper()
	c, err := goldap.DialURL("ldap://" + addr)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	c.SetTimeout(10 * time.Second)
	t.Cleanup(func() { c.Close() })
	return c
}

func dialBound(t *testing.T, addr string) *goldap.Conn {
	t.Helper()
	c := dial(t, addr)
	if err := c.Bind(bindDN, bindPW); err != nil {
		t.Fatalf("bind: %v", err)
	}
	return c
}

func search(t *testing.T, c *goldap.Conn, base string, scope int, filter string, attrs ...string) *goldap.SearchResult {
	t.Helper()
	res, err := c.Search(goldap.NewSearchRequest(base, scope, goldap.NeverDerefAliases, 0, 0, false, filter, attrs, nil))
	if err != nil {
		t.Fatalf("search %s %s: %v", base, filter, err)
	}
	return res
}

func TestBind(t *testing.T) {
	_, addr := newTestServer(t, alice, bob)

	t.Run("service account succeeds", func(t *testing.T) {
		if err := dial(t, addr).Bind(bindDN, bindPW); err != nil {
			t.Fatalf("bind: %v", err)
		}
	})

	t.Run("wrong password fails", func(t *testing.T) {
		err := dial(t, addr).Bind(bindDN, "wrong-password")
		assertLDAPError(t, err, goldap.LDAPResultInvalidCredentials)
	})

	t.Run("unknown bind dn fails", func(t *testing.T) {
		err := dial(t, addr).Bind("cn=intruder,dc=helix,dc=local", bindPW)
		assertLDAPError(t, err, goldap.LDAPResultInvalidCredentials)
	})

	t.Run("a helix user cannot bind", func(t *testing.T) {
		// Users have no credential here at all: authentication is out of scope.
		err := dial(t, addr).Bind("uid=alice,"+peopleDN, bindPW)
		assertLDAPError(t, err, goldap.LDAPResultInvalidCredentials)
	})

	t.Run("bind dn is case-insensitive", func(t *testing.T) {
		if err := dial(t, addr).Bind("CN=SSSD,DC=Helix,DC=Local", bindPW); err != nil {
			t.Fatalf("bind: %v", err)
		}
	})

	t.Run("anonymous bind succeeds but grants nothing", func(t *testing.T) {
		c := dial(t, addr)
		if err := c.UnauthenticatedBind(""); err != nil {
			t.Fatalf("anonymous bind: %v", err)
		}
		_, err := c.Search(goldap.NewSearchRequest(peopleDN, goldap.ScopeWholeSubtree,
			goldap.NeverDerefAliases, 0, 0, false, "(objectClass=posixAccount)", nil, nil))
		assertLDAPError(t, err, goldap.LDAPResultInsufficientAccessRights)
	})
}

func TestRootDSEIsAnonymouslyReadable(t *testing.T) {
	_, addr := newTestServer(t, alice)

	res := search(t, dial(t, addr), "", goldap.ScopeBaseObject, "(objectClass=*)")
	if len(res.Entries) != 1 {
		t.Fatalf("got %d entries, want 1", len(res.Entries))
	}
	e := res.Entries[0]
	if got := e.GetAttributeValue("namingContexts"); got != baseDN {
		t.Errorf("namingContexts = %q, want %q", got, baseDN)
	}
	if got := e.GetAttributeValue("supportedLDAPVersion"); got != "3" {
		t.Errorf("supportedLDAPVersion = %q, want 3", got)
	}
	// Nothing unimplemented may be advertised.
	for _, attr := range []string{"supportedSASLMechanisms", "supportedExtension", "supportedControl"} {
		if v := e.GetAttributeValues(attr); len(v) != 0 {
			t.Errorf("root DSE advertises %s = %v, but none is implemented", attr, v)
		}
	}
}

func TestUserSearch(t *testing.T) {
	_, addr := newTestServer(t, alice, bob)
	c := dialBound(t, addr)

	// The compound forms SSSD actually generates, plus the plain ones.
	for _, filter := range []string{
		"(uid=alice)",
		"(&(objectClass=posixAccount)(uid=alice))",
		"(&(objectclass=posixAccount)(uid=alice))",
		"(uidNumber=200001)",
		"(&(objectClass=posixAccount)(uidNumber=200001))",
	} {
		t.Run(filter, func(t *testing.T) {
			res := search(t, c, peopleDN, goldap.ScopeWholeSubtree, filter)
			if len(res.Entries) != 1 {
				t.Fatalf("got %d entries, want 1", len(res.Entries))
			}
			assertAliceEntry(t, res.Entries[0])
		})
	}

	t.Run("(objectClass=posixAccount) returns every user", func(t *testing.T) {
		res := search(t, c, peopleDN, goldap.ScopeWholeSubtree, "(objectClass=posixAccount)")
		if got := dnsOf(res); len(got) != 2 {
			t.Fatalf("got %v, want both users", got)
		}
	})

	t.Run("search by base DN", func(t *testing.T) {
		res := search(t, c, "uid=alice,"+peopleDN, goldap.ScopeBaseObject, "(objectClass=*)")
		if len(res.Entries) != 1 {
			t.Fatalf("got %d entries, want 1", len(res.Entries))
		}
		assertAliceEntry(t, res.Entries[0])
	})

	t.Run("requested attributes are honoured", func(t *testing.T) {
		res := search(t, c, peopleDN, goldap.ScopeWholeSubtree, "(uid=alice)", "uidNumber", "gidNumber")
		e := res.Entries[0]
		if len(e.Attributes) != 2 {
			t.Fatalf("got attributes %v, want only the two requested", attrNames(e))
		}
		if e.GetAttributeValue("uidNumber") != "200001" {
			t.Errorf("uidNumber = %q", e.GetAttributeValue("uidNumber"))
		}
	})

	t.Run("no password attribute is ever returned", func(t *testing.T) {
		res := search(t, c, peopleDN, goldap.ScopeWholeSubtree, "(uid=alice)", "*", "userPassword")
		if v := res.Entries[0].GetAttributeValues("userPassword"); len(v) != 0 {
			t.Fatalf("userPassword = %v, want none", v)
		}
	})
}

func TestUnknownIdentitiesReturnNothing(t *testing.T) {
	_, addr := newTestServer(t, alice, bob)
	c := dialBound(t, addr)

	cases := []struct{ base, filter string }{
		{peopleDN, "(uid=does-not-exist)"},
		{peopleDN, "(uidNumber=999999)"},
		{groupsDN, "(cn=does-not-exist)"},
		{groupsDN, "(gidNumber=999999)"},
		{peopleDN, "(uid=Invalid Name!)"},
	}
	for _, tc := range cases {
		t.Run(tc.filter, func(t *testing.T) {
			res := search(t, c, tc.base, goldap.ScopeWholeSubtree, tc.filter)
			if len(res.Entries) != 0 {
				t.Fatalf("got %d entries, want 0", len(res.Entries))
			}
		})
	}

	t.Run("unknown naming context", func(t *testing.T) {
		_, err := c.Search(goldap.NewSearchRequest("ou=Nope,dc=helix,dc=local", goldap.ScopeWholeSubtree,
			goldap.NeverDerefAliases, 0, 0, false, "(objectClass=*)", nil, nil))
		assertLDAPError(t, err, goldap.LDAPResultNoSuchObject)
	})
}

func TestGroupSearchSynthesizesPrivateGroups(t *testing.T) {
	_, addr := newTestServer(t, alice, bob)
	c := dialBound(t, addr)

	for _, filter := range []string{
		"(cn=alice)",
		"(&(objectClass=posixGroup)(cn=alice))",
		"(gidNumber=200001)",
		"(&(objectClass=posixGroup)(gidNumber=200001))",
	} {
		t.Run(filter, func(t *testing.T) {
			res := search(t, c, groupsDN, goldap.ScopeWholeSubtree, filter)
			if len(res.Entries) != 1 {
				t.Fatalf("got %d entries, want 1", len(res.Entries))
			}
			e := res.Entries[0]
			if e.DN != "cn=alice,"+groupsDN {
				t.Errorf("DN = %q", e.DN)
			}
			if e.GetAttributeValue("gidNumber") != "200001" {
				t.Errorf("gidNumber = %q, want 200001", e.GetAttributeValue("gidNumber"))
			}
			if v := e.GetAttributeValues("memberUid"); len(v) != 0 {
				t.Errorf("memberUid = %v, want none", v)
			}
		})
	}

	t.Run("(objectClass=posixGroup) returns one group per user", func(t *testing.T) {
		res := search(t, c, groupsDN, goldap.ScopeWholeSubtree, "(objectClass=posixGroup)")
		want := []string{"cn=alice," + groupsDN, "cn=bob," + groupsDN}
		if got := dnsOf(res); !equalStrings(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})
}

func TestSubtreeSearchFromBaseDN(t *testing.T) {
	_, addr := newTestServer(t, alice, bob)
	c := dialBound(t, addr)

	res := search(t, c, baseDN, goldap.ScopeWholeSubtree, "(objectClass=*)")
	want := []string{
		"cn=alice," + groupsDN,
		"cn=bob," + groupsDN,
		baseDN,
		groupsDN,
		peopleDN,
		"uid=alice," + peopleDN,
		"uid=bob," + peopleDN,
	}
	sort.Strings(want)
	if got := dnsOf(res); !equalStrings(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

// The store is the only source of truth: a change there is visible immediately,
// with no LDAP-side copy to synchronize or restart.
func TestDirectoryFollowsTheStore(t *testing.T) {
	st, addr := newTestServer(t, alice)
	c := dialBound(t, addr)

	if n := len(search(t, c, peopleDN, goldap.ScopeWholeSubtree, "(uid=charlie)").Entries); n != 0 {
		t.Fatalf("charlie resolved before insert")
	}

	st.Put(user("charlie", "charlie@example.com", 200003, 3))
	res := search(t, c, peopleDN, goldap.ScopeWholeSubtree, "(uid=charlie)")
	if len(res.Entries) != 1 {
		t.Fatalf("charlie did not resolve after insert")
	}
	if got := res.Entries[0].GetAttributeValue("uidNumber"); got != "200003" {
		t.Errorf("uidNumber = %q, want 200003", got)
	}

	st.Delete("charlie")
	if n := len(search(t, c, peopleDN, goldap.ScopeWholeSubtree, "(uid=charlie)").Entries); n != 0 {
		t.Fatalf("charlie still resolved after delete")
	}
}

func TestWriteOperationsAreRefused(t *testing.T) {
	_, addr := newTestServer(t, alice)
	c := dialBound(t, addr)
	dn := "uid=alice," + peopleDN

	t.Run("add", func(t *testing.T) {
		add := goldap.NewAddRequest("uid=mallory,"+peopleDN, nil)
		add.Attribute("objectClass", []string{"posixAccount"})
		add.Attribute("uid", []string{"mallory"})
		assertLDAPError(t, c.Add(add), goldap.LDAPResultUnwillingToPerform)
	})

	t.Run("modify", func(t *testing.T) {
		mod := goldap.NewModifyRequest(dn, nil)
		mod.Replace("loginShell", []string{"/bin/bash"})
		assertLDAPError(t, c.Modify(mod), goldap.LDAPResultUnwillingToPerform)
	})

	t.Run("delete", func(t *testing.T) {
		assertLDAPError(t, c.Del(goldap.NewDelRequest(dn, nil)), goldap.LDAPResultUnwillingToPerform)
	})

	t.Run("modifyDN", func(t *testing.T) {
		assertLDAPError(t, c.ModifyDN(goldap.NewModifyDNRequest(dn, "uid=mallory", true, "")),
			goldap.LDAPResultUnwillingToPerform)
	})

	t.Run("password modify", func(t *testing.T) {
		_, err := c.PasswordModify(goldap.NewPasswordModifyRequest(dn, "", "new-password"))
		assertLDAPError(t, err, goldap.LDAPResultUnwillingToPerform)
	})

	// Refusing writes must not disturb the connection.
	if n := len(search(t, c, peopleDN, goldap.ScopeWholeSubtree, "(uid=alice)").Entries); n != 1 {
		t.Fatal("connection unusable after refused writes")
	}
	if n := len(search(t, c, peopleDN, goldap.ScopeWholeSubtree, "(uid=mallory)").Entries); n != 0 {
		t.Fatal("a refused Add created an entry")
	}
}

func TestUnsupportedFilterIsRefusedNotCrashed(t *testing.T) {
	_, addr := newTestServer(t, alice)
	c := dialBound(t, addr)

	_, err := c.Search(goldap.NewSearchRequest(peopleDN, goldap.ScopeWholeSubtree,
		goldap.NeverDerefAliases, 0, 0, false, "(uid=al*)", nil, nil))
	assertLDAPError(t, err, goldap.LDAPResultUnwillingToPerform)

	// The server survives and keeps serving on the same connection.
	if n := len(search(t, c, peopleDN, goldap.ScopeWholeSubtree, "(uid=alice)").Entries); n != 1 {
		t.Fatal("server stopped serving after an unsupported filter")
	}
}

func TestSearchIsBounded(t *testing.T) {
	users := make([]identity.UnixUser, 0, 20)
	for i := 0; i < 20; i++ {
		users = append(users, user(fmt.Sprintf("user%02d", i), fmt.Sprintf("user%02d@example.com", i), uint32(200100+i), byte(i)))
	}
	_, addr := newTestServer(t, users...)
	c := dialBound(t, addr)

	res, err := c.Search(goldap.NewSearchRequest(peopleDN, goldap.ScopeWholeSubtree,
		goldap.NeverDerefAliases, 5, 0, false, "(objectClass=posixAccount)", nil, nil))
	if err != nil {
		assertLDAPError(t, err, goldap.LDAPResultSizeLimitExceeded)
		return
	}
	if len(res.Entries) > 5 {
		t.Fatalf("got %d entries, want the client size limit of 5 respected", len(res.Entries))
	}
}

func TestBackendFailureIsReportedNotCrashed(t *testing.T) {
	st, addr := newTestServer(t, alice)
	c := dialBound(t, addr)

	st.Err = errors.New("database is down")
	_, err := c.Search(goldap.NewSearchRequest(peopleDN, goldap.ScopeWholeSubtree,
		goldap.NeverDerefAliases, 0, 0, false, "(uid=alice)", nil, nil))
	assertLDAPError(t, err, goldap.LDAPResultOperationsError)

	st.Err = nil
	if n := len(search(t, c, peopleDN, goldap.ScopeWholeSubtree, "(uid=alice)").Entries); n != 1 {
		t.Fatal("server did not recover once the backend returned")
	}
}

func assertAliceEntry(t *testing.T, e *goldap.Entry) {
	t.Helper()
	if e.DN != "uid=alice,"+peopleDN {
		t.Errorf("DN = %q, want uid=alice,%s", e.DN, peopleDN)
	}
	want := map[string]string{
		"uid":           "alice",
		"cn":            "alice",
		"sn":            "alice",
		"mail":          "alice@example.com",
		"uidNumber":     "200001",
		"gidNumber":     "200001",
		"homeDirectory": "/home/alice",
		"loginShell":    shell,
	}
	for attr, value := range want {
		if got := e.GetAttributeValue(attr); got != value {
			t.Errorf("%s = %q, want %q", attr, got, value)
		}
	}
	if !hasValue(e.GetAttributeValues("objectClass"), "posixAccount") {
		t.Errorf("objectClass = %v, want posixAccount", e.GetAttributeValues("objectClass"))
	}
}

func assertLDAPError(t *testing.T, err error, code uint16) {
	t.Helper()
	if err == nil {
		t.Fatalf("got nil error, want LDAP result %d (%s)", code, goldap.LDAPResultCodeMap[code])
	}
	if !goldap.IsErrorWithCode(err, code) {
		t.Fatalf("got %v, want LDAP result %d (%s)", err, code, goldap.LDAPResultCodeMap[code])
	}
}

func dnsOf(res *goldap.SearchResult) []string {
	out := make([]string, 0, len(res.Entries))
	for _, e := range res.Entries {
		out = append(out, e.DN)
	}
	sort.Strings(out)
	return out
}

func attrNames(e *goldap.Entry) []string {
	out := make([]string, 0, len(e.Attributes))
	for _, a := range e.Attributes {
		out = append(out, a.Name)
	}
	return out
}

func hasValue(values []string, want string) bool {
	for _, v := range values {
		if v == want {
			return true
		}
	}
	return false
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// SPDX-License-Identifier: AGPL-3.0-only

package ldapserver

import (
	"errors"
	"testing"

	ber "github.com/go-asn1-ber/asn1-ber"
	goldap "github.com/go-ldap/ldap/v3"
	message "github.com/lor00x/goldap/message"

	"github.com/helix-kit/experimental-ldap/internal/identity"
)

var (
	dir       = identity.NewDirectory("dc=helix,dc=local", "/home", "/usr/libexec/helix/session-launcher")
	aliceUser = identity.UnixUser{Email: "alice@example.com", Username: "alice", UID: 200001}
)

// parseFilter builds a filter the only way the server ever gets one: by decoding
// an encoded SearchRequest off the wire. goldap exposes no constructors for
// FilterEqualityMatch, and testing against hand-built structs would not exercise
// the decoder the real path depends on anyway.
func parseFilter(t *testing.T, filter string) message.Filter {
	t.Helper()

	compiled, err := goldap.CompileFilter(filter)
	if err != nil {
		t.Fatalf("compile filter %q: %v", filter, err)
	}

	envelope := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "LDAP Request")
	envelope.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagInteger, int64(1), "MessageID"))

	req := ber.Encode(ber.ClassApplication, ber.TypeConstructed, goldap.ApplicationSearchRequest, nil, "Search Request")
	req.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, "dc=helix,dc=local", "Base DN"))
	req.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagEnumerated, uint64(goldap.ScopeWholeSubtree), "Scope"))
	req.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagEnumerated, uint64(goldap.NeverDerefAliases), "Deref Aliases"))
	req.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagInteger, int64(0), "Size Limit"))
	req.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagInteger, int64(0), "Time Limit"))
	req.AppendChild(ber.NewBoolean(ber.ClassUniversal, ber.TypePrimitive, ber.TagBoolean, false, "Types Only"))
	req.AppendChild(compiled)
	req.AppendChild(ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "Attributes"))
	envelope.AppendChild(req)

	decoded, err := message.ReadLDAPMessage(message.NewBytes(0, envelope.Bytes()))
	if err != nil {
		t.Fatalf("decode filter %q: %v", filter, err)
	}
	search, ok := decoded.ProtocolOp().(message.SearchRequest)
	if !ok {
		t.Fatalf("decoded %T, want SearchRequest", decoded.ProtocolOp())
	}
	return search.Filter()
}

func TestMatchFilterEquality(t *testing.T) {
	e := dir.UserEntry(aliceUser)

	cases := []struct {
		filter string
		want   bool
	}{
		{"(uid=alice)", true},
		{"(uid=bob)", false},
		{"(uid=ALICE)", false}, // usernames are case-sensitive, like Unix
		{"(uidNumber=200001)", true},
		{"(uidNumber=0200001)", true}, // numeric comparison, not string
		{"(uidNumber=200002)", false},
		{"(gidNumber=200001)", true}, // private primary group follows the uid
		{"(objectclass=POSIXACCOUNT)", true},
		{"(objectClass=posixGroup)", false},
		{"(mail=Alice@Example.com)", true},
		{"(homeDirectory=/home/alice)", true},
		{"(loginShell=/usr/libexec/helix/session-launcher)", true},
		{"(nosuchattr=x)", false},
		{"(objectClass=*)", true},
		{"(uidNumber=*)", true},
		{"(userPassword=*)", false}, // no credential is ever projected
	}
	for _, tc := range cases {
		t.Run(tc.filter, func(t *testing.T) {
			got, err := matchFilter(parseFilter(t, tc.filter), e)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("matchFilter(%s) = %v, want %v", tc.filter, got, tc.want)
			}
		})
	}
}

func TestMatchFilterBoolean(t *testing.T) {
	e := dir.UserEntry(aliceUser)

	cases := []struct {
		filter string
		want   bool
	}{
		{"(&(objectClass=posixAccount)(uid=alice))", true},
		{"(&(objectClass=posixAccount)(uid=bob))", false},
		{"(|(uid=bob)(uid=alice))", true},
		{"(|(uid=bob)(uid=carol))", false},
		{"(!(uid=bob))", true},
		{"(!(uid=alice))", false},
		{"(&(objectClass=*)(!(|(uid=bob)(uid=carol))))", true},
		{"(&(objectClass=posixAccount)(uidNumber=200001)(mail=alice@example.com))", true},
	}
	for _, tc := range cases {
		t.Run(tc.filter, func(t *testing.T) {
			got, err := matchFilter(parseFilter(t, tc.filter), e)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("matchFilter(%s) = %v, want %v", tc.filter, got, tc.want)
			}
		})
	}
}

// Empty AND/OR are the RFC 4526 absolute-true and absolute-false filters.
func TestMatchFilterAbsolute(t *testing.T) {
	e := dir.UserEntry(aliceUser)

	got, err := matchFilter(message.FilterAnd{}, e)
	if err != nil || !got {
		t.Errorf("empty AND = (%v, %v), want (true, nil)", got, err)
	}
	got, err = matchFilter(message.FilterOr{}, e)
	if err != nil || got {
		t.Errorf("empty OR = (%v, %v), want (false, nil)", got, err)
	}
}

func TestMatchFilterUnsupportedIsDeterministic(t *testing.T) {
	e := dir.UserEntry(aliceUser)

	unsupported := []string{
		"(uid=al*)",              // substrings
		"(uidNumber>=200001)",    // ordering
		"(uidNumber<=200001)",    // ordering
		"(uid~=alice)",           // approximate
		"(&(uid=alice)(cn=al*))", // unsupported element nested under a match
	}
	for _, f := range unsupported {
		if _, err := matchFilter(parseFilter(t, f), e); !errors.Is(err, errUnsupportedFilter) {
			t.Errorf("matchFilter(%s) error = %v, want errUnsupportedFilter", f, err)
		}
	}
}

func TestPlanLookupPushesDownSelectivePredicates(t *testing.T) {
	cases := []struct {
		filter string
		kind   entryKind
		want   lookup
	}{
		{"(uid=alice)", kindUser, lookup{kind: lookupUsername, username: "alice"}},
		{"(uidNumber=200001)", kindUser, lookup{kind: lookupUID, uid: 200001}},
		{"(&(objectClass=posixAccount)(uid=alice))", kindUser, lookup{kind: lookupUsername, username: "alice"}},
		{"(&(objectClass=posixAccount)(uidNumber=200001))", kindUser, lookup{kind: lookupUID, uid: 200001}},
		{"(cn=alice)", kindGroup, lookup{kind: lookupUsername, username: "alice"}},
		{"(gidNumber=200001)", kindGroup, lookup{kind: lookupUID, uid: 200001}},
		{"(&(objectClass=posixGroup)(gidNumber=200001))", kindGroup, lookup{kind: lookupUID, uid: 200001}},
		{"(objectClass=posixAccount)", kindUser, lookup{kind: lookupAll}},
		{"(objectClass=*)", kindUser, lookup{kind: lookupAll}},
		{"(uidNumber=notanumber)", kindUser, lookup{kind: lookupAll}},
		{"(uid=alice)", kindGroup, lookup{kind: lookupAll}}, // uid does not key a group
	}
	for _, tc := range cases {
		t.Run(tc.filter, func(t *testing.T) {
			if got := planLookup(parseFilter(t, tc.filter), tc.kind); got != tc.want {
				t.Fatalf("planLookup(%s) = %+v, want %+v", tc.filter, got, tc.want)
			}
		})
	}
}

// A predicate under OR or NOT is not required by the filter, so pushing it into
// SQL could drop a row that actually matches. Those must enumerate instead.
func TestPlanLookupDoesNotPushDownOptionalPredicates(t *testing.T) {
	for _, filter := range []string{
		"(|(uid=alice)(uid=bob))",
		"(!(uid=alice))",
		"(&(|(uid=alice)(uid=bob)))",
	} {
		t.Run(filter, func(t *testing.T) {
			if got := planLookup(parseFilter(t, filter), kindUser); got.kind != lookupAll {
				t.Fatalf("planLookup(%s) = %+v, want bounded enumeration", filter, got)
			}
		})
	}
}

func TestNormalizeDN(t *testing.T) {
	cases := map[string]string{
		"UID=Alice, OU=People,DC=Helix,DC=Local": "uid=alice,ou=people,dc=helix,dc=local",
		"dc=helix,dc=local":                      "dc=helix,dc=local",
		"  ou=Groups , dc=helix , dc=local ":     "ou=groups,dc=helix,dc=local",
		"":                                       "",
	}
	for in, want := range cases {
		if got := normalizeDN(in); got != want {
			t.Errorf("normalizeDN(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestLeafRDN(t *testing.T) {
	const people = "ou=people,dc=helix,dc=local"

	if name, ok := leafRDN("uid=alice,"+people, "uid=", people); !ok || name != "alice" {
		t.Errorf("leafRDN = (%q, %v), want (alice, true)", name, ok)
	}
	for _, dn := range []string{people, "cn=alice," + people, "uid=," + people, "uid=alice,ou=other,dc=helix,dc=local"} {
		if name, ok := leafRDN(dn, "uid=", people); ok {
			t.Errorf("leafRDN(%q) = (%q, true), want false", dn, name)
		}
	}
}

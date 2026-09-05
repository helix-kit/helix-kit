// SPDX-License-Identifier: AGPL-3.0-only

package ldapserver

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	message "github.com/lor00x/goldap/message"

	"github.com/helix-kit/experimental-ldap/internal/identity"
)

// errUnsupportedFilter is returned for filter elements this façade deliberately
// does not implement (substrings, ordering, approx, extensible match). Callers
// turn it into a deterministic LDAP error instead of a silent empty result.
var errUnsupportedFilter = errors.New("unsupported filter element")

// numericAttrs are compared as integers, so 0200001 does not match 200001.
var numericAttrs = map[string]bool{"uidnumber": true, "gidnumber": true}

// caseInsensitiveAttrs use caseIgnoreMatch. uid and cn are left case-sensitive
// on purpose: usernames are lowercase by construction, and `getent passwd ALICE`
// must not resolve alice.
var caseInsensitiveAttrs = map[string]bool{"objectclass": true, "mail": true}

// matchFilter evaluates f against a projected entry.
func matchFilter(f message.Filter, e identity.Entry) (bool, error) {
	switch v := f.(type) {
	case message.FilterAnd:
		// An empty AND is the LDAP "absolute true" filter.
		for _, child := range v {
			ok, err := matchFilter(child, e)
			if err != nil || !ok {
				return false, err
			}
		}
		return true, nil

	case message.FilterOr:
		for _, child := range v {
			ok, err := matchFilter(child, e)
			if err != nil {
				return false, err
			}
			if ok {
				return true, nil
			}
		}
		return false, nil

	case message.FilterNot:
		ok, err := matchFilter(v.Filter, e)
		if err != nil {
			return false, err
		}
		return !ok, nil

	case message.FilterPresent:
		return e.Has(string(v)), nil

	case message.FilterEqualityMatch:
		attr := string(v.AttributeDesc())
		want := string(v.AssertionValue())
		return equalityMatches(attr, want, e), nil

	default:
		return false, fmt.Errorf("%w: %T", errUnsupportedFilter, f)
	}
}

func equalityMatches(attr, want string, e identity.Entry) bool {
	key := strings.ToLower(attr)
	values := e.Get(attr)
	if values == nil {
		// An attribute the entry does not carry is undefined: no match, no error.
		return false
	}
	for _, have := range values {
		switch {
		case numericAttrs[key]:
			a, errA := strconv.ParseUint(have, 10, 32)
			b, errB := strconv.ParseUint(want, 10, 32)
			if errA == nil && errB == nil && a == b {
				return true
			}
		case caseInsensitiveAttrs[key]:
			if strings.EqualFold(have, want) {
				return true
			}
		default:
			if have == want {
				return true
			}
		}
	}
	return false
}

// lookupKind says how the candidate set should be fetched from PostgreSQL.
type lookupKind int

const (
	lookupAll      lookupKind = iota // bounded enumeration
	lookupUsername                   // WHERE username = $1
	lookupUID                        // WHERE linux_uid = $1
)

// lookup is a plan for turning an LDAP filter into at most one indexed query.
type lookup struct {
	kind     lookupKind
	username string
	uid      uint32
}

// entryKind selects which attribute names identify a row for pushdown: users are
// keyed by uid/uidNumber, their private groups by cn/gidNumber.
type entryKind int

const (
	kindUser entryKind = iota
	kindGroup
)

// planLookup finds a selective equality predicate that can be pushed into SQL.
//
// Only predicates that are unconditionally required by the filter are used —
// the filter itself, or a direct child of a top-level AND. Anything under an OR
// or a NOT may be optional, so pushing it down could drop a matching entry;
// those fall back to bounded enumeration. Every candidate is re-checked against
// the full filter afterwards, so pushdown can never widen a result set either.
func planLookup(f message.Filter, kind entryKind) lookup {
	if l, ok := selectorFrom(f, kind); ok {
		return l
	}
	if and, ok := f.(message.FilterAnd); ok {
		for _, child := range and {
			if l, ok := selectorFrom(child, kind); ok {
				return l
			}
		}
	}
	return lookup{kind: lookupAll}
}

func selectorFrom(f message.Filter, kind entryKind) (lookup, bool) {
	eq, ok := f.(message.FilterEqualityMatch)
	if !ok {
		return lookup{}, false
	}
	attr := strings.ToLower(string(eq.AttributeDesc()))
	val := string(eq.AssertionValue())

	nameAttr, numAttr := "uid", "uidnumber"
	if kind == kindGroup {
		nameAttr, numAttr = "cn", "gidnumber"
	}

	switch attr {
	case nameAttr:
		return lookup{kind: lookupUsername, username: val}, true
	case numAttr:
		n, err := strconv.ParseUint(val, 10, 32)
		if err != nil {
			return lookup{}, false
		}
		return lookup{kind: lookupUID, uid: uint32(n)}, true
	}
	return lookup{}, false
}

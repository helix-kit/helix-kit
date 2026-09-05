// SPDX-License-Identifier: AGPL-3.0-only

package ldapserver

import (
	"strings"

	message "github.com/lor00x/goldap/message"
	ldapd "github.com/vjeantet/ldapserver"

	"github.com/helix-kit/experimental-ldap/internal/identity"
)

// attrSelection is the client's requested attribute list.
type attrSelection struct {
	all   bool
	none  bool
	names map[string]bool
}

// attributeSelection reads the requested attribute list, honouring the RFC 4511
// specials: empty or "*" means all user attributes, "1.1" means none.
func attributeSelection(r message.SearchRequest) attrSelection {
	requested := r.Attributes()
	if len(requested) == 0 {
		return attrSelection{all: true}
	}
	sel := attrSelection{names: make(map[string]bool, len(requested))}
	for _, a := range requested {
		switch name := strings.ToLower(string(a)); name {
		case "*":
			sel.all = true
		case "1.1":
			sel.none = true
		default:
			sel.names[name] = true
		}
	}
	if !sel.all && !sel.none && len(sel.names) == 0 {
		sel.all = true
	}
	return sel
}

func (s attrSelection) wants(attr string) bool {
	if s.none {
		return false
	}
	if s.all {
		return true
	}
	return s.names[strings.ToLower(attr)]
}

// toSearchResultEntry renders a projected entry onto the wire.
func toSearchResultEntry(e identity.Entry, sel attrSelection) message.SearchResultEntry {
	out := ldapd.NewSearchResultEntry(e.DN)
	for _, a := range e.Attrs {
		if !sel.wants(a.Name) {
			continue
		}
		values := make([]message.AttributeValue, 0, len(a.Values))
		for _, v := range a.Values {
			values = append(values, message.AttributeValue(v))
		}
		out.AddAttribute(message.AttributeDescription(a.Name), values...)
	}
	return out
}

// result builds an LDAP result. Upstream hangs SetDiagnosticMessage on LDAPResult
// alone, so every result-shaped response type is converted from one.
func result(code int, diagnostic string) message.LDAPResult {
	res := ldapd.NewResponse(code)
	if diagnostic != "" {
		res.SetDiagnosticMessage(diagnostic)
	}
	return res
}

func searchDone(code int, diagnostic string) message.SearchResultDone {
	return message.SearchResultDone(result(code, diagnostic))
}

// normalizeDN lowercases a DN and strips whitespace around its separators so
// "UID=Alice, OU=People,DC=Helix,DC=Local" compares equal to the canonical form.
func normalizeDN(dn string) string {
	parts := strings.Split(dn, ",")
	for i, p := range parts {
		parts[i] = strings.TrimSpace(p)
	}
	return strings.ToLower(strings.Join(parts, ","))
}

// leafRDN matches a normalized DN of the form "<prefix><name>,<parent>" and
// returns the RDN value.
func leafRDN(dn, prefix, parent string) (string, bool) {
	suffix := "," + parent
	if !strings.HasPrefix(dn, prefix) || !strings.HasSuffix(dn, suffix) {
		return "", false
	}
	name := dn[len(prefix) : len(dn)-len(suffix)]
	if name == "" || strings.Contains(name, ",") {
		return "", false
	}
	return name, true
}

func scopeName(scope int) string {
	switch scope {
	case ldapd.SearchRequestScopeBaseObject:
		return "base"
	case ldapd.SearchRequestSingleLevel:
		return "one"
	default:
		return "sub"
	}
}

func connID(c *conn) uint64 {
	if c == nil {
		return 0
	}
	return c.id
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

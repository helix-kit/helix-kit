// SPDX-License-Identifier: AGPL-3.0-only

package ldapserver

import (
	"context"
	"errors"
	"strings"
	"time"

	message "github.com/lor00x/goldap/message"
	ldapd "github.com/vjeantet/ldapserver"

	"github.com/helix-kit/experimental-ldap/internal/identity"
	"github.com/helix-kit/experimental-ldap/internal/store"
)

// handleBind authenticates the single service account. Users never bind here:
// this directory publishes identities, it does not authenticate people.
func (s *Server) handleBind(w ldapd.ResponseWriter, m *ldapd.Message) {
	r := m.GetBindRequest()
	c := session(m)
	dn := string(r.Name())

	if r.AuthenticationChoice() != "simple" {
		s.log.Warn("bind rejected", "reason", "auth method not supported",
			"choice", r.AuthenticationChoice(), "conn", connID(c))
		res := ldapd.NewBindResponse(ldapd.LDAPResultAuthMethodNotSupported)
		res.SetDiagnosticMessage("only simple bind is supported")
		w.Write(res)
		return
	}

	password := string(r.AuthenticationSimple())

	// Anonymous bind stays available so LDAP tooling and SSSD can read the Root
	// DSE, but it grants no access to People or Groups.
	if dn == "" && password == "" {
		if c != nil {
			c.setBound(false, "")
		}
		s.log.Info("bind ok", "dn", "(anonymous)", "conn", connID(c))
		w.Write(ldapd.NewBindResponse(ldapd.LDAPResultSuccess))
		return
	}

	if !strings.EqualFold(normalizeDN(dn), normalizeDN(s.opts.BindDN)) || !checkPassword(s.opts.BindPassword, password) {
		s.log.Warn("bind failed", "dn", dn, "conn", connID(c))
		res := ldapd.NewBindResponse(ldapd.LDAPResultInvalidCredentials)
		res.SetDiagnosticMessage("invalid credentials")
		w.Write(res)
		return
	}

	if c != nil {
		c.setBound(true, dn)
	}
	s.log.Info("bind ok", "dn", dn, "conn", connID(c))
	w.Write(ldapd.NewBindResponse(ldapd.LDAPResultSuccess))
}

// handleRootDSE answers the anonymous capability probe SSSD and ldapsearch make
// before anything else. It advertises only what this server actually implements.
func (s *Server) handleRootDSE(w ldapd.ResponseWriter, m *ldapd.Message) {
	r := m.GetSearchRequest()
	entry := identity.Entry{
		DN: "",
		Attrs: []identity.Attribute{
			{Name: "objectClass", Values: []string{"top"}},
			{Name: "namingContexts", Values: []string{s.opts.Directory.BaseDN}},
			{Name: "subschemaSubentry", Values: []string{}},
			{Name: "supportedLDAPVersion", Values: []string{"3"}},
			{Name: "vendorName", Values: []string{"Helix experimental LDAP facade"}},
		},
	}
	// Drop placeholders we do not actually serve.
	kept := entry.Attrs[:0]
	for _, a := range entry.Attrs {
		if len(a.Values) > 0 {
			kept = append(kept, a)
		}
	}
	entry.Attrs = kept

	ok, err := matchFilter(r.Filter(), entry)
	if err != nil {
		s.log.Warn("root dse search rejected", "filter", r.FilterString(), "error", err)
		w.Write(searchDone(ldapd.LDAPResultUnwillingToPerform, err.Error()))
		return
	}
	if ok {
		w.Write(toSearchResultEntry(entry, attributeSelection(r)))
	}
	s.log.Info("search", "base", "(root dse)", "scope", "base",
		"filter", r.FilterString(), "results", boolToInt(ok))
	w.Write(searchDone(ldapd.LDAPResultSuccess, ""))
}

// handleSearch serves the People and Groups trees from PostgreSQL.
func (s *Server) handleSearch(w ldapd.ResponseWriter, m *ldapd.Message) {
	start := time.Now()
	r := m.GetSearchRequest()
	c := session(m)
	base := normalizeDN(string(r.BaseObject()))
	scope := int(r.Scope())

	if c == nil || !c.isBound() {
		s.log.Warn("search denied", "reason", "not bound", "base", base, "conn", connID(c))
		w.Write(searchDone(ldapd.LDAPResultInsufficientAccessRights,
			"bind as the service account to search this directory"))
		return
	}

	plan, ok := s.planScope(base, scope)
	if !ok {
		s.log.Info("search", "base", base, "scope", scopeName(scope),
			"filter", r.FilterString(), "result", "noSuchObject")
		w.Write(searchDone(ldapd.LDAPResultNoSuchObject, "no such naming context"))
		return
	}

	limit := s.opts.SearchLimit
	if sl := int(r.SizeLimit()); sl > 0 && sl < limit {
		limit = sl
	}

	ctx := context.Background()
	candidates, err := s.candidates(ctx, plan, r.Filter())
	if err != nil {
		s.log.Error("search failed", "base", base, "filter", r.FilterString(), "error", err)
		w.Write(searchDone(ldapd.LDAPResultOperationsError, "backend unavailable"))
		return
	}

	selection := attributeSelection(r)
	sent, truncated := 0, false
	for _, e := range candidates {
		select {
		case <-m.Done:
			s.log.Info("search abandoned", "base", base, "filter", r.FilterString())
			return
		default:
		}
		matched, err := matchFilter(r.Filter(), e)
		if err != nil {
			s.log.Warn("search rejected", "base", base, "filter", r.FilterString(), "error", err)
			w.Write(searchDone(ldapd.LDAPResultUnwillingToPerform, err.Error()))
			return
		}
		if !matched {
			continue
		}
		if sent >= limit {
			truncated = true
			break
		}
		w.Write(toSearchResultEntry(e, selection))
		sent++
	}

	code, diag := ldapd.LDAPResultSuccess, ""
	if truncated {
		code, diag = ldapd.LDAPResultSizeLimitExceeded, "result set truncated"
	}
	s.log.Info("search", "base", base, "scope", scopeName(scope), "filter", r.FilterString(),
		"results", sent, "truncated", truncated, "duration_ms", time.Since(start).Milliseconds())
	w.Write(searchDone(code, diag))
}

// scopePlan is what a (base DN, scope) pair resolves to inside this directory.
type scopePlan struct {
	containers []identity.Entry
	wantUsers  bool
	wantGroups bool
	onlyUser   string
}

func (s *Server) planScope(base string, scope int) (scopePlan, bool) {
	d := s.opts.Directory
	var (
		baseDN   = normalizeDN(d.BaseDN)
		peopleDN = normalizeDN(d.PeopleDN)
		groupsDN = normalizeDN(d.GroupsDN)
		people   = d.OrgUnitEntry(d.PeopleDN, "People")
		groups   = d.OrgUnitEntry(d.GroupsDN, "Groups")
	)

	switch base {
	case baseDN:
		switch scope {
		case ldapd.SearchRequestScopeBaseObject:
			return scopePlan{containers: []identity.Entry{d.DomainEntry()}}, true
		case ldapd.SearchRequestSingleLevel:
			return scopePlan{containers: []identity.Entry{people, groups}}, true
		default:
			return scopePlan{
				containers: []identity.Entry{d.DomainEntry(), people, groups},
				wantUsers:  true, wantGroups: true,
			}, true
		}
	case peopleDN:
		return containerPlan(people, scope, true, false), true
	case groupsDN:
		return containerPlan(groups, scope, false, true), true
	}

	if name, ok := leafRDN(base, "uid=", peopleDN); ok {
		return leafPlan(name, scope, true, false), true
	}
	if name, ok := leafRDN(base, "cn=", groupsDN); ok {
		return leafPlan(name, scope, false, true), true
	}
	return scopePlan{}, false
}

func containerPlan(container identity.Entry, scope int, users, groups bool) scopePlan {
	switch scope {
	case ldapd.SearchRequestScopeBaseObject:
		return scopePlan{containers: []identity.Entry{container}}
	case ldapd.SearchRequestSingleLevel:
		return scopePlan{wantUsers: users, wantGroups: groups}
	default:
		return scopePlan{containers: []identity.Entry{container}, wantUsers: users, wantGroups: groups}
	}
}

func leafPlan(name string, scope int, users, groups bool) scopePlan {
	if scope == ldapd.SearchRequestSingleLevel {
		return scopePlan{} // leaf entries have no children
	}
	return scopePlan{wantUsers: users, wantGroups: groups, onlyUser: name}
}

// candidates fetches the entries the plan covers, pushing a selective equality
// predicate down into SQL whenever the filter offers one.
func (s *Server) candidates(ctx context.Context, plan scopePlan, filter message.Filter) ([]identity.Entry, error) {
	entries := append([]identity.Entry(nil), plan.containers...)

	if plan.wantUsers {
		users, err := s.fetch(ctx, filter, kindUser, plan.onlyUser)
		if err != nil {
			return nil, err
		}
		for _, u := range users {
			entries = append(entries, s.opts.Directory.UserEntry(u))
		}
	}
	if plan.wantGroups {
		users, err := s.fetch(ctx, filter, kindGroup, plan.onlyUser)
		if err != nil {
			return nil, err
		}
		for _, u := range users {
			entries = append(entries, s.opts.Directory.GroupEntry(u))
		}
	}
	return entries, nil
}

func (s *Server) fetch(ctx context.Context, filter message.Filter, kind entryKind, onlyUser string) ([]identity.UnixUser, error) {
	l := planLookup(filter, kind)
	if onlyUser != "" {
		// The base DN already names one entry; it wins over any filter predicate.
		l = lookup{kind: lookupUsername, username: onlyUser}
	}

	switch l.kind {
	case lookupUsername:
		u, err := s.store.GetByUsername(ctx, l.username)
		return oneOrNone(u, err)
	case lookupUID:
		u, err := s.store.GetByUID(ctx, l.uid)
		return oneOrNone(u, err)
	default:
		return s.store.List(ctx, s.opts.SearchLimit)
	}
}

func oneOrNone(u *identity.UnixUser, err error) ([]identity.UnixUser, error) {
	if errors.Is(err, store.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return []identity.UnixUser{*u}, nil
}

const readOnlyDiagnostic = "this directory is a read-only projection of PostgreSQL"

// refuseWrite rejects an operation this directory does not implement. LDAP here
// is a read-only projection: there is nothing to write back to.
func (s *Server) refuseWrite(op string) ldapd.HandlerFunc {
	return func(w ldapd.ResponseWriter, m *ldapd.Message) {
		s.log.Warn("operation refused", "op", op, "conn", connID(session(m)))
		res := result(ldapd.LDAPResultUnwillingToPerform, readOnlyDiagnostic)
		switch op {
		case "add":
			w.Write(message.AddResponse(res))
		case "modify":
			w.Write(message.ModifyResponse(res))
		case "delete":
			w.Write(message.DelResponse(res))
		default:
			w.Write(message.CompareResponse(res))
		}
	}
}

// handleNotFound answers every operation with no route of its own — ModifyDN and
// all extended operations, StartTLS and password-modify included. Each gets a
// response of its own protocol type, so clients see a refusal rather than a
// malformed reply.
func (s *Server) handleNotFound(w ldapd.ResponseWriter, m *ldapd.Message) {
	s.log.Warn("operation refused", "op", m.ProtocolOpName(), "conn", connID(session(m)))
	res := result(ldapd.LDAPResultUnwillingToPerform, readOnlyDiagnostic)

	switch op := m.ProtocolOp().(type) {
	case message.ModifyDNRequest:
		w.Write(message.ModifyDNResponse(res))
	case message.ExtendedRequest:
		// TLS/StartTLS is an explicitly deferred production concern, and there
		// is no password to modify: this directory stores no credentials.
		s.log.Warn("extended operation refused", "oid", string(op.RequestName()))
		ext := ldapd.NewExtendedResponse(ldapd.LDAPResultUnwillingToPerform)
		ext.SetDiagnosticMessage("extended operations are not implemented")
		w.Write(ext)
	default:
		w.Write(res)
	}
}

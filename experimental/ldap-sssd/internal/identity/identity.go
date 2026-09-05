// SPDX-License-Identifier: AGPL-3.0-only

// Package identity holds the Unix identity model and the projection rules that
// turn a stored Helix user into the POSIX and LDAP shapes Linux expects.
//
// PostgreSQL stores only uuid/email/username/linux_uid. Everything else a Unix
// system needs — gid, home directory, login shell, DNs, objectClasses and the
// private primary group — is synthesized here, never stored.
package identity

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

// ErrInvalidUsername is returned for usernames outside the permitted Unix shape.
var ErrInvalidUsername = errors.New("invalid unix username")

// usernameRe is deliberately more restrictive than POSIX: lowercase only, so a
// username maps 1:1 onto a home directory and an LDAP RDN with no escaping.
var usernameRe = regexp.MustCompile(`^[a-z_][a-z0-9_-]{0,31}$`)

// ValidateUsername reports whether s is usable as a Helix Unix username.
func ValidateUsername(s string) error {
	if !usernameRe.MatchString(s) {
		return fmt.Errorf("%w: %q must match [a-z_][a-z0-9_-]{0,31}", ErrInvalidUsername, s)
	}
	return nil
}

// UnixUser is a Helix identity as stored in PostgreSQL.
type UnixUser struct {
	UUID     uuid.UUID
	Email    string
	Username string
	UID      uint32
}

// GID is the user's private primary group id. This experiment models one
// private group per user, so it is always the uid.
func (u UnixUser) GID() uint32 { return u.UID }

// Attribute is one LDAP attribute and its values, in emission order.
type Attribute struct {
	Name   string
	Values []string
}

// Entry is a directory entry ready to be written to the wire.
type Entry struct {
	DN    string
	Attrs []Attribute
}

// Get returns the values of attr, matched case-insensitively as LDAP requires.
func (e Entry) Get(attr string) []string {
	for _, a := range e.Attrs {
		if strings.EqualFold(a.Name, attr) {
			return a.Values
		}
	}
	return nil
}

// Has reports whether the entry carries attr at all (LDAP presence match).
func (e Entry) Has(attr string) bool { return e.Get(attr) != nil }

// Directory is the naming context plus the synthesis policy for Unix attributes.
type Directory struct {
	BaseDN     string
	PeopleDN   string
	GroupsDN   string
	HomeRoot   string
	LoginShell string
}

// NewDirectory derives the People/Groups containers from a base DN.
func NewDirectory(baseDN, homeRoot, loginShell string) Directory {
	return Directory{
		BaseDN:     baseDN,
		PeopleDN:   "ou=People," + baseDN,
		GroupsDN:   "ou=Groups," + baseDN,
		HomeRoot:   homeRoot,
		LoginShell: loginShell,
	}
}

// HomeDirectory is the synthesized home path, e.g. /home/alice.
func (d Directory) HomeDirectory(u UnixUser) string {
	return strings.TrimSuffix(d.HomeRoot, "/") + "/" + u.Username
}

// UserDN is the user's distinguished name under ou=People.
func (d Directory) UserDN(u UnixUser) string { return "uid=" + u.Username + "," + d.PeopleDN }

// GroupDN is the private primary group's distinguished name under ou=Groups.
func (d Directory) GroupDN(u UnixUser) string { return "cn=" + u.Username + "," + d.GroupsDN }

// UserEntry projects a stored user as a posixAccount/inetOrgPerson entry.
// No userPassword is ever synthesized: this directory is identity-only.
func (d Directory) UserEntry(u UnixUser) Entry {
	return Entry{
		DN: d.UserDN(u),
		Attrs: []Attribute{
			{Name: "objectClass", Values: []string{"top", "person", "organizationalPerson", "inetOrgPerson", "posixAccount"}},
			{Name: "uid", Values: []string{u.Username}},
			{Name: "cn", Values: []string{u.Username}},
			{Name: "sn", Values: []string{u.Username}},
			{Name: "gecos", Values: []string{u.Username}},
			{Name: "mail", Values: []string{u.Email}},
			{Name: "uidNumber", Values: []string{strconv.FormatUint(uint64(u.UID), 10)}},
			{Name: "gidNumber", Values: []string{strconv.FormatUint(uint64(u.GID()), 10)}},
			{Name: "homeDirectory", Values: []string{d.HomeDirectory(u)}},
			{Name: "loginShell", Values: []string{d.LoginShell}},
		},
	}
}

// GroupEntry projects the user's synthetic private primary group.
func (d Directory) GroupEntry(u UnixUser) Entry {
	return Entry{
		DN: d.GroupDN(u),
		Attrs: []Attribute{
			{Name: "objectClass", Values: []string{"top", "posixGroup"}},
			{Name: "cn", Values: []string{u.Username}},
			{Name: "gidNumber", Values: []string{strconv.FormatUint(uint64(u.GID()), 10)}},
		},
	}
}

// DomainEntry is the naming context entry itself (base-scope search on the base DN).
func (d Directory) DomainEntry() Entry {
	dc := strings.TrimPrefix(strings.SplitN(d.BaseDN, ",", 2)[0], "dc=")
	return Entry{
		DN: d.BaseDN,
		Attrs: []Attribute{
			{Name: "objectClass", Values: []string{"top", "dcObject", "organization"}},
			{Name: "dc", Values: []string{dc}},
			{Name: "o", Values: []string{dc}},
		},
	}
}

// OrgUnitEntry is a container entry (ou=People / ou=Groups).
func (d Directory) OrgUnitEntry(dn, ou string) Entry {
	return Entry{
		DN: dn,
		Attrs: []Attribute{
			{Name: "objectClass", Values: []string{"top", "organizationalUnit"}},
			{Name: "ou", Values: []string{ou}},
		},
	}
}

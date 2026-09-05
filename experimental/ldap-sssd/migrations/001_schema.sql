-- SPDX-License-Identifier: AGPL-3.0-only
--
-- The canonical identity record. Deliberately minimal: no password, no home
-- directory, no login shell, no group table. Everything Unix needs beyond these
-- four columns is synthesized by the LDAP facade at query time.
--
-- uuid stands in for the foreign key to the real Helix users table; in this
-- experiment it is a dummy value.

CREATE TABLE users (
    uuid      UUID PRIMARY KEY,
    email     TEXT NOT NULL UNIQUE,
    username  TEXT NOT NULL UNIQUE,
    linux_uid BIGINT NOT NULL UNIQUE,

    -- Usernames must be valid Unix usernames, and uids must sit in the Helix
    -- range so they cannot collide with local or system accounts.
    CONSTRAINT users_username_unix CHECK (username ~ '^[a-z_][a-z0-9_-]{0,31}$'),
    CONSTRAINT users_linux_uid_range CHECK (linux_uid >= 200001 AND linux_uid < 4294967295)
);

-- The facade looks users up by exactly these two keys; both are already unique.
COMMENT ON TABLE users IS 'Helix identities projected read-only over LDAP';

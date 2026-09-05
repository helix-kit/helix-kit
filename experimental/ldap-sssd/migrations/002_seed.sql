-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Fixed UUIDs keep the tests deterministic.

INSERT INTO users (uuid, email, username, linux_uid) VALUES
    ('00000000-0000-0000-0000-000000000001', 'alice@example.com', 'alice', 200001),
    ('00000000-0000-0000-0000-000000000002', 'bob@example.com',   'bob',   200002);

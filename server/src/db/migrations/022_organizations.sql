-- 022_organizations.sql
-- Introduces the org model: organizations, memberships, businesses, and invite
-- tokens. Each existing user receives a personal org (id == user_id for easy
-- backfilling in 023), an owner membership, and a "Personal" business.

-- ── 1. New tables ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
  id         TEXT PRIMARY KEY,                -- uuid (personal org reuses user's uuid)
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS org_memberships (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     TEXT    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    TEXT    NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  role       TEXT    NOT NULL DEFAULT 'member'
               CHECK (role IN ('owner', 'member')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON org_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_org  ON org_memberships(org_id);

CREATE TABLE IF NOT EXISTS businesses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_businesses_org ON businesses(org_id);

CREATE TABLE IF NOT EXISTS org_invites (
  id         TEXT PRIMARY KEY,               -- uuid token
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member'
               CHECK (role IN ('owner', 'member')),
  status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_org_invites_org   ON org_invites(org_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_email ON org_invites(email);

-- ── 2. Seed personal orgs for all existing users ──────────────────────────────
-- Convention: personal org_id == user_id so migration 023 can backfill
-- business_id without complex joins.

INSERT OR IGNORE INTO organizations(id, name)
SELECT id, COALESCE(name, COALESCE(email, 'My Organization'))
FROM users;

INSERT OR IGNORE INTO org_memberships(org_id, user_id, role)
SELECT id, id, 'owner'
FROM users;

INSERT INTO businesses(org_id, name)
SELECT id, 'Personal'
FROM users
WHERE NOT EXISTS (
  SELECT 1 FROM businesses b WHERE b.org_id = users.id AND b.name = 'Personal'
);

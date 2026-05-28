CREATE TABLE IF NOT EXISTS unknown_format_samples (
  id            SERIAL  PRIMARY KEY,
  org_id        TEXT    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  redacted_text TEXT    NOT NULL,
  bank_hint     TEXT,
  page_count    INTEGER,
  file_size_kb  INTEGER,
  preview_token TEXT    UNIQUE,
  status        TEXT    NOT NULL DEFAULT 'pending',
  admin_notes   TEXT
);

CREATE INDEX IF NOT EXISTS idx_unknown_format_samples_status ON unknown_format_samples(status);
CREATE INDEX IF NOT EXISTS idx_unknown_format_samples_org    ON unknown_format_samples(org_id);

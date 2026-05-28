-- 008_llm_bank_hints.sql
-- Tracks how many times each bank has fallen through to the LLM parser, and
-- stores a generated column-structure hint once a bank crosses the threshold
-- (default: 2 hits). The hint is intended to guide a developer building a
-- dedicated template parser for that bank.

CREATE TABLE IF NOT EXISTS llm_bank_hints (
  bank_name          TEXT    NOT NULL PRIMARY KEY,  -- normalised (lowercase, trimmed)
  llm_hit_count      INTEGER NOT NULL DEFAULT 0,
  column_hint        TEXT,                          -- JSON description from second LLM call
  hint_generated_at  TEXT                           -- ISO-8601 timestamp
);

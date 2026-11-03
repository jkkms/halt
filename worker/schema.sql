-- halt-scores (SPEC_rush2 §F): the rush hall of fame. Apply with
--   npx wrangler@4 d1 execute halt-scores --remote --file=schema.sql
-- Only a SHA-256 of each device token is stored, never the token itself; no IP addresses.

-- A nickname belongs to the first device token that used it.
CREATE TABLE IF NOT EXISTS players (
  nick_key   TEXT PRIMARY KEY,          -- the nickname as compared (NFC, trimmed, lower case)
  nick       TEXT NOT NULL,             -- as first written
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL           -- ms since 1970
);
CREATE INDEX IF NOT EXISTS players_token ON players (token_hash, created_at);

-- Every ranked run; finished_at stays NULL until /run/finish accepts it (a run can finish once).
CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL,
  nick_key    TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  score       INTEGER,
  cards       INTEGER,
  best_streak INTEGER
);
CREATE INDEX IF NOT EXISTS runs_token_started ON runs (token_hash, started_at);

-- The hall of fame: the best score of each nickname. Never reset.
CREATE TABLE IF NOT EXISTS best (
  nick_key    TEXT PRIMARY KEY,
  nick        TEXT NOT NULL,
  score       INTEGER NOT NULL,
  cards       INTEGER NOT NULL,
  best_streak INTEGER NOT NULL,
  at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS best_score ON best (score DESC, at ASC);

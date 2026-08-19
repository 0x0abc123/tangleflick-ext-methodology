-- Generic key/value table backing the DataStore repositories (SQLite).
CREATE TABLE IF NOT EXISTS kv_store (
  collection TEXT NOT NULL,
  id         TEXT NOT NULL,
  value      TEXT NOT NULL,           -- JSON-serialized value
  updated_at TEXT NOT NULL,           -- ISO-8601 timestamp
  PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS idx_kv_store_collection ON kv_store (collection);

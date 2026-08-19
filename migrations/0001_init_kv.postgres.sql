-- Generic key/value table backing the DataStore repositories (PostgreSQL).
CREATE TABLE IF NOT EXISTS kv_store (
  collection TEXT NOT NULL,
  id         TEXT NOT NULL,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS idx_kv_store_collection ON kv_store (collection);

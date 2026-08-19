import type { ZodType } from "zod";

/**
 * A collection-scoped key/value repository. This is the handler-facing API for
 * persisted state; the same interface is satisfied by both the SQLite and
 * Postgres adapters, so handlers never write backend-specific SQL.
 */
export interface Repository<T> {
  /** Fetch a value by id, or null if absent. */
  get(id: string): Promise<T | null>;
  /** Insert or replace the value at id. */
  put(id: string, value: T): Promise<void>;
  /** Delete by id; resolves true if a row was removed. */
  delete(id: string): Promise<boolean>;
  /** Cheap existence check. */
  has(id: string): Promise<boolean>;
  /** List entries, optionally filtered by id prefix and capped by limit. */
  list(opts?: ListOptions): Promise<Array<Entry<T>>>;
  /** Return entries whose stored JSON field equals `value` (equality only). */
  where(field: string, value: unknown, opts?: ListOptions): Promise<Array<Entry<T>>>;
}

export interface Entry<T> {
  id: string;
  value: T;
}

export interface ListOptions {
  prefix?: string;
  limit?: number;
}

/**
 * The data store port. Adapters implement this; handlers depend only on it.
 */
export interface DataStore {
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /**
   * Get a repository for a named collection. An optional Zod schema validates
   * values on `put` and (defensively) on `get`.
   */
  repository<T>(collection: string, schema?: ZodType<T>): Repository<T>;

  /**
   * Run `fn` inside a transaction. The callback receives a store bound to the
   * transaction; all repositories obtained from it share the same tx.
   */
  transaction<R>(fn: (tx: DataStore) => Promise<R>): Promise<R>;

  /** Low-level escape hatch: run raw SQL (used by the migration runner). */
  exec(sql: string): Promise<void>;
}

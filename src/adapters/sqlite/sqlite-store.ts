import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ZodType } from "zod";
import type {
  DataStore,
  Entry,
  ListOptions,
  Repository,
} from "../../core/ports/data-store.ts";
import { parseWith } from "../../core/serialization/json-codec.ts";
import type { MigrationStore } from "../../core/store/migration-store.ts";
import type { Logger } from "../../logger.ts";

export interface SqliteStoreDeps {
  path: string;
  logger: Logger;
}

interface Row {
  id: string;
  value: string;
}

/**
 * Embedded data store backed by bun:sqlite. Default store — zero external
 * dependency. All collections share one generic `kv_store` table; values are
 * stored as JSON text and filtered via json_extract for `where()`.
 */
export class SqliteStore implements DataStore, MigrationStore {
  readonly backend = "sqlite" as const;
  private db!: Database;

  constructor(private readonly deps: SqliteStoreDeps) {}

  async connect(): Promise<void> {
    if (this.deps.path !== ":memory:") {
      mkdirSync(dirname(this.deps.path), { recursive: true });
    }
    this.db = new Database(this.deps.path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.deps.logger.info("sqlite store connected", { path: this.deps.path });
  }

  async disconnect(): Promise<void> {
    this.db?.close();
    this.deps.logger.info("sqlite store disconnected");
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  repository<T>(collection: string, schema?: ZodType<T>): Repository<T> {
    return new SqliteRepository<T>(this.db, collection, schema);
  }

  async transaction<R>(fn: (tx: DataStore) => Promise<R>): Promise<R> {
    // SQLite is single-connection here, so the same store instance is the tx.
    this.db.exec("BEGIN");
    try {
      const result = await fn(this);
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /* --------------------------- MigrationStore ---------------------------- */

  async ensureMigrationsTable(): Promise<void> {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version TEXT PRIMARY KEY,
         applied_at TEXT NOT NULL
       )`,
    );
  }

  async appliedVersions(): Promise<Set<string>> {
    const rows = this.db
      .query<{ version: string }, []>("SELECT version FROM schema_migrations")
      .all();
    return new Set(rows.map((r) => r.version));
  }

  async applyMigration(version: string, sql: string): Promise<void> {
    this.db.exec("BEGIN");
    try {
      this.db.exec(sql);
      this.db
        .query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(version, new Date().toISOString());
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}

class SqliteRepository<T> implements Repository<T> {
  constructor(
    private readonly db: Database,
    private readonly collection: string,
    private readonly schema?: ZodType<T>,
  ) {}

  async get(id: string): Promise<T | null> {
    const row = this.db
      .query<Row, [string, string]>(
        "SELECT id, value FROM kv_store WHERE collection = ? AND id = ?",
      )
      .get(this.collection, id);
    return row ? this.deserialize(row.value) : null;
  }

  async put(id: string, value: T): Promise<void> {
    const validated = this.schema
      ? parseWith(this.schema, this.collection, value)
      : value;
    this.db
      .query(
        `INSERT INTO kv_store (collection, id, value, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(collection, id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(this.collection, id, JSON.stringify(validated), new Date().toISOString());
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db
      .query("DELETE FROM kv_store WHERE collection = ? AND id = ?")
      .run(this.collection, id);
    return result.changes > 0;
  }

  async has(id: string): Promise<boolean> {
    const row = this.db
      .query<{ one: number }, [string, string]>(
        "SELECT 1 as one FROM kv_store WHERE collection = ? AND id = ? LIMIT 1",
      )
      .get(this.collection, id);
    return row !== null;
  }

  async list(opts?: ListOptions): Promise<Array<Entry<T>>> {
    const params: SQLQueryBindings[] = [this.collection];
    let sql = "SELECT id, value FROM kv_store WHERE collection = ?";
    if (opts?.prefix) {
      sql += " AND id LIKE ? ESCAPE '\\'";
      params.push(`${escapeLike(opts.prefix)}%`);
    }
    sql += " ORDER BY id";
    if (opts?.limit != null) {
      sql += " LIMIT ?";
      params.push(opts.limit);
    }
    const rows = this.db.query<Row, SQLQueryBindings[]>(sql).all(...params);
    return rows.map((r) => ({ id: r.id, value: this.deserialize(r.value) }));
  }

  async where(
    field: string,
    value: unknown,
    opts?: ListOptions,
  ): Promise<Array<Entry<T>>> {
    const params: SQLQueryBindings[] = [this.collection, `$.${field}`, jsonScalar(value)];
    let sql =
      "SELECT id, value FROM kv_store WHERE collection = ? AND json_extract(value, ?) = ?";
    sql += " ORDER BY id";
    if (opts?.limit != null) {
      sql += " LIMIT ?";
      params.push(opts.limit);
    }
    const rows = this.db.query<Row, SQLQueryBindings[]>(sql).all(...params);
    return rows.map((r) => ({ id: r.id, value: this.deserialize(r.value) }));
  }

  private deserialize(value: string): T {
    const parsed = JSON.parse(value) as unknown;
    return this.schema
      ? parseWith(this.schema, this.collection, parsed)
      : (parsed as T);
  }
}

/** SQLite bind values must be scalars; booleans map to 0/1 like json_extract. */
function jsonScalar(value: unknown): string | number | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  return String(value);
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

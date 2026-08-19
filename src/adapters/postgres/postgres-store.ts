import { SQL } from "bun";
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

export interface PostgresStoreDeps {
  url: string;
  logger: Logger;
}

/** Minimal client surface both the root connection and a transaction expose. */
interface PgClient {
  unsafe(query: string, params?: unknown[]): Promise<unknown>;
  begin<R>(fn: (tx: PgClient) => Promise<R>): Promise<R>;
}

interface Row {
  id: string;
  value: unknown;
}

/**
 * External data store backed by PostgreSQL via Bun's native SQL client. Same
 * generic `kv_store` table as SQLite, but the value column is JSONB and `where`
 * filters via the `->>` operator. Behaviour matches the SQLite adapter so the
 * DataStore port is truly transport-agnostic.
 */
export class PostgresStore implements DataStore, MigrationStore {
  readonly backend = "postgres" as const;
  private client!: PgClient;
  private root?: SQL;

  constructor(private readonly deps: PostgresStoreDeps) {}

  async connect(): Promise<void> {
    this.root = new SQL(this.deps.url);
    this.client = this.root as unknown as PgClient;
    await this.client.unsafe("SELECT 1");
    this.deps.logger.info("postgres store connected");
  }

  async disconnect(): Promise<void> {
    await this.root?.end();
    this.deps.logger.info("postgres store disconnected");
  }

  async exec(sql: string): Promise<void> {
    await this.client.unsafe(sql);
  }

  repository<T>(collection: string, schema?: ZodType<T>): Repository<T> {
    return new PostgresRepository<T>(() => this.client, collection, schema);
  }

  async transaction<R>(fn: (tx: DataStore) => Promise<R>): Promise<R> {
    return this.client.begin(async (tx) => {
      const txStore = new PostgresStore(this.deps);
      txStore.client = tx;
      return fn(txStore);
    });
  }

  /* --------------------------- MigrationStore ---------------------------- */

  async ensureMigrationsTable(): Promise<void> {
    await this.client.unsafe(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL
       )`,
    );
  }

  async appliedVersions(): Promise<Set<string>> {
    const rows = (await this.client.unsafe(
      "SELECT version FROM schema_migrations",
    )) as Array<{ version: string }>;
    return new Set(rows.map((r) => r.version));
  }

  async applyMigration(version: string, sql: string): Promise<void> {
    await this.client.begin(async (tx) => {
      await tx.unsafe(sql); // no params → simple protocol allows multiple statements
      await tx.unsafe(
        "INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)",
        [version, new Date().toISOString()],
      );
    });
  }
}

class PostgresRepository<T> implements Repository<T> {
  constructor(
    private readonly client: () => PgClient,
    private readonly collection: string,
    private readonly schema?: ZodType<T>,
  ) {}

  async get(id: string): Promise<T | null> {
    const rows = (await this.client().unsafe(
      "SELECT id, value FROM kv_store WHERE collection = $1 AND id = $2",
      [this.collection, id],
    )) as Row[];
    const row = rows[0];
    return row ? this.deserialize(row.value) : null;
  }

  async put(id: string, value: T): Promise<void> {
    const validated = this.schema
      ? parseWith(this.schema, this.collection, value)
      : value;
    await this.client().unsafe(
      `INSERT INTO kv_store (collection, id, value, updated_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (collection, id) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [this.collection, id, JSON.stringify(validated), new Date().toISOString()],
    );
  }

  async delete(id: string): Promise<boolean> {
    const rows = (await this.client().unsafe(
      "DELETE FROM kv_store WHERE collection = $1 AND id = $2 RETURNING id",
      [this.collection, id],
    )) as Row[];
    return rows.length > 0;
  }

  async has(id: string): Promise<boolean> {
    const rows = (await this.client().unsafe(
      "SELECT 1 FROM kv_store WHERE collection = $1 AND id = $2 LIMIT 1",
      [this.collection, id],
    )) as unknown[];
    return rows.length > 0;
  }

  async list(opts?: ListOptions): Promise<Array<Entry<T>>> {
    const params: unknown[] = [this.collection];
    let sql = "SELECT id, value FROM kv_store WHERE collection = $1";
    if (opts?.prefix) {
      params.push(`${escapeLike(opts.prefix)}%`);
      sql += ` AND id LIKE $${params.length}`;
    }
    sql += " ORDER BY id";
    if (opts?.limit != null) {
      params.push(opts.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const rows = (await this.client().unsafe(sql, params)) as Row[];
    return rows.map((r) => ({ id: r.id, value: this.deserialize(r.value) }));
  }

  async where(
    field: string,
    value: unknown,
    opts?: ListOptions,
  ): Promise<Array<Entry<T>>> {
    const params: unknown[] = [this.collection, field, jsonText(value)];
    let sql =
      "SELECT id, value FROM kv_store WHERE collection = $1 AND value ->> $2 = $3 ORDER BY id";
    if (opts?.limit != null) {
      params.push(opts.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const rows = (await this.client().unsafe(sql, params)) as Row[];
    return rows.map((r) => ({ id: r.id, value: this.deserialize(r.value) }));
  }

  private deserialize(value: unknown): T {
    // Bun may hand back JSONB already-parsed or as a string; handle both.
    const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    return this.schema
      ? parseWith(this.schema, this.collection, parsed)
      : (parsed as T);
  }
}

/** `->>` yields text, so compare against the value's text form. */
function jsonText(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

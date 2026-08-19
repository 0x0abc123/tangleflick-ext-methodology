/**
 * Capability implemented by store adapters to support the migration runner.
 * Kept separate from the DataStore port so backend-specific migration SQL never
 * leaks into the handler-facing API.
 */
export interface MigrationStore {
  /** Which backend the adapter is — selects the correct `.<backend>.sql` files. */
  readonly backend: "sqlite" | "postgres";
  /** Create the bookkeeping table if it does not exist. */
  ensureMigrationsTable(): Promise<void>;
  /** Set of already-applied migration versions (filename stems). */
  appliedVersions(): Promise<Set<string>>;
  /** Run a migration's SQL and record it, atomically. */
  applyMigration(version: string, sql: string): Promise<void>;
}

export function isMigrationStore(value: unknown): value is MigrationStore {
  const s = value as Partial<MigrationStore> | null;
  return (
    !!s &&
    typeof s.ensureMigrationsTable === "function" &&
    typeof s.appliedVersions === "function" &&
    typeof s.applyMigration === "function"
  );
}

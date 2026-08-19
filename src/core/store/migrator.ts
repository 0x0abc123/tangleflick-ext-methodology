import { Glob } from "bun";
import { join } from "node:path";
import type { MigrationStore } from "./migration-store.ts";
import type { Logger } from "../../logger.ts";

export const DEFAULT_MIGRATIONS_DIR = "migrations";

interface MigrationFile {
  version: string; // filename stem without backend suffix, e.g. "0001_init_kv"
  backend: "sqlite" | "postgres" | "generic";
  path: string;
}

/**
 * Applies ordered `.sql` migrations that haven't run yet, tracking applied
 * versions in the store's bookkeeping table. Per-backend variants are resolved
 * by suffix: `0001_init.sqlite.sql` / `0001_init.postgres.sql`, falling back to
 * `0001_init.sql` (generic) when no backend-specific file exists.
 */
export async function runMigrations(
  store: MigrationStore,
  logger: Logger,
  dir: string = DEFAULT_MIGRATIONS_DIR,
): Promise<string[]> {
  await store.ensureMigrationsTable();
  const applied = await store.appliedVersions();

  const files = await discoverMigrations(dir);
  const resolved = resolveForBackend(files, store.backend);
  const pending = resolved.filter((m) => !applied.has(m.version));

  if (pending.length === 0) {
    logger.info("no pending migrations", { backend: store.backend });
    return [];
  }

  const ran: string[] = [];
  for (const migration of pending) {
    const sql = await Bun.file(migration.path).text();
    logger.info("applying migration", { version: migration.version });
    await store.applyMigration(migration.version, sql);
    ran.push(migration.version);
  }
  logger.info("migrations complete", { applied: ran });
  return ran;
}

async function discoverMigrations(dir: string): Promise<MigrationFile[]> {
  const glob = new Glob("*.sql");
  const files: MigrationFile[] = [];
  for await (const name of glob.scan({ cwd: dir, onlyFiles: true })) {
    files.push({ ...parseName(name), path: join(dir, name) });
  }
  return files;
}

function parseName(name: string): { version: string; backend: MigrationFile["backend"] } {
  const stem = name.replace(/\.sql$/i, "");
  const match = stem.match(/^(.*)\.(sqlite|postgres)$/i);
  if (match) {
    return { version: match[1]!, backend: match[2]!.toLowerCase() as "sqlite" | "postgres" };
  }
  return { version: stem, backend: "generic" };
}

/** Pick one file per version: backend-specific wins over generic. */
function resolveForBackend(
  files: MigrationFile[],
  backend: "sqlite" | "postgres",
): MigrationFile[] {
  const byVersion = new Map<string, MigrationFile>();
  for (const file of files) {
    if (file.backend !== backend && file.backend !== "generic") continue;
    const current = byVersion.get(file.version);
    // Backend-specific beats generic; otherwise first seen.
    if (!current || (current.backend === "generic" && file.backend === backend)) {
      byVersion.set(file.version, file);
    }
  }
  return [...byVersion.values()].sort((a, b) => a.version.localeCompare(b.version));
}

import type { StoreConfig } from "../../config/schema.ts";
import type { DataStore } from "../ports/data-store.ts";
import type { Logger } from "../../logger.ts";
import { SqliteStore } from "../../adapters/sqlite/sqlite-store.ts";
import { PostgresStore } from "../../adapters/postgres/postgres-store.ts";

export interface StoreDeps {
  logger: Logger;
}

/**
 * The ONLY place store adapters are named. Selects the backend from config and
 * returns it typed as the DataStore port. The returned instance also implements
 * MigrationStore, which the migration runner relies on.
 */
export function createStore(config: StoreConfig, deps: StoreDeps): DataStore {
  const logger = deps.logger.child({ component: "store", store: config.type });
  switch (config.type) {
    case "sqlite":
      return new SqliteStore({ path: config.path, logger });
    case "postgres":
      return new PostgresStore({ url: config.url, logger });
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unknown store type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

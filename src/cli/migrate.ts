import { loadConfig } from "../config/load.ts";
import { createLogger } from "../logger.ts";
import { createStore } from "../core/store/factory.ts";
import { runMigrations } from "../core/store/migrator.ts";
import { isMigrationStore } from "../core/store/migration-store.ts";

/** Standalone migration runner: `bun run migrate`. */
async function main(): Promise<void> {
  const config = await loadConfig();
  const logger = createLogger(config.app.logLevel, { app: config.app.name, cmd: "migrate" });

  const store = createStore(config.store, { logger });
  await store.connect();
  try {
    if (!isMigrationStore(store)) {
      throw new Error("Store does not support migrations");
    }
    const ran = await runMigrations(store, logger);
    logger.info("migrate finished", { count: ran.length });
  } finally {
    await store.disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(`[tangleflick] migrate failed: ${(err as Error).message}`);
  process.exit(1);
});

import { test, expect, describe } from "bun:test";
import { SqliteStore } from "../src/adapters/sqlite/sqlite-store.ts";
import { runMigrations } from "../src/core/store/migrator.ts";
import { createLogger } from "../src/logger.ts";

describe("runMigrations", () => {
  test("applies pending migrations once and is idempotent", async () => {
    const store = new SqliteStore({ path: ":memory:", logger: createLogger("error") });
    await store.connect();
    const logger = createLogger("error");

    const first = await runMigrations(store, logger, "migrations");
    expect(first).toContain("0001_init_kv");

    const second = await runMigrations(store, logger, "migrations");
    expect(second).toEqual([]);

    // The kv_store table exists and is usable after migration.
    const repo = store.repository<{ ok: boolean }>("smoke");
    await repo.put("1", { ok: true });
    expect(await repo.get("1")).toEqual({ ok: true });

    await store.disconnect();
  });
});

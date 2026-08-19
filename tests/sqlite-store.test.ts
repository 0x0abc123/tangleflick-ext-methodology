import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { z } from "zod";
import { SqliteStore } from "../src/adapters/sqlite/sqlite-store.ts";
import { runMigrations } from "../src/core/store/migrator.ts";
import { createLogger } from "../src/logger.ts";

const OrderSchema = z.object({ item: z.string(), qty: z.number().int(), rush: z.boolean() });
type Order = z.infer<typeof OrderSchema>;

let store: SqliteStore;

beforeEach(async () => {
  store = new SqliteStore({ path: ":memory:", logger: createLogger("error") });
  await store.connect();
  await runMigrations(store, createLogger("error"), "migrations");
});

afterEach(async () => {
  await store.disconnect();
});

describe("SqliteStore repository", () => {
  test("put / get round-trip with schema validation", async () => {
    const repo = store.repository<Order>("orders", OrderSchema);
    await repo.put("o1", { item: "book", qty: 2, rush: false });

    expect(await repo.get("o1")).toEqual({ item: "book", qty: 2, rush: false });
    expect(await repo.has("o1")).toBe(true);
    expect(await repo.get("missing")).toBeNull();
  });

  test("put rejects an invalid value", async () => {
    const repo = store.repository<Order>("orders", OrderSchema);
    // @ts-expect-error deliberately wrong shape
    await expect(repo.put("bad", { item: "x", qty: "two", rush: false })).rejects.toThrow();
  });

  test("list and where filter correctly", async () => {
    const repo = store.repository<Order>("orders", OrderSchema);
    await repo.put("a", { item: "pen", qty: 1, rush: true });
    await repo.put("b", { item: "pad", qty: 5, rush: false });
    await repo.put("c", { item: "pen", qty: 9, rush: false });

    expect((await repo.list()).length).toBe(3);
    const pens = await repo.where("item", "pen");
    expect(pens.map((e) => e.id).sort()).toEqual(["a", "c"]);
  });

  test("collections are isolated", async () => {
    const orders = store.repository<Order>("orders", OrderSchema);
    const other = store.repository<Order>("archived", OrderSchema);
    await orders.put("x", { item: "a", qty: 1, rush: false });
    expect(await other.get("x")).toBeNull();
  });

  test("delete removes the row", async () => {
    const repo = store.repository<Order>("orders", OrderSchema);
    await repo.put("d", { item: "a", qty: 1, rush: false });
    expect(await repo.delete("d")).toBe(true);
    expect(await repo.delete("d")).toBe(false);
    expect(await repo.has("d")).toBe(false);
  });

  test("transaction rolls back on error", async () => {
    const repo = store.repository<Order>("orders", OrderSchema);
    await repo.put("keep", { item: "a", qty: 1, rush: false });

    await expect(
      store.transaction(async (tx) => {
        const txRepo = tx.repository<Order>("orders", OrderSchema);
        await txRepo.put("temp", { item: "b", qty: 2, rush: false });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await repo.has("temp")).toBe(false);
    expect(await repo.has("keep")).toBe(true);
  });
});

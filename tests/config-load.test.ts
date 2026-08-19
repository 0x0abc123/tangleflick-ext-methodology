import { test, expect, describe } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/load.ts";

async function withConfig(
  contents: unknown,
  fn: (path: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tf-cfg-"));
  const path = join(dir, "config.json");
  await writeFile(
    path,
    typeof contents === "string" ? contents : JSON.stringify(contents),
  );
  try {
    await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("loadConfig", () => {
  test("accepts a valid emitter + sqlite config", async () => {
    await withConfig(
      { app: { name: "app" }, bus: { type: "emitter" }, store: { type: "sqlite" } },
      async (path) => {
        const config = await loadConfig(path);
        expect(config.bus.type).toBe("emitter");
        expect(config.store.type).toBe("sqlite");
        // Defaults are applied.
        expect(config.app.logLevel).toBe("info");
        if (config.store.type === "sqlite") {
          expect(config.store.path).toBe("./data/tangleflick.db");
        }
      },
    );
  });

  test("validates required fields per discriminant (kafka needs brokers)", async () => {
    await withConfig(
      { bus: { type: "kafka" }, store: { type: "sqlite" } },
      async (path) => {
        await expect(loadConfig(path)).rejects.toThrow(/brokers/);
      },
    );
  });

  test("rejects an unknown bus type", async () => {
    await withConfig(
      { bus: { type: "rabbit" }, store: { type: "sqlite" } },
      async (path) => {
        await expect(loadConfig(path)).rejects.toThrow(/Invalid config/);
      },
    );
  });

  test("rejects non-JSON", async () => {
    await withConfig("{ not json", async (path) => {
      await expect(loadConfig(path)).rejects.toThrow(/not valid JSON/);
    });
  });

  test("errors clearly when the file is missing", async () => {
    await expect(loadConfig("/no/such/config.json")).rejects.toThrow(/not found/);
  });
});

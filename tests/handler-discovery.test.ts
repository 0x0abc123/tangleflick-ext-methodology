import { test, expect, describe } from "bun:test";
import { discoverHandlers } from "../src/core/handler/discover.ts";
import { discoverEventDefinitions } from "../src/core/events/discover.ts";
import { createLogger } from "../src/logger.ts";

const logger = createLogger("error");

describe("auto-discovery", () => {
  test("discovers the example handler in handlers/", async () => {
    const handlers = await discoverHandlers(logger, "handlers");
    const types = handlers.map((h) => h.handler.eventType);
    expect(types).toContain("example.created");
  });

  test("discovers event definitions in events/", async () => {
    const defs = await discoverEventDefinitions(logger, "events");
    const types = defs.map((d) => d.type).sort();
    expect(types).toEqual(["example.created", "example.processed"]);
  });
});

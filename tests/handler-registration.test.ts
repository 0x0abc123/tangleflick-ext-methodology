import { test, expect, describe } from "bun:test";
import { z } from "zod";
import { registerHandlers } from "../src/core/handler/register.ts";
import { defineHandler } from "../src/core/handler/types.ts";
import type { DiscoveredHandler } from "../src/core/handler/discover.ts";
import type {
  EventBus,
  EventListener,
  SubscribeOptions,
  Subscription,
} from "../src/core/ports/event-bus.ts";
import type { DataStore } from "../src/core/ports/data-store.ts";
import { createLogger } from "../src/logger.ts";

function fakeBus() {
  const calls: Array<{ eventType: string; opts?: SubscribeOptions }> = [];
  const bus: EventBus = {
    async connect() {},
    async disconnect() {},
    async publish() {},
    async subscribe<T>(
      eventType: string,
      _listener: EventListener<T>,
      opts?: SubscribeOptions,
    ): Promise<Subscription> {
      calls.push({ eventType, opts });
      return { unsubscribe: async () => {} };
    },
  };
  return { bus, calls };
}

const schema = z.object({ v: z.string() });
const mk = (id: string, eventType: string, group?: string): DiscoveredHandler => ({
  id,
  path: `/handlers/${id}.handler.ts`,
  handler: defineHandler({ eventType, schema, group, handle: async () => {} }),
});

const deps = (bus: EventBus) => ({
  bus,
  store: {} as DataStore,
  logger: createLogger("error"),
});

describe("registerHandlers consumer identity", () => {
  test("distinct handlers on the same event type get distinct consumerIds (fan-out)", async () => {
    const { bus, calls } = fakeBus();
    await registerHandlers([mk("a", "same.type"), mk("b", "same.type")], deps(bus));

    expect(calls.map((c) => c.eventType)).toEqual(["same.type", "same.type"]);
    expect(calls.map((c) => c.opts?.consumerId).sort()).toEqual(["a", "b"]);
    // No shared group → each is an independent consumer.
    expect(calls.every((c) => c.opts?.group === undefined)).toBe(true);
  });

  test("an explicit group is passed through for shared consumption", async () => {
    const { bus, calls } = fakeBus();
    await registerHandlers([mk("c", "t", "billing")], deps(bus));

    expect(calls[0]?.opts).toMatchObject({ consumerId: "c", group: "billing" });
  });
});

import { test, expect, describe } from "bun:test";
import { z } from "zod";
import { EventRegistry } from "../src/core/events/registry.ts";
import { JsonCodec } from "../src/core/serialization/json-codec.ts";
import { EmitterBus } from "../src/adapters/emitter/emitter-bus.ts";
import { createLogger } from "../src/logger.ts";
import type { EventEnvelope } from "../src/core/events/envelope.ts";

function makeBus() {
  const registry = new EventRegistry();
  registry.register("ping", z.object({ n: z.number() }));
  const codec = new JsonCodec(registry);
  const logger = createLogger("error");
  return new EmitterBus({ codec, source: "test", logger });
}

describe("EmitterBus", () => {
  test("delivers a published event to a subscriber", async () => {
    const bus = makeBus();
    await bus.connect();

    const received = new Promise<EventEnvelope<{ n: number }>>((resolve) => {
      void bus.subscribe<{ n: number }>("ping", async (env) => resolve(env));
    });

    await bus.publish("ping", { n: 42 });
    const env = await received;

    expect(env.type).toBe("ping");
    expect(env.payload.n).toBe(42);
    expect(env.source).toBe("test");
    await bus.disconnect();
  });

  test("fans out to every subscriber on the same event type", async () => {
    const bus = makeBus();
    await bus.connect();

    let a = 0;
    let b = 0;
    await bus.subscribe("ping", async () => {
      a++;
    });
    await bus.subscribe("ping", async () => {
      b++;
    });

    await bus.publish("ping", { n: 1 });
    await new Promise((r) => setTimeout(r, 20));

    expect(a).toBe(1);
    expect(b).toBe(1);
    await bus.disconnect();
  });

  test("unsubscribe stops delivery", async () => {
    const bus = makeBus();
    await bus.connect();

    let count = 0;
    const sub = await bus.subscribe("ping", async () => {
      count++;
    });
    await sub.unsubscribe();

    await bus.publish("ping", { n: 1 });
    await new Promise((r) => setTimeout(r, 20));

    expect(count).toBe(0);
    await bus.disconnect();
  });
});

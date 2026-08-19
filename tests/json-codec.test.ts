import { test, expect, describe } from "bun:test";
import { z } from "zod";
import { EventRegistry } from "../src/core/events/registry.ts";
import { JsonCodec, CodecError } from "../src/core/serialization/json-codec.ts";
import { createEnvelope } from "../src/core/events/envelope.ts";

function setup() {
  const registry = new EventRegistry();
  registry.register("user.created", z.object({ name: z.string(), age: z.number() }));
  return new JsonCodec(registry);
}

describe("JsonCodec", () => {
  test("round-trips an envelope", () => {
    const codec = setup();
    const env = createEnvelope({
      type: "user.created",
      payload: { name: "Ada", age: 36 },
      source: "test",
    });

    const decoded = codec.decode(codec.encode(env));

    expect(decoded.id).toBe(env.id);
    expect(decoded.type).toBe("user.created");
    expect(decoded.payload).toEqual({ name: "Ada", age: 36 });
  });

  test("rejects an invalid payload on encode", () => {
    const codec = setup();
    const env = createEnvelope({
      type: "user.created",
      payload: { name: "Ada", age: "not-a-number" },
      source: "test",
    });
    expect(() => codec.encode(env)).toThrow(CodecError);
  });

  test("rejects an unknown event type", () => {
    const codec = setup();
    const env = createEnvelope({ type: "unknown.type", payload: {}, source: "test" });
    expect(() => codec.encode(env)).toThrow(/No schema registered/);
  });

  test("rejects malformed JSON on decode", () => {
    const codec = setup();
    expect(() => codec.decode(new TextEncoder().encode("{not json"))).toThrow(CodecError);
  });

  test("registry rejects conflicting schemas for a type", () => {
    const registry = new EventRegistry();
    registry.register("x", z.string());
    expect(() => registry.register("x", z.number())).toThrow(/Conflicting schema/);
  });
});

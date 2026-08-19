import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { EventRegistry } from "../src/core/events/registry.ts";
import { JsonCodec } from "../src/core/serialization/json-codec.ts";
import { EmitterBus } from "../src/adapters/emitter/emitter-bus.ts";
import { HttpIngress } from "../src/http/server.ts";
import type { HttpConfig } from "../src/config/schema.ts";
import { createLogger } from "../src/logger.ts";

function makeBus() {
  const registry = new EventRegistry();
  registry.register("webhook.test", z.object({ value: z.string() }));
  const codec = new JsonCodec(registry);
  return new EmitterBus({ codec, source: "test", logger: createLogger("error") });
}

const baseHttp = (auth: HttpConfig["auth"]): HttpConfig => ({
  enabled: true,
  host: "127.0.0.1",
  port: 0,
  path: "/webhook",
  allowedEvents: ["webhook.test"],
  maxBodyBytes: 1_048_576,
  auth,
});

describe("HttpIngress — API key auth", () => {
  const bus = makeBus();
  const ingress = new HttpIngress({
    config: baseHttp({ type: "apiKey", header: "authorization", scheme: "Bearer", token: "s3cret" }),
    bus,
    logger: createLogger("error"),
  });
  let base: string;

  beforeAll(async () => {
    await bus.connect();
    ingress.start();
    base = `http://127.0.0.1:${ingress.port}`;
  });
  afterAll(async () => {
    await ingress.stop();
    await bus.disconnect();
  });

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  test("rejects a request with no credential (401)", async () => {
    const res = await post({ type: "webhook.test", payload: { value: "x" } });
    expect(res.status).toBe(401);
  });

  test("rejects a wrong credential (401)", async () => {
    const res = await post(
      { type: "webhook.test", payload: { value: "x" } },
      { authorization: "Bearer wrong" },
    );
    expect(res.status).toBe(401);
  });

  test("accepts a valid request and publishes to the bus (202)", async () => {
    const delivered = new Promise<{ value: string }>((resolve) => {
      void bus.subscribe<{ value: string }>("webhook.test", async (env) => resolve(env.payload));
    });

    const res = await post(
      { type: "webhook.test", payload: { value: "hello" } },
      { authorization: "Bearer s3cret" },
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, type: "webhook.test" });
    expect((await delivered).value).toBe("hello");
  });

  test("rejects an event type not in the allowlist (403)", async () => {
    const res = await post(
      { type: "other.event", payload: {} },
      { authorization: "Bearer s3cret" },
    );
    expect(res.status).toBe(403);
  });

  test("rejects an invalid payload against the schema (400)", async () => {
    const res = await post(
      { type: "webhook.test", payload: { value: 123 } },
      { authorization: "Bearer s3cret" },
    );
    expect(res.status).toBe(400);
  });

  test("rejects malformed JSON (400)", async () => {
    const res = await post("{ not json", { authorization: "Bearer s3cret" });
    expect(res.status).toBe(400);
  });

  test("health check responds 200", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
  });

  test("unknown path is 404, wrong method is 405", async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/webhook`, { method: "GET" })).status).toBe(405);
  });
});

describe("HttpIngress — HMAC auth", () => {
  const bus = makeBus();
  const secret = "hmac-secret";
  const ingress = new HttpIngress({
    config: baseHttp({
      type: "hmac",
      header: "x-signature",
      algorithm: "sha256",
      secret,
      encoding: "hex",
      prefix: "",
    }),
    bus,
    logger: createLogger("error"),
  });
  let base: string;

  beforeAll(async () => {
    await bus.connect();
    ingress.start();
    base = `http://127.0.0.1:${ingress.port}`;
  });
  afterAll(async () => {
    await ingress.stop();
    await bus.disconnect();
  });

  test("accepts a correctly signed body (202)", async () => {
    const body = JSON.stringify({ type: "webhook.test", payload: { value: "signed" } });
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    const res = await fetch(`${base}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": sig },
      body,
    });
    expect(res.status).toBe(202);
  });

  test("rejects a bad signature (401)", async () => {
    const body = JSON.stringify({ type: "webhook.test", payload: { value: "signed" } });
    const res = await fetch(`${base}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": "deadbeef" },
      body,
    });
    expect(res.status).toBe(401);
  });
});

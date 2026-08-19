import type { HttpConfig } from "../config/schema.ts";
import type { EventBus } from "../core/ports/event-bus.ts";
import { CodecError } from "../core/serialization/json-codec.ts";
import { createAuthenticator, type WebhookAuthenticator } from "./auth.ts";
import type { Logger } from "../logger.ts";

export interface HttpIngressDeps {
  config: HttpConfig;
  bus: EventBus;
  logger: Logger;
}

interface WebhookBody {
  type: string;
  payload: unknown;
}

/**
 * Inbound HTTP ingress: turns authenticated webhook POSTs into events on the
 * bus. Request shape is `{ type, payload }`; only event types in the config
 * allowlist are accepted, and the payload is validated by the bus's codec
 * against the registered schema for that type.
 */
export class HttpIngress {
  private server?: ReturnType<typeof Bun.serve>;
  private readonly auth: WebhookAuthenticator;
  private readonly allowed: Set<string>;

  constructor(private readonly deps: HttpIngressDeps) {
    this.auth = createAuthenticator(deps.config.auth);
    this.allowed = new Set(deps.config.allowedEvents);
  }

  start(): void {
    const { host, port } = this.deps.config;
    this.server = Bun.serve({
      hostname: host,
      port,
      fetch: (req) => this.handle(req),
    });
    this.deps.logger.info("http ingress listening", {
      url: `http://${host}:${this.server.port}${this.deps.config.path}`,
      auth: this.deps.config.auth.type,
      allowedEvents: this.deps.config.allowedEvents,
    });
    if (this.allowed.size === 0) {
      this.deps.logger.warn("http.allowedEvents is empty — every request will be rejected");
    }
  }

  async stop(): Promise<void> {
    await this.server?.stop(true);
    this.deps.logger.info("http ingress stopped");
  }

  /** Actual listening port (useful when configured with port 0 in tests). */
  get port(): number | undefined {
    return this.server?.port;
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return json(200, { status: "ok" });
    }
    if (url.pathname !== this.deps.config.path) {
      return json(404, { error: "not found" });
    }
    if (req.method !== "POST") {
      return json(405, { error: "method not allowed" });
    }

    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody) > this.deps.config.maxBodyBytes) {
      return json(413, { error: "payload too large" });
    }

    // 1. Authenticate (before parsing/publishing anything).
    const auth = this.auth.authenticate(req.headers, rawBody);
    if (!auth.ok) {
      this.deps.logger.warn("webhook auth failed", { reason: auth.reason });
      return json(401, { error: "unauthorized" });
    }

    // 2. Parse and shape-check the body.
    let body: WebhookBody;
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof (parsed as WebhookBody).type !== "string"
      ) {
        return json(400, { error: "body must be { type: string, payload: ... }" });
      }
      body = parsed as WebhookBody;
    } catch {
      return json(400, { error: "invalid JSON" });
    }

    // 3. Enforce the allowlist.
    if (!this.allowed.has(body.type)) {
      this.deps.logger.warn("webhook event type not allowed", { type: body.type });
      return json(403, { error: `event type "${body.type}" is not allowed` });
    }

    // 4. Publish (the bus's codec validates the payload against its schema).
    try {
      await this.deps.bus.publish(body.type, body.payload, {
        correlationId: req.headers.get("x-correlation-id") ?? undefined,
      });
    } catch (err) {
      if (err instanceof CodecError) {
        return json(400, { error: err.message });
      }
      this.deps.logger.error("webhook publish failed", {
        type: body.type,
        error: (err as Error).message,
      });
      return json(500, { error: "internal error" });
    }

    return json(202, { accepted: true, type: body.type });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

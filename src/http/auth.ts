import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import type { HttpAuthConfig } from "../config/schema.ts";

export interface AuthResult {
  ok: boolean;
  reason?: string;
}

/**
 * Authenticates an inbound webhook request. Implementations are selected by
 * config; the HTTP ingress calls `authenticate` before publishing anything.
 */
export interface WebhookAuthenticator {
  authenticate(headers: Headers, rawBody: string): AuthResult;
}

/** Resolve a config secret, supporting the `env:VAR_NAME` indirection. */
export function resolveSecret(value: string): string {
  if (value.startsWith("env:")) {
    const name = value.slice(4);
    const resolved = process.env[name];
    if (!resolved) {
      throw new Error(`Webhook secret env var "${name}" is not set`);
    }
    return resolved;
  }
  return value;
}

/**
 * Constant-time string comparison. Both sides are hashed to a fixed length
 * first so differing input lengths don't leak via timing or throw.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

class ApiKeyAuthenticator implements WebhookAuthenticator {
  private readonly header: string;
  private readonly expected: string;

  constructor(config: Extract<HttpAuthConfig, { type: "apiKey" }>) {
    this.header = config.header.toLowerCase();
    const token = resolveSecret(config.token);
    this.expected = config.scheme ? `${config.scheme} ${token}` : token;
  }

  authenticate(headers: Headers): AuthResult {
    const provided = headers.get(this.header);
    if (!provided) return { ok: false, reason: "missing credential" };
    return safeEqual(provided, this.expected)
      ? { ok: true }
      : { ok: false, reason: "invalid credential" };
  }
}

class HmacAuthenticator implements WebhookAuthenticator {
  private readonly header: string;

  constructor(private readonly config: Extract<HttpAuthConfig, { type: "hmac" }>) {
    this.header = config.header.toLowerCase();
  }

  authenticate(headers: Headers, rawBody: string): AuthResult {
    const provided = headers.get(this.header);
    if (!provided) return { ok: false, reason: "missing signature" };

    const secret = resolveSecret(this.config.secret);
    const expected = createHmac(this.config.algorithm, secret)
      .update(rawBody)
      .digest(this.config.encoding);

    const stripped = this.config.prefix
      ? provided.replace(new RegExp(`^${escapeRegExp(this.config.prefix)}`), "")
      : provided;

    return safeEqual(stripped, expected)
      ? { ok: true }
      : { ok: false, reason: "invalid signature" };
  }
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createAuthenticator(config: HttpAuthConfig): WebhookAuthenticator {
  switch (config.type) {
    case "apiKey":
      return new ApiKeyAuthenticator(config);
    case "hmac":
      return new HmacAuthenticator(config);
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unknown auth type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

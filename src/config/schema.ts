import { z } from "zod";

/**
 * Configuration schema. This is the single source of truth for both the shape
 * of config/config.json AND its runtime validation. `bus` and `store` are
 * discriminated unions on `type`, so only the block relevant to the selected
 * backend is required/validated.
 */

const AppSchema = z.object({
  name: z.string().min(1).default("tangleflick"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

/* ------------------------------- Event bus -------------------------------- */

const EmitterBusSchema = z.object({
  type: z.literal("emitter"),
});

const KafkaBusSchema = z.object({
  type: z.literal("kafka"),
  brokers: z.array(z.string().min(1)).min(1),
  clientId: z.string().min(1).default("tangleflick"),
  /** Default consumer group; a handler may override via its `group`. */
  groupId: z.string().min(1).default("tangleflick"),
  ssl: z.boolean().default(false),
});

const NatsBusSchema = z.object({
  type: z.literal("nats"),
  servers: z.array(z.string().min(1)).min(1),
  /** JetStream stream that subjects are published to / consumed from. */
  stream: z.string().min(1).default("EVENTS"),
  /** Prefix for durable consumer names (durable = `${prefix}_${group}`). */
  durablePrefix: z.string().min(1).default("tangleflick"),
});

const BusSchema = z.discriminatedUnion("type", [
  EmitterBusSchema,
  KafkaBusSchema,
  NatsBusSchema,
]);

/* ------------------------------- Data store ------------------------------- */

const SqliteStoreSchema = z.object({
  type: z.literal("sqlite"),
  path: z.string().min(1).default("./data/tangleflick.db"),
});

const PostgresStoreSchema = z.object({
  type: z.literal("postgres"),
  url: z.string().min(1),
});

const StoreSchema = z.discriminatedUnion("type", [
  SqliteStoreSchema,
  PostgresStoreSchema,
]);

/* --------------------------- HTTP webhook ingress ------------------------- */

// Secrets may be given literally or as "env:VAR_NAME" to read from the
// environment (resolved in src/http/auth.ts).
const SecretSchema = z.string().min(1);

const ApiKeyAuthSchema = z.object({
  type: z.literal("apiKey"),
  /** Header carrying the credential. */
  header: z.string().min(1).default("authorization"),
  /** Scheme prefix expected before the token (e.g. "Bearer "). "" = raw value. */
  scheme: z.string().default("Bearer"),
  token: SecretSchema,
});

const HmacAuthSchema = z.object({
  type: z.literal("hmac"),
  /** Header carrying the signature. */
  header: z.string().min(1).default("x-signature"),
  algorithm: z.enum(["sha256", "sha1", "sha512"]).default("sha256"),
  secret: SecretSchema,
  encoding: z.enum(["hex", "base64"]).default("hex"),
  /** Optional signature prefix to strip before comparing (e.g. "sha256="). */
  prefix: z.string().default(""),
});

const HttpAuthSchema = z.discriminatedUnion("type", [
  ApiKeyAuthSchema,
  HmacAuthSchema,
]);

const HttpSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().default("0.0.0.0"),
  port: z.number().int().positive().default(3000),
  /** Path the webhook accepts POSTs on. */
  path: z.string().min(1).default("/webhook"),
  /** Only these event types may be published via the webhook. */
  allowedEvents: z.array(z.string().min(1)).default([]),
  /** Reject bodies larger than this many bytes. */
  maxBodyBytes: z.number().int().positive().default(1_048_576),
  auth: HttpAuthSchema,
});

/* --------------------------------- Root ----------------------------------- */

export const ConfigSchema = z.object({
  app: AppSchema.default({}),
  bus: BusSchema,
  store: StoreSchema,
  http: HttpSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type BusConfig = z.infer<typeof BusSchema>;
export type StoreConfig = z.infer<typeof StoreSchema>;
export type AppConfig = z.infer<typeof AppSchema>;
export type HttpConfig = z.infer<typeof HttpSchema>;
export type HttpAuthConfig = z.infer<typeof HttpAuthSchema>;

import type { ZodType } from "zod";
import type { EventEnvelope } from "../events/envelope.ts";
import type { EventBus } from "../ports/event-bus.ts";
import type { DataStore } from "../ports/data-store.ts";
import type { Logger } from "../../logger.ts";

/**
 * Everything a handler needs to do its job, injected by the framework:
 *  - publish: emit new events back onto the same bus
 *  - store:   read/write shared persisted state
 *  - logger:  structured logging, pre-bound with the handler's event type
 */
export interface HandlerContext {
  publish: EventBus["publish"];
  store: DataStore;
  logger: Logger;
}

/**
 * The contract users implement. Drop a file exporting one of these (as the
 * default export) into `handlers/` and the framework auto-discovers, validates
 * and subscribes it.
 */
export interface EventHandler<T = unknown> {
  /** The event type this handler subscribes to (topic / subject / channel). */
  eventType: string;
  /** Zod schema for the payload — drives both TS typing and runtime validation. */
  schema: ZodType<T>;
  /** Optional consumer group for load-balanced / durable delivery. */
  group?: string;
  /** Process a single event. Throwing signals a processing failure. */
  handle(event: EventEnvelope<T>, ctx: HandlerContext): Promise<void>;
}

/**
 * Helper for defining a handler with full type-inference from the schema.
 * Usage: `export default defineHandler({ eventType, schema, handle })`.
 */
export function defineHandler<T>(handler: EventHandler<T>): EventHandler<T> {
  return handler;
}

/** Runtime shape check used by the discovery loader. */
export function isEventHandler(value: unknown): value is EventHandler {
  if (typeof value !== "object" || value === null) return false;
  const h = value as Record<string, unknown>;
  return (
    typeof h.eventType === "string" &&
    typeof h.handle === "function" &&
    typeof h.schema === "object" &&
    h.schema !== null
  );
}

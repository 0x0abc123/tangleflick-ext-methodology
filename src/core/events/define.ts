import type { ZodType } from "zod";

/**
 * Binds an event type string to its payload schema. Put these in `events/` so
 * they can be imported by handlers AND registered for publish-side validation
 * even when no local handler consumes the event (e.g. events produced for other
 * services to consume).
 */
export interface EventDefinition<T> {
  type: string;
  schema: ZodType<T>;
}

export function defineEvent<T>(type: string, schema: ZodType<T>): EventDefinition<T> {
  return { type, schema };
}

export function isEventDefinition(value: unknown): value is EventDefinition<unknown> {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.type === "string" &&
    typeof d.schema === "object" &&
    d.schema !== null &&
    typeof (d.schema as { safeParse?: unknown }).safeParse === "function"
  );
}

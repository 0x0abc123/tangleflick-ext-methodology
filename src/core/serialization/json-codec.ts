import type { ZodType } from "zod";
import {
  EnvelopeMetaSchema,
  type EventEnvelope,
} from "../events/envelope.ts";
import type { EventRegistry } from "../events/registry.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class CodecError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CodecError";
  }
}

/**
 * Serializes envelopes to/from bytes as JSON, validating the payload against
 * the registered Zod schema for the event type. This is the one place the wire
 * format lives, so every adapter shares identical (de)serialization + validation.
 */
export class JsonCodec {
  constructor(private readonly registry: EventRegistry) {}

  encode(envelope: EventEnvelope): Uint8Array {
    this.validatePayload(envelope.type, envelope.payload);
    return encoder.encode(JSON.stringify(envelope));
  }

  decode(bytes: Uint8Array | ArrayBuffer): EventEnvelope {
    const text =
      bytes instanceof ArrayBuffer
        ? decoder.decode(new Uint8Array(bytes))
        : decoder.decode(bytes);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new CodecError("Message is not valid JSON", { cause: err });
    }

    const meta = EnvelopeMetaSchema.safeParse(parsed);
    if (!meta.success) {
      throw new CodecError(
        `Malformed envelope: ${meta.error.issues.map((i) => i.message).join(", ")}`,
      );
    }

    const envelope = meta.data as EventEnvelope;
    envelope.payload = this.validatePayload(envelope.type, envelope.payload);
    return envelope;
  }

  /** Validate (and parse-normalize) a payload against its event type's schema. */
  private validatePayload(eventType: string, payload: unknown): unknown {
    const schema = this.registry.get(eventType);
    if (!schema) {
      throw new CodecError(
        `No schema registered for event type "${eventType}". ` +
          `Is a handler for it registered?`,
      );
    }
    return parseWith(schema, eventType, payload);
  }
}

/** Standalone payload validation helper (used by handler registration too). */
export function parseWith<T>(
  schema: ZodType<T>,
  eventType: string,
  payload: unknown,
): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new CodecError(
      `Invalid payload for event type "${eventType}": ` +
        result.error.issues
          .map((i) => `${i.path.join(".") || "(payload)"}: ${i.message}`)
          .join(", "),
    );
  }
  return result.data;
}

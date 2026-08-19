import { z } from "zod";

/**
 * Every message on every transport is wrapped in this normalized envelope, so
 * metadata is uniform whether it travelled over Kafka, NATS or the in-process
 * emitter. Only `payload` is transport/domain-specific; the rest is framework
 * metadata.
 */
export interface EventEnvelope<T = unknown> {
  /** Unique message id (crypto.randomUUID). */
  id: string;
  /** Event type — also the Kafka topic / NATS subject / emitter channel. */
  type: string;
  /** ISO-8601 timestamp of when the envelope was created. */
  time: string;
  /** Logical origin of the event (the app name from config). */
  source: string;
  /** Optional id for tracing a chain of related events. */
  correlationId?: string;
  /** Free-form string headers. */
  headers?: Record<string, string>;
  /** The domain payload — validated against a Zod schema by the codec. */
  payload: T;
}

/** Zod schema for the envelope metadata (payload validated separately). */
export const EnvelopeMetaSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  time: z.string().min(1),
  source: z.string().min(1),
  correlationId: z.string().optional(),
  headers: z.record(z.string()).optional(),
  payload: z.unknown(),
});

export interface CreateEnvelopeInput<T> {
  type: string;
  payload: T;
  source: string;
  correlationId?: string;
  headers?: Record<string, string>;
}

/** Build a fully-populated envelope, filling in id + time. */
export function createEnvelope<T>(input: CreateEnvelopeInput<T>): EventEnvelope<T> {
  return {
    id: crypto.randomUUID(),
    type: input.type,
    time: new Date().toISOString(),
    source: input.source,
    correlationId: input.correlationId,
    headers: input.headers,
    payload: input.payload,
  };
}

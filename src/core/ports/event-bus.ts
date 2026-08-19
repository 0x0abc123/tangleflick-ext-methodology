import type { EventEnvelope } from "../events/envelope.ts";

export interface Subscription {
  unsubscribe(): Promise<void>;
}

export interface PublishOptions {
  /** Partition/ordering key (Kafka) — ignored by transports that lack one. */
  key?: string;
  correlationId?: string;
  headers?: Record<string, string>;
}

export interface SubscribeOptions {
  /**
   * Shared-consumption group. Subscribers that pass the SAME `group` (across
   * handlers or across instances) share the workload — each event is handled by
   * only one of them (load-balanced). Omit for fan-out: the subscription gets
   * its own consumer identity and receives every event independently.
   */
  group?: string;
  /**
   * Stable unique identity for this subscription, used to derive a per-handler
   * consumer name on durable transports (Kafka groupId / NATS durable) when no
   * `group` is set. The registration layer passes the handler's id here so two
   * distinct handlers on the same event type each get their own consumer (true
   * fan-out) rather than accidentally sharing one. Ignored by the emitter.
   */
  consumerId?: string;
}

/**
 * Callback invoked for each received event, with the decoded + validated
 * envelope. The handler context (publish-back / store / logger) is bound by
 * the registration layer in a closure, keeping the bus decoupled from the store.
 */
export type EventListener<T = unknown> = (
  event: EventEnvelope<T>,
) => Promise<void>;

/**
 * The event bus port. Consumers of the bus depend ONLY on this interface;
 * the concrete transport (emitter / kafka / nats) is chosen by config via the
 * bus factory and is invisible here.
 */
export interface EventBus {
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /** Publish a payload under an event type. The bus wraps it in an envelope. */
  publish<T>(eventType: string, payload: T, opts?: PublishOptions): Promise<void>;

  /** Subscribe a listener to an event type. Returns a handle to unsubscribe. */
  subscribe<T>(
    eventType: string,
    listener: EventListener<T>,
    opts?: SubscribeOptions,
  ): Promise<Subscription>;
}

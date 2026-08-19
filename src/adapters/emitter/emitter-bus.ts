import { EventEmitter } from "node:events";
import type {
  EventBus,
  EventListener,
  PublishOptions,
  SubscribeOptions,
  Subscription,
} from "../../core/ports/event-bus.ts";
import { createEnvelope, type EventEnvelope } from "../../core/events/envelope.ts";
import type { JsonCodec } from "../../core/serialization/json-codec.ts";
import type { Logger } from "../../logger.ts";

export interface EmitterBusDeps {
  codec: JsonCodec;
  source: string;
  logger: Logger;
}

/**
 * In-process event bus backed by node:events. Default transport for dev/test —
 * no external server. Messages still pass through the codec (encode→decode) so
 * payload validation behaves identically to the networked transports.
 *
 * Note: consumer groups are a distributed concept; in-process every subscriber
 * to a type receives every event (fan-out). `group` is accepted but ignored.
 */
export class EmitterBus implements EventBus {
  private readonly emitter = new EventEmitter();

  constructor(private readonly deps: EmitterBusDeps) {
    // A single process can legitimately have many handlers on one event type.
    this.emitter.setMaxListeners(0);
  }

  async connect(): Promise<void> {
    this.deps.logger.info("emitter bus connected");
  }

  async disconnect(): Promise<void> {
    this.emitter.removeAllListeners();
    this.deps.logger.info("emitter bus disconnected");
  }

  async publish<T>(
    eventType: string,
    payload: T,
    opts?: PublishOptions,
  ): Promise<void> {
    const envelope = createEnvelope({
      type: eventType,
      payload,
      source: this.deps.source,
      correlationId: opts?.correlationId,
      headers: opts?.headers,
    });
    // Encoding validates the payload against the registered schema.
    const bytes = this.deps.codec.encode(envelope);
    // Emit asynchronously so publish() doesn't run handlers on its own stack.
    queueMicrotask(() => this.emitter.emit(eventType, bytes));
  }

  async subscribe<T>(
    eventType: string,
    listener: EventListener<T>,
    _opts?: SubscribeOptions,
  ): Promise<Subscription> {
    const onMessage = (bytes: Uint8Array): void => {
      let envelope: EventEnvelope<T>;
      try {
        envelope = this.deps.codec.decode(bytes) as EventEnvelope<T>;
      } catch (err) {
        this.deps.logger.error("failed to decode message", {
          eventType,
          error: (err as Error).message,
        });
        return;
      }
      void listener(envelope).catch((err: unknown) => {
        this.deps.logger.error("handler threw", {
          eventType,
          error: (err as Error).message,
        });
      });
    };

    this.emitter.on(eventType, onMessage);
    this.deps.logger.debug("subscribed", { eventType });

    return {
      unsubscribe: async () => {
        this.emitter.off(eventType, onMessage);
      },
    };
  }
}

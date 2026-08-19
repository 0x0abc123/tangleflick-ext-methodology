import { Kafka, logLevel, type Consumer, type Producer } from "kafkajs";
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

interface KafkaBusConfig {
  type: "kafka";
  brokers: string[];
  clientId: string;
  groupId: string;
  ssl: boolean;
}

export interface KafkaBusDeps {
  config: KafkaBusConfig;
  codec: JsonCodec;
  source: string;
  logger: Logger;
}

/**
 * Kafka-backed event bus (kafkajs). Event type == topic. Each subscription runs
 * its own consumer under a group id (handler `group` overrides the config
 * default), giving Kafka's load-balanced delivery across instances.
 */
export class KafkaBus implements EventBus {
  private readonly kafka: Kafka;
  private producer!: Producer;
  private readonly consumers: Consumer[] = [];

  constructor(private readonly deps: KafkaBusDeps) {
    this.kafka = new Kafka({
      clientId: deps.config.clientId,
      brokers: deps.config.brokers,
      ssl: deps.config.ssl,
      logLevel: logLevel.NOTHING,
    });
  }

  async connect(): Promise<void> {
    this.producer = this.kafka.producer({ allowAutoTopicCreation: true });
    await this.producer.connect();
    this.deps.logger.info("kafka producer connected", {
      brokers: this.deps.config.brokers,
    });
  }

  async disconnect(): Promise<void> {
    await Promise.allSettled(this.consumers.map((c) => c.disconnect()));
    await this.producer?.disconnect();
    this.deps.logger.info("kafka bus disconnected");
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
    const value = Buffer.from(this.deps.codec.encode(envelope));
    await this.producer.send({
      topic: eventType,
      messages: [{ key: opts?.key, value, headers: opts?.headers }],
    });
  }

  async subscribe<T>(
    eventType: string,
    listener: EventListener<T>,
    opts?: SubscribeOptions,
  ): Promise<Subscription> {
    // Event type == topic. The consumer group decides sharing: an explicit
    // `group` is shared/load-balanced; otherwise each handler gets its own
    // group (derived from consumerId) so distinct handlers fan out. The base
    // config.groupId namespaces all of them under this app.
    const consumerName = opts?.group ?? opts?.consumerId ?? "default";
    const groupId = `${this.deps.config.groupId}.${consumerName}`;
    const consumer = this.kafka.consumer({ groupId });
    await consumer.connect();
    await consumer.subscribe({ topic: eventType, fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;
        let envelope: EventEnvelope<T>;
        try {
          envelope = this.deps.codec.decode(message.value) as EventEnvelope<T>;
        } catch (err) {
          this.deps.logger.error("failed to decode kafka message", {
            eventType,
            error: (err as Error).message,
          });
          return; // don't crash the consumer loop on a poison message
        }
        // Throwing here makes kafkajs retry the message per its retry policy.
        await listener(envelope);
      },
    });

    this.consumers.push(consumer);
    this.deps.logger.info("kafka subscribed", { eventType, groupId });

    return {
      unsubscribe: async () => {
        await consumer.disconnect();
        const idx = this.consumers.indexOf(consumer);
        if (idx >= 0) this.consumers.splice(idx, 1);
      },
    };
  }
}

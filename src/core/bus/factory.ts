import type { BusConfig } from "../../config/schema.ts";
import type { EventBus } from "../ports/event-bus.ts";
import type { JsonCodec } from "../serialization/json-codec.ts";
import type { Logger } from "../../logger.ts";
import { EmitterBus } from "../../adapters/emitter/emitter-bus.ts";
import { KafkaBus } from "../../adapters/kafka/kafka-bus.ts";
import { NatsBus } from "../../adapters/nats/nats-bus.ts";

export interface BusDeps {
  codec: JsonCodec;
  /** Logical origin stamped onto published envelopes (app name). */
  source: string;
  logger: Logger;
}

/**
 * The ONLY place bus adapters are named. Selects the transport from config and
 * returns it typed as the EventBus port, so nothing downstream knows which
 * backend is in use.
 */
export function createBus(config: BusConfig, deps: BusDeps): EventBus {
  const logger = deps.logger.child({ component: "bus", bus: config.type });
  switch (config.type) {
    case "emitter":
      return new EmitterBus({ codec: deps.codec, source: deps.source, logger });
    case "kafka":
      return new KafkaBus({ config, codec: deps.codec, source: deps.source, logger });
    case "nats":
      return new NatsBus({ config, codec: deps.codec, source: deps.source, logger });
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unknown bus type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

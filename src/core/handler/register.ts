import type { EventBus, Subscription } from "../ports/event-bus.ts";
import type { DataStore } from "../ports/data-store.ts";
import type { EventEnvelope } from "../events/envelope.ts";
import type { DiscoveredHandler } from "./discover.ts";
import type { HandlerContext } from "./types.ts";
import type { Logger } from "../../logger.ts";

export interface RegisterDeps {
  bus: EventBus;
  store: DataStore;
  logger: Logger;
}

/**
 * Subscribes every discovered handler to the bus. Each subscription is wrapped
 * in a closure that binds a per-handler HandlerContext (publish + store +
 * scoped logger) — this is where the bus and the store come together without
 * either one depending on the other.
 */
export async function registerHandlers(
  handlers: DiscoveredHandler[],
  deps: RegisterDeps,
): Promise<Subscription[]> {
  const subscriptions: Subscription[] = [];

  for (const { handler, id } of handlers) {
    const logger = deps.logger.child({
      handler: id,
      eventType: handler.eventType,
      ...(handler.group ? { group: handler.group } : {}),
    });
    const ctx: HandlerContext = {
      publish: deps.bus.publish.bind(deps.bus),
      store: deps.store,
      logger,
    };

    const sub = await deps.bus.subscribe(
      handler.eventType,
      async (envelope: EventEnvelope) => {
        try {
          await handler.handle(envelope, ctx);
        } catch (err) {
          logger.error("handler failed", {
            eventId: envelope.id,
            error: (err as Error).message,
          });
          throw err; // let the transport decide on retry / DLQ semantics
        }
      },
      { consumerId: id, ...(handler.group ? { group: handler.group } : {}) },
    );

    subscriptions.push(sub);
    deps.logger.info("handler registered", {
      handler: id,
      eventType: handler.eventType,
      group: handler.group,
    });
  }

  return subscriptions;
}

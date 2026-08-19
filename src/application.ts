import { loadConfig } from "./config/load.ts";
import type { Config } from "./config/schema.ts";
import { createLogger, type Logger } from "./logger.ts";
import { EventRegistry } from "./core/events/registry.ts";
import { JsonCodec } from "./core/serialization/json-codec.ts";
import { createBus } from "./core/bus/factory.ts";
import { createStore } from "./core/store/factory.ts";
import { runMigrations } from "./core/store/migrator.ts";
import { isMigrationStore } from "./core/store/migration-store.ts";
import { discoverEventDefinitions } from "./core/events/discover.ts";
import { discoverHandlers } from "./core/handler/discover.ts";
import { registerHandlers } from "./core/handler/register.ts";
import { HttpIngress } from "./http/server.ts";
import type { EventBus, Subscription } from "./core/ports/event-bus.ts";
import type { DataStore } from "./core/ports/data-store.ts";

export interface ApplicationOptions {
  configPath?: string;
  eventsDir?: string;
  handlersDir?: string;
  migrationsDir?: string;
  /** Skip running migrations on start (e.g. when a separate step handles them). */
  skipMigrations?: boolean;
}

/**
 * Wires the framework together: config → store (+ migrate) → bus → handlers,
 * and manages graceful shutdown. `index.ts` is a thin wrapper around this.
 */
export class Application {
  logger!: Logger;
  config!: Config;
  bus!: EventBus;
  store!: DataStore;

  private subscriptions: Subscription[] = [];
  private ingress?: HttpIngress;
  private started = false;

  constructor(private readonly options: ApplicationOptions = {}) {}

  // Directory overrides are also threaded to event-definition discovery.
  private eventsDir(): string | undefined {
    return this.options.eventsDir;
  }

  async start(): Promise<void> {
    this.config = await loadConfig(this.options.configPath);
    this.logger = createLogger(this.config.app.logLevel, { app: this.config.app.name });
    this.logger.info("starting", { bus: this.config.bus.type, store: this.config.store.type });

    // 1. Discover event definitions + handlers, and build the schema registry.
    //    Event definitions cover published-but-not-locally-consumed types;
    //    handler schemas cover consumed types (they usually reference the same
    //    definition, so registration is idempotent).
    const eventDefs = await discoverEventDefinitions(this.logger, this.eventsDir());
    const handlers = await discoverHandlers(this.logger, this.options.handlersDir);
    const registry = new EventRegistry();
    for (const def of eventDefs) {
      registry.register(def.type, def.schema);
    }
    for (const { handler } of handlers) {
      registry.register(handler.eventType, handler.schema);
    }
    const codec = new JsonCodec(registry);

    // 2. Bring up the data store and run migrations.
    this.store = createStore(this.config.store, { logger: this.logger });
    await this.store.connect();
    if (!this.options.skipMigrations) {
      if (!isMigrationStore(this.store)) {
        throw new Error("Store does not support migrations");
      }
      await runMigrations(this.store, this.logger, this.options.migrationsDir);
    }

    // 3. Bring up the event bus.
    this.bus = createBus(this.config.bus, {
      codec,
      source: this.config.app.name,
      logger: this.logger,
    });
    await this.bus.connect();

    // 4. Subscribe handlers (binds publish + store into each context).
    this.subscriptions = await registerHandlers(handlers, {
      bus: this.bus,
      store: this.store,
      logger: this.logger,
    });

    // 5. Optionally accept events over HTTP (authenticated webhook ingress).
    if (this.config.http?.enabled) {
      this.ingress = new HttpIngress({
        config: this.config.http,
        bus: this.bus,
        logger: this.logger,
      });
      this.ingress.start();
    }

    this.started = true;
    this.logger.info("started", {
      handlers: handlers.length,
      http: this.config.http?.enabled ?? false,
    });
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.logger.info("shutting down");
    await this.ingress?.stop().catch(() => {});
    for (const sub of this.subscriptions) {
      await sub.unsubscribe().catch(() => {});
    }
    await this.bus.disconnect().catch(() => {});
    await this.store.disconnect().catch(() => {});
    this.started = false;
    this.logger.info("stopped");
  }

  /** Start, then block until SIGINT/SIGTERM, then shut down cleanly. */
  async run(): Promise<void> {
    await this.start();
    await new Promise<void>((resolve) => {
      const shutdown = (signal: string) => {
        this.logger.info("signal received", { signal });
        void this.stop().finally(resolve);
      };
      process.on("SIGINT", () => shutdown("SIGINT"));
      process.on("SIGTERM", () => shutdown("SIGTERM"));
    });
  }
}

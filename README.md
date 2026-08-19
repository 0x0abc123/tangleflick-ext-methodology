# tangleflick

A **Bun + TypeScript template framework** for building event-driven services.

Clone it, add your **event schemas** and **event handlers**, and the framework wires up
the rest: config loading, an **event bus**, and a **shared data store** — each selectable
by config and hidden behind stable **ports & adapters** so your handlers never depend on a
specific transport or database.

| Concern    | Default (embedded)      | External options            |
| ---------- | ----------------------- | --------------------------- |
| Event bus  | in-process `EventEmitter` | Kafka, NATS/JetStream       |
| Data store | SQLite (`bun:sqlite`)   | PostgreSQL (Bun native `SQL`) |

Handlers depend only on the `EventBus` and `DataStore` interfaces — switching Kafka↔NATS or
SQLite↔Postgres is a one-line config change, never a code change.

---

## Quick start

```bash
# 1. Install Bun (https://bun.sh) if you don't have it
curl -fsSL https://bun.sh/install | bash

# 2. Install dependencies
bun install

# 3. Create your config
cp config/config.example.json config/config.json

# 4. Run (defaults: emitter bus + embedded SQLite)
bun start
```

The bundled example handler subscribes to `example.created`, persists the payload, and
publishes `example.processed`.

> **New here?** Follow [`WALKTHROUGH.md`](./WALKTHROUGH.md) to build your first event flow
> step by step — write a schema and handler, emit an event back onto the bus, and run it.

```bash
bun test          # run the test suite
bun run typecheck # tsc --noEmit
bun run migrate   # apply pending migrations only
bun run dev       # run with --watch
```

---

## Architecture

```
config.json ─► Application ─► builds ─┬─► EventBus port  ◄─ emitter | kafka | nats
                                      └─► DataStore port ◄─ sqlite  | postgres
                                            ▲
              events/*.event.ts ─ schemas ──┤
              handlers/*.handler.ts ────────┘ (auto-discovered, subscribed)
```

- **Ports** (`src/core/ports/`) — the stable interfaces `EventBus` and `DataStore`.
- **Adapters** (`src/adapters/`) — concrete backends. The *only* places that name a backend
  are `src/core/bus/factory.ts` and `src/core/store/factory.ts`.
- **Envelope** — every message is wrapped in a normalized `EventEnvelope` (id, type, time,
  source, correlationId, headers, payload). All adapters share one JSON codec, so
  serialization and payload validation behave identically everywhere.

---

## Adding an event

Create a file under `events/` ending in `.event.ts`. Use `defineEvent` to bind an event
type to a Zod schema — this is your single source of truth for both the TypeScript type and
runtime validation.

```ts
// events/order.event.ts
import { z } from "zod";
import { defineEvent } from "../src/core/events/define.ts";

export const OrderPlaced = defineEvent(
  "order.placed",
  z.object({ orderId: z.string(), total: z.number().positive() }),
);
export type OrderPlacedPayload = z.infer<typeof OrderPlaced.schema>;
```

Event definitions are auto-registered at startup, so their types can be **published** and
validated even if no local handler consumes them (e.g. events for other services).

## Adding a handler

Create a file under `handlers/` ending in `.handler.ts` with a **default export** built by
`defineHandler`. It's auto-discovered and subscribed at startup.

```ts
// handlers/order.handler.ts
import { defineHandler } from "../src/core/handler/types.ts";
import { OrderPlaced, type OrderPlacedPayload } from "../events/order.event.ts";

export default defineHandler<OrderPlacedPayload>({
  eventType: OrderPlaced.type,
  schema: OrderPlaced.schema,
  // group: "billing",   // optional: consumer group / durable for load-balancing

  async handle(event, ctx) {
    // 1. process
    ctx.logger.info("order placed", { orderId: event.payload.orderId });

    // 2. persist state (same API on SQLite and Postgres)
    const orders = ctx.store.repository<OrderPlacedPayload>("orders");
    await orders.put(event.payload.orderId, event.payload);

    // 3. publish a follow-up event back onto the bus
    await ctx.publish("order.confirmed", { orderId: event.payload.orderId });
  },
});
```

Each handler receives a `HandlerContext`:

- `ctx.publish(type, payload, opts?)` — publish back onto the bus
- `ctx.store` — the shared `DataStore`
- `ctx.logger` — structured logger, pre-scoped to the handler

### Fan-out and consumer groups

**Multiple handlers can subscribe to the same event type** — by default every matching handler
runs for each event (fan-out). Just add more `*.handler.ts` files that declare the same
`eventType`. For example, `example.created` is handled by both `example.handler.ts` (which
processes and persists it) and `audit-created.handler.ts` (which records an audit entry).

This holds on **all** transports: each handler gets its own consumer identity (derived from
its filename), so on Kafka/NATS distinct handlers each receive every event rather than
accidentally sharing a subscription.

To make delivery **shared/load-balanced** instead of fanned out — so exactly one consumer
handles each event — give the relevant handlers the same `group`:

- **Same handler, many instances** (horizontal scaling): the framework already uses a stable
  per-handler identity, so N replicas of your service load-balance that handler's events
  automatically (Kafka consumer group / NATS queue group). No `group` needed.
- **Different handlers sharing work**: set the same `group` on each so they compete for events
  instead of all receiving them.

> `group` has no effect on the in-process emitter (it always fans out) — it's meaningful on
> Kafka and NATS. See [Delivery semantics](#delivery-semantics--backpressure).

> A single handler still subscribes to exactly one event type. To react to several types,
> use one handler file per type — and share logic between them as shown next.

### Sharing logic between handlers

Factor common behaviour into a plain function and reuse it as different handlers' `handle`.
A helper that accepts a generic `EventEnvelope` works for any payload shape. Put it in a file
that does **not** end in `.handler.ts` so it isn't auto-discovered as a handler:

```ts
// handlers/_shared.ts
import type { EventEnvelope } from "../src/core/events/envelope.ts";
import type { HandlerContext } from "../src/core/handler/types.ts";

export async function auditEvent(event: EventEnvelope, ctx: HandlerContext): Promise<void> {
  ctx.logger.info("audit", { type: event.type, id: event.id });
  const audit = ctx.store.repository("audit_log");
  await audit.put(event.id, {
    type: event.type,
    source: event.source,
    time: event.time,
    correlationId: event.correlationId ?? null,
  });
}
```

```ts
// handlers/audit-created.handler.ts — reuse the shared function as `handle`
import { defineHandler } from "../src/core/handler/types.ts";
import { ExampleCreated, type ExampleCreatedPayload } from "../events/example.event.ts";
import { auditEvent } from "./_shared.ts";

export default defineHandler<ExampleCreatedPayload>({
  eventType: ExampleCreated.type,
  schema: ExampleCreated.schema,
  handle: auditEvent,
});
```

`handlers/audit-processed.handler.ts` does the same for `example.processed` — two different
event types, one shared implementation. See these files in `handlers/` for the working
example.

## Delivery semantics & backpressure

There is **no framework-level queue** — how events are delivered, buffered, and retried is
entirely a property of the configured bus adapter. This differs significantly between
transports, so pick the one that matches your handlers' runtime characteristics.

| Transport | Handler invocation | Backlog lives | Backpressure | Concurrency | Durable / redelivery |
| --- | --- | --- | --- | --- | --- |
| **emitter** (default) | fire-and-forget (not awaited) | nowhere — in-flight promises in memory | ❌ none | unbounded | ❌ lost on crash; errors only logged |
| **kafka** | awaited per message | broker (topic retention) | ✅ via offset commits | 1 per partition | ✅ redelivered until committed |
| **nats** | awaited per message | JetStream stream | ✅ via `max_ack_pending` | 1 per subscription | ✅ `nak` → redelivered |

**If a handler is long-running:**

- **Emitter** — nothing blocks and nothing queues. `publish` dispatches immediately and the
  handler promise is *not* awaited, so a slow handler just means many handler invocations run
  concurrently (unbounded). A flood of events becomes unbounded in-memory work, and anything
  in flight is lost if the process exits. This is a dev/test transport — not intended for
  slow handlers under load.
- **Kafka** — the consumer awaits your handler and does not advance the offset until it
  resolves, so unprocessed events accumulate **durably on the broker** (consumer lag), not in
  memory. Backpressure is automatic; nothing is lost within retention. A throw leaves the
  offset uncommitted, so the message is redelivered.
- **NATS/JetStream** — the subscription awaits your handler, then acks. The backlog sits
  **durably in the stream**, and the server won't push more than `max_ack_pending` un-acked
  messages, so a slow handler creates back-pressure once that window fills. A throw triggers
  `nak` → redelivery.

**Guidance:** for long-running handlers in production use Kafka or NATS — you get a durable
backlog and real backpressure, and the same handler code runs unchanged. On the awaited
transports, throughput scales by adding partitions/consumers (Kafka) or subscriptions (NATS),
not by parallelism inside a single handler. The emitter offers no bounded-concurrency or queue
option today; that would need to be added to the adapter.

**Consumer identity (Kafka/NATS).** Each handler subscribes with its own stable identity
(derived from its filename), which becomes the Kafka `groupId` (namespaced under `bus.groupId`)
or the NATS durable/queue name. That's what makes fan-out correct — two handlers on the same
event type are independent consumers. Setting the same `group` on multiple subscriptions
overrides this so they share one consumer group instead (load-balanced). Because the identity
is stable (not random), multiple replicas of the same handler load-balance across instances
rather than duplicating work.

## Using the data store

`ctx.store.repository<T>(collection, schema?)` returns a collection-scoped key/value
`Repository<T>`:

```ts
const repo = ctx.store.repository<T>("things", ThingSchema); // schema optional
await repo.put(id, value);           // upsert
await repo.get(id);                  // T | null
await repo.has(id);                  // boolean
await repo.delete(id);               // boolean
await repo.list({ prefix, limit });  // Entry<T>[]
await repo.where("field", value);    // equality on a stored JSON field (string/number)
await ctx.store.transaction(async (tx) => { /* ... */ });
```

Values are stored as JSON in a generic `kv_store` table, so any collection works without
bespoke DDL. For richer relational queries, add your own tables via a migration.

---

## Configuration (`config/config.json`)

```jsonc
{
  "app": { "name": "tangleflick", "logLevel": "info" },
  "bus":  { "type": "emitter" },
  "store": { "type": "sqlite", "path": "./data/tangleflick.db" }
}
```

**Bus options**

```jsonc
{ "type": "emitter" }
{ "type": "kafka", "brokers": ["localhost:9092"], "clientId": "app", "groupId": "app", "ssl": false }
{ "type": "nats",  "servers": ["nats://localhost:4222"], "stream": "EVENTS", "durablePrefix": "app" }
```

`groupId` (Kafka) and `durablePrefix` (NATS) are **namespaces**, not the full consumer name:
each handler's consumer id is appended, so per-handler groups look like `app.<handler>` /
`app_<eventType>_<handler>`. See [Fan-out and consumer groups](#fan-out-and-consumer-groups).

**Store options**

```jsonc
{ "type": "sqlite", "path": "./data/tangleflick.db" }
{ "type": "postgres", "url": "postgres://user:pass@localhost:5432/tangleflick" }
```

Config is validated by a Zod schema (`src/config/schema.ts`) at startup; invalid config
fails fast with a readable error. Override the path with `TANGLEFLICK_CONFIG=/path bun start`.

---

## HTTP webhook ingress

Optionally accept events over HTTP from external systems. When `http.enabled` is true, the
app starts a server that turns authenticated `POST` requests into events on the bus. Add an
`http` block to `config.json`:

```jsonc
{
  "http": {
    "enabled": true,
    "host": "0.0.0.0",
    "port": 3000,
    "path": "/webhook",
    "allowedEvents": ["order.placed"],     // only these types may be ingested
    "maxBodyBytes": 1048576,
    "auth": { "type": "apiKey", "header": "authorization", "scheme": "Bearer", "token": "env:WEBHOOK_TOKEN" }
  }
}
```

Send events as `POST {path}` with body `{ "type": "...", "payload": { ... } }`:

```bash
curl -X POST http://localhost:3000/webhook \
  -H 'authorization: Bearer <token>' \
  -H 'content-type: application/json' \
  -d '{"type":"order.placed","payload":{"orderId":"o1","total":9.99}}'
```

- The type must be in `allowedEvents`, and the payload is validated against that type's
  registered schema before publishing.
- Responses: `202` accepted · `401` bad/missing auth · `403` type not allowed ·
  `400` malformed body or schema-invalid payload · `413` too large. `GET /health` → `200`.
- An optional `x-correlation-id` header is forwarded onto the event envelope.

**Authentication** (`http.auth.type`):

```jsonc
// Shared secret in a header (you control the sender)
{ "type": "apiKey", "header": "authorization", "scheme": "Bearer", "token": "env:WEBHOOK_TOKEN" }
// HMAC-SHA256 over the raw body (third-party providers like Stripe/GitHub)
{ "type": "hmac", "header": "x-signature", "algorithm": "sha256", "secret": "env:WEBHOOK_SECRET", "encoding": "hex", "prefix": "sha256=" }
```

Secrets support the `env:VAR_NAME` form to read from the environment instead of hard-coding
them. Credentials are compared in constant time.

## Migrations

Ordered `.sql` files in `migrations/` are applied at startup (and via `bun run migrate`),
tracked in a `schema_migrations` table. Backend-specific variants are resolved by suffix:

```
migrations/0002_add_orders.sqlite.sql     # used when store.type = sqlite
migrations/0002_add_orders.postgres.sql   # used when store.type = postgres
migrations/0003_generic.sql               # used for any backend (fallback)
```

The framework ships `0001_init_kv.*`, which creates the `kv_store` table the repositories
use. Add your own numbered files for custom tables.

---

## Project layout

```
src/
  index.ts            entrypoint
  application.ts      bootstrap + lifecycle
  config/             schema.ts (Zod) + load.ts
  core/
    ports/            event-bus.ts, data-store.ts   ← the stable interfaces
    events/           envelope.ts, registry.ts, define.ts, discover.ts
    serialization/    json-codec.ts
    bus/factory.ts    store/factory.ts, store/migrator.ts
    handler/          types.ts, discover.ts, register.ts
  adapters/           emitter/ kafka/ nats/ sqlite/ postgres/
  cli/migrate.ts
events/               ← YOUR event schemas (*.event.ts)
handlers/             ← YOUR handlers (*.handler.ts, auto-discovered)
migrations/           ← ordered .sql
tests/                ← bun test
```

## Switching backends locally

Bring up brokers/DB (e.g. via Docker), then flip `config.json`:

```bash
# Kafka:    docker run -p 9092:9092 apache/kafka
# NATS:     docker run -p 4222:4222 nats -js
# Postgres: docker run -p 5432:5432 -e POSTGRES_PASSWORD=pass postgres
```

The same handlers run unchanged — that's the point of the ports/adapters split.

# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**tangleflick** — a Bun + TypeScript **template framework** for event-driven services. It
provides a config-driven **event bus** (embedded `EventEmitter`, Kafka, or NATS/JetStream)
and a shared **data store** (embedded SQLite or PostgreSQL) behind a **ports & adapters**
architecture. Users clone it and add their own **event schemas** (`events/`) and **event
handlers** (`handlers/`); the framework auto-discovers and wires them.

The whole point of the ports/adapters split: handlers depend only on the `EventBus` and
`DataStore` *interfaces*, so switching backends is a `config/config.json` change, never a
handler code change.

## Commands

```bash
bun install                                  # install deps
bun start                                    # run the service (waits for events)
bun run dev                                  # run with --watch
bun test                                     # run the test suite (bun:test)
bun run typecheck                            # tsc --noEmit
bun run migrate                              # apply pending migrations only
bun run seed <event.type> '<json>' [waitMs]  # publish one event in-process (dev trigger)
```

Bun is required. If `bun` is missing and the official installer fails (needs `unzip`),
install via `npm i -g bun`.

**Always run `bun run typecheck` and `bun test` after changes.**

## Architecture map

| Concern | File(s) |
| --- | --- |
| **Ports** (stable interfaces) | `src/core/ports/event-bus.ts`, `src/core/ports/data-store.ts` |
| **Bus adapters** | `src/adapters/{emitter,kafka,nats}/` |
| **Store adapters** | `src/adapters/{sqlite,postgres}/` |
| **Factories** (only place adapters are named) | `src/core/bus/factory.ts`, `src/core/store/factory.ts` |
| **Envelope + codec** | `src/core/events/envelope.ts`, `src/core/serialization/json-codec.ts` |
| **Schema registry** | `src/core/events/registry.ts` |
| **Auto-discovery** | `src/core/events/discover.ts` (event defs), `src/core/handler/discover.ts` (handlers) |
| **Handler registration** | `src/core/handler/register.ts` (binds `ctx` per handler) |
| **HTTP webhook ingress** | `src/http/server.ts` (Bun.serve), `src/http/auth.ts` (apiKey + HMAC) |
| **Bootstrap / lifecycle** | `src/application.ts`, `src/index.ts` |
| **Config** | `src/config/schema.ts` (Zod), `src/config/load.ts` |
| **Migrations** | `src/core/store/migrator.ts`, `migrations/*.sql` |

Message flow: `publish` → wrap in `EventEnvelope` → `JsonCodec.encode` (validates payload vs
registered Zod schema) → transport → `JsonCodec.decode` (re-validates) → handler.

## Adding an event schema

Create `events/<name>.event.ts` and bind a type to a Zod schema with `defineEvent`:

```ts
import { z } from "zod";
import { defineEvent } from "../src/core/events/define.ts";

export const OrderPlaced = defineEvent(
  "order.placed",
  z.object({ orderId: z.string(), total: z.number().positive() }),
);
export type OrderPlacedPayload = z.infer<typeof OrderPlaced.schema>;
```

Prefer the `/new-event` skill for scaffolding.

## Adding a handler

Create `handlers/<name>.handler.ts` with a **default export** built by `defineHandler`:

```ts
import { defineHandler } from "../src/core/handler/types.ts";
import { OrderPlaced, type OrderPlacedPayload } from "../events/order.event.ts";

export default defineHandler<OrderPlacedPayload>({
  eventType: OrderPlaced.type,
  schema: OrderPlaced.schema,
  // group: "billing",  // optional consumer group / durable
  async handle(event, ctx) {
    await ctx.store.repository<OrderPlacedPayload>("orders").put(event.payload.orderId, event.payload);
    await ctx.publish("order.confirmed", { orderId: event.payload.orderId });
  },
});
```

`ctx` = `{ publish, store, logger }`. Prefer the `/new-handler` skill for scaffolding.

## Conventions & gotchas (READ BEFORE EDITING)

- **File naming is load-bearing.** Only `events/**/*.event.ts` and `handlers/**/*.handler.ts`
  are discovered. Handlers must be the **default export**.
- **You can only publish a registered event type.** The codec rejects publishing a type with
  no registered schema. Declare every emitted type via `defineEvent` in `events/` — even ones
  no local handler consumes (e.g. events produced for other services).
- **One schema per event type.** The registry throws on conflicting schemas. Multiple handlers
  may subscribe to the same type, but they must reference the same schema (import the shared
  `defineEvent`).
- **Fan-out vs consumer groups.** Each handler gets a stable consumer identity from its
  filename (`discover.ts` sets `id`; `register.ts` passes it as `SubscribeOptions.consumerId`).
  On Kafka/NATS this becomes the `groupId` / durable name, so distinct handlers on the same
  event type fan out (each sees every event) while replicas of one handler load-balance. An
  explicit `group` on a handler overrides this to force shared/load-balanced consumption. The
  emitter always fans out and ignores `group`/`consumerId`. When touching consumer naming,
  keep all three adapters consistent.
- **The emitter bus is in-process.** A separate process cannot publish to a running
  `bun start`. Use `bun run seed` for local triggering, or switch to Kafka/NATS.
- **Strict TypeScript.** `verbatimModuleSyntax` (use `import type` for type-only imports),
  `noUncheckedIndexedAccess` (array indexing yields `T | undefined` — guard or `!` with care),
  and `.ts` extensions in relative imports are required.
- **Store repository API:** `get / put / delete / has / list / where / transaction`. Values are
  JSON in a generic `kv_store` table. `where(field, value)` does equality on a top-level JSON
  field and is intended for string/number fields (booleans differ across backends).
- **Migrations** are ordered `migrations/*.sql`, resolved per backend via `.sqlite.sql` /
  `.postgres.sql` suffix with a generic `.sql` fallback; applied state lives in
  `schema_migrations`. Add a numbered file for custom tables.
- **HTTP webhook ingress** is optional and config-gated (`http.enabled`). It authenticates
  (`apiKey` or `hmac`, constant-time compare, `env:VAR` secrets), enforces the
  `http.allowedEvents` allowlist, then publishes via the bus (which validates the payload).
  It only *publishes* — it never bypasses the bus or the schema registry.
- **Never commit** `config/config.json`, `data/`, or `node_modules/` — they're gitignored.
  The committed template config is `config/config.example.json`.

## Skills

- `/new-event` — scaffold an event schema in `events/`.
- `/new-handler` — scaffold a handler in `handlers/` (and its event def if missing).
- `/audit-deps` — scan dependencies for vulnerabilities with `bun audit` and remediate.
- `/update-deps` — plan and execute dependency updates (`bun outdated` → `bun update` → verify).

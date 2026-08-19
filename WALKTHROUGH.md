# Walkthrough: your first event flow

A hands-on guide, from cloning the repo to watching a handler process an event, persist
state, and **emit a new event back onto the bus** that a second handler picks up.

We'll build a tiny "greeting" flow:

```
greeting.requested ─► [greeting handler] ─ persist ─► emits greeting.created ─► [notify handler]
```

Everything runs on the defaults: the **in-process emitter bus** and **embedded SQLite** — no
external servers needed.

---

## 1. Clone the repo

```bash
git clone <your-fork-url> tangleflick
cd tangleflick
```

## 2. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
# restart your shell, or: source ~/.bashrc
bun --version   # should print 1.x
```

## 3. Install dependencies

```bash
bun install
```

## 4. Create your config

```bash
cp config/config.example.json config/config.json
```

The default `config.json` uses the emitter bus and SQLite — perfect for local dev:

```json
{
  "app": { "name": "tangleflick", "logLevel": "info" },
  "bus": { "type": "emitter" },
  "store": { "type": "sqlite", "path": "./data/tangleflick.db" }
}
```

---

## 5. Write the event schemas

Create `events/greeting.event.ts`. Each `defineEvent` binds an event type to a Zod schema —
one definition drives both the TypeScript type and runtime validation. We declare two
events: the one that comes in, and the one our handler will emit.

```ts
// events/greeting.event.ts
import { z } from "zod";
import { defineEvent } from "../src/core/events/define.ts";

export const GreetingRequested = defineEvent(
  "greeting.requested",
  z.object({ name: z.string().min(1) }),
);
export type GreetingRequestedPayload = z.infer<typeof GreetingRequested.schema>;

export const GreetingCreated = defineEvent(
  "greeting.created",
  z.object({ greeting: z.string(), at: z.string() }),
);
export type GreetingCreatedPayload = z.infer<typeof GreetingCreated.schema>;
```

> Files in `events/` are auto-discovered, so both event types are registered at startup —
> which is what lets us **publish** `greeting.created` (not just consume it).

## 6. Write the handler (consume → persist → emit)

Create `handlers/greeting.handler.ts`. A handler is a default export built with
`defineHandler`. It's auto-discovered and subscribed at startup.

```ts
// handlers/greeting.handler.ts
import { defineHandler } from "../src/core/handler/types.ts";
import {
  GreetingRequested,
  GreetingCreated,
  type GreetingRequestedPayload,
} from "../events/greeting.event.ts";

export default defineHandler<GreetingRequestedPayload>({
  eventType: GreetingRequested.type,
  schema: GreetingRequested.schema,

  async handle(event, ctx) {
    const greeting = `Hello, ${event.payload.name}!`;
    ctx.logger.info("built greeting", { greeting });

    // Persist state (same API whether SQLite or Postgres).
    const greetings = ctx.store.repository<{ greeting: string }>("greetings");
    await greetings.put(event.payload.name, { greeting });

    // Emit a follow-up event back onto the bus.
    await ctx.publish(GreetingCreated.type, {
      greeting,
      at: new Date().toISOString(),
    });
  },
});
```

`ctx` gives the handler everything it needs:
- `ctx.publish(type, payload)` — publish back onto the bus
- `ctx.store` — the shared data store
- `ctx.logger` — structured logging, scoped to this handler

## 7. Write a second handler to see the emitted event

To *observe* the event our first handler emits, add a handler that consumes it. Create
`handlers/notify.handler.ts`:

```ts
// handlers/notify.handler.ts
import { defineHandler } from "../src/core/handler/types.ts";
import {
  GreetingCreated,
  type GreetingCreatedPayload,
} from "../events/greeting.event.ts";

export default defineHandler<GreetingCreatedPayload>({
  eventType: GreetingCreated.type,
  schema: GreetingCreated.schema,

  async handle(event, ctx) {
    ctx.logger.info("notifying", { greeting: event.payload.greeting });
  },
});
```

---

## 8. Run the app

```bash
bun start
```

You'll see the store connect, migrations apply, and **three** handlers register (your two
plus the shipped `example.created`). The process then stays up waiting for events — stop it
with `Ctrl-C`. It logs its startup like this:

```json
{"msg":"handler registered","eventType":"greeting.requested"}
{"msg":"handler registered","eventType":"greeting.created"}
{"msg":"started","handlers":3}
```

## 9. Trigger the flow

Because the default emitter bus lives **inside one process**, a separate producer can't
reach the running `bun start`. Use the bundled `seed` helper, which boots the app in-process,
publishes one event, lets handlers run, then exits:

```bash
bun run seed greeting.requested '{"name":"Ada"}'
```

You'll see the whole chain fire — handler processes the input, persists, emits
`greeting.created`, and the notify handler picks it up:

```json
{"msg":"built greeting","handler":"greeting.requested","greeting":"Hello, Ada!"}
{"msg":"notifying","handler":"greeting.created","greeting":"Hello, Ada!"}
```

That `notifying` line is proof the event was published back onto the bus and consumed by
another handler. 🎉

## 10. Confirm the persisted state

The handler wrote to SQLite. Read it back with a self-contained one-liner:

```bash
bun run seed greeting.requested '{"name":"Grace"}'
# then inspect the DB
bun -e 'import {Database} from "bun:sqlite"; \
  console.log(new Database("data/tangleflick.db").query("SELECT collection,id,value FROM kv_store").all())'
```

You'll see rows in the `greetings` collection with the stored greeting JSON. (If you have the
`sqlite3` CLI, `sqlite3 data/tangleflick.db "SELECT * FROM kv_store;"` works too.)

Validation is automatic: try an invalid payload and the publish is rejected before any
handler runs —

```bash
bun run seed greeting.requested '{"name":""}'   # fails: name too short
```

---

## Where to go next

- **Add more handlers** — drop another `*.handler.ts` into `handlers/`. Multiple handlers can
  subscribe to the same event type.
- **Run as a real service** — with Kafka or NATS the bus is external, so a producer in another
  process (or another service entirely) can publish `greeting.requested` and your running
  `bun start` will handle it. Flip `config.json`:
  ```jsonc
  { "bus": { "type": "nats", "servers": ["nats://localhost:4222"], "stream": "EVENTS", "durablePrefix": "app" } }
  ```
- **Switch to Postgres** — `{ "store": { "type": "postgres", "url": "postgres://…" } }`, then
  `bun run migrate`. Your handler code doesn't change.
- **Custom tables** — add a numbered file in `migrations/` (see `README.md` → Migrations) for
  richer relational queries beyond the key/value repository.

See `README.md` for the full config and API reference.

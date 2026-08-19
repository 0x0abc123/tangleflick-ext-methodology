---
name: new-handler
description: Scaffold a new event handler in handlers/ for the tangleflick framework using defineHandler (subscribe -> process -> persist -> publish). Use when the user wants to add, create, or write a handler / event consumer / subscriber (e.g. "add a handler for order.placed", "handle the user.registered event").
---

# Scaffold a new event handler

Create a new handler under `handlers/` following this repo's conventions. Handlers are
auto-discovered (default export) and subscribed at startup; they receive a validated event
plus a `ctx` for persisting state and publishing follow-up events.

## Steps

1. **Gather inputs** (ask only for what's missing):
   - **Consumed event type** — which event this handler subscribes to (e.g. `order.placed`).
   - **What it does** — the processing logic: what state to persist (which collection), and
     which follow-up event(s), if any, to publish back onto the bus.
   - **Consumer group** (optional) — set `group` for load-balanced / durable delivery across
     instances (Kafka groupId / NATS durable). Omit for fan-out.
   - **File** — default `handlers/<name>.handler.ts`.

2. **Ensure the event definition exists.** Check `events/` for a `defineEvent` matching the
   consumed type.
   - If it exists, import it.
   - If not, create it first (use the `/new-event` skill / its conventions). Do the same for
     any follow-up event types the handler will publish — publishing an unregistered type is
     rejected by the codec.

3. **Write the handler.** Default-export a `defineHandler`, referencing the shared event
   definition's `.type` and `.schema`. Follow this exact shape:

   ```ts
   import { defineHandler } from "../src/core/handler/types.ts";
   import {
     OrderPlaced,
     OrderConfirmed,
     type OrderPlacedPayload,
   } from "../events/order.event.ts";

   export default defineHandler<OrderPlacedPayload>({
     eventType: OrderPlaced.type,
     schema: OrderPlaced.schema,
     // group: "billing",   // optional

     async handle(event, ctx) {
       ctx.logger.info("handling order", { orderId: event.payload.orderId });

       // 1. persist state (same API on SQLite and Postgres)
       const orders = ctx.store.repository<OrderPlacedPayload>("orders");
       await orders.put(event.payload.orderId, event.payload);

       // 2. publish a follow-up event back onto the bus
       await ctx.publish(OrderConfirmed.type, { orderId: event.payload.orderId });
     },
   });
   ```

   `ctx` provides:
   - `ctx.publish(type, payload, opts?)` — publish back onto the bus
   - `ctx.store.repository<T>(collection, schema?)` — get/put/delete/has/list/where/transaction
   - `ctx.logger` — structured logger, pre-scoped to this handler

4. **Verify:**
   - `bun run typecheck`
   - Exercise it end-to-end with the seed tool:
     `bun run seed <consumed.type> '<json payload>'`
     and confirm the log lines / persisted rows. Clean up `data/` afterward if it was created.

## Rules

- File MUST live under `handlers/` and end in `.handler.ts`, with the handler as the
  **default export** (otherwise it won't be discovered).
- Reference the event's shared `defineEvent` (`X.type`, `X.schema`) — do NOT inline a second
  schema for a type that already has one (the registry rejects conflicts).
- Any event type the handler publishes must have a `defineEvent` in `events/`.
- Throwing from `handle` signals a processing failure (transports may retry/redeliver); let
  errors propagate rather than swallowing them unless you specifically want to swallow.
- Respect strict TS: `.ts` import extensions, `import type` for type-only imports, and guard
  possibly-`undefined` array/index access.

## Report

Tell the user the file created, the event it consumes, any events it publishes, the store
collection it writes, and the exact `bun run seed ...` command to try it.

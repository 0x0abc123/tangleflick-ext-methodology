---
name: new-event
description: Scaffold a new event schema in events/ for the tangleflick framework using defineEvent + Zod. Use when the user wants to add, define, or create an event type / event schema (e.g. "add an order.placed event", "define a new event").
---

# Scaffold a new event schema

Create a new event definition under `events/` following this repo's conventions. Event
definitions bind an event type string to a Zod payload schema and are auto-discovered at
startup, so the type becomes publishable and validated.

## Steps

1. **Gather inputs** (ask only for what's missing from the user's request):
   - **Event type** — a dotted, lower-case name, `domain.pastTenseVerb` (e.g. `order.placed`,
     `user.registered`, `payment.failed`). This is the topic/subject/channel string.
   - **Payload fields** — field names, types, and which are required/optional. If the user is
     vague, propose a reasonable schema and confirm.
   - **File** — default to `events/<domain>.event.ts` (group related events for one domain in
     the same file). Reuse an existing domain file if one already exists.

2. **Write the definition.** Use `defineEvent(type, schema)` and export both the definition
   and its inferred payload type. Follow this exact shape:

   ```ts
   import { z } from "zod";
   import { defineEvent } from "../src/core/events/define.ts";

   export const OrderPlaced = defineEvent(
     "order.placed",
     z.object({
       orderId: z.string().min(1),
       total: z.number().positive(),
       currency: z.string().length(3).default("USD"),
     }),
   );
   export type OrderPlacedPayload = z.infer<typeof OrderPlaced.schema>;
   ```

   - Export const name: PascalCase of the event type (`order.placed` → `OrderPlaced`).
   - Payload type export: `<ConstName>Payload`.
   - Prefer precise Zod constraints (`.min`, `.positive`, `.uuid`, enums, `.default`) over bare
     `z.string()`/`z.number()` — the schema is the runtime validator, so make it strict.
   - If adding to an existing `*.event.ts` file, append; don't duplicate imports.

3. **Verify:** run `bun run typecheck`. Fix any errors before finishing.

## Rules

- File MUST live under `events/` and end in `.event.ts` (glob-discovered).
- Every event type that will ever be **published** needs a `defineEvent` — including events
  only emitted (not consumed) locally. Without one, publishing is rejected by the codec.
- One event type ↔ one schema. Don't redefine a type that already exists elsewhere; import and
  reuse it instead.
- Respect strict TS: `.ts` import extensions, `import type` for type-only imports.

## Report

Tell the user the event type, the file, the exported names, and remind them a handler can be
scaffolded with `/new-handler`.

/**
 * Dev utility: boot the app in-process, publish one event, let handlers run,
 * then shut down. Useful for exercising handlers with the embedded emitter bus
 * (which lives inside a single process, so a separate producer can't reach it).
 *
 * Usage:
 *   bun run seed <event.type> '<json-payload>' [waitMs]
 *
 * Example:
 *   bun run seed greeting.requested '{"name":"Ada"}'
 */
import { Application } from "../src/application.ts";

const [, , eventType, payloadArg, waitArg] = process.argv;

if (!eventType || !payloadArg) {
  console.error(
    "Usage: bun run seed <event.type> '<json-payload>' [waitMs]\n" +
      `Example: bun run seed greeting.requested '{"name":"Ada"}'`,
  );
  process.exit(1);
}

let payload: unknown;
try {
  payload = JSON.parse(payloadArg);
} catch {
  console.error(`Payload is not valid JSON: ${payloadArg}`);
  process.exit(1);
}

const waitMs = waitArg ? Number(waitArg) : 300;

const app = new Application();
await app.start();

await app.bus.publish(eventType, payload);
console.log(`[seed] published ${eventType}`);

// Give async handlers (and any events they publish) time to run.
await new Promise((r) => setTimeout(r, waitMs));

await app.stop();

import { Glob } from "bun";
import { resolve } from "node:path";
import { isEventDefinition, type EventDefinition } from "./define.ts";
import type { Logger } from "../../logger.ts";

export const DEFAULT_EVENTS_DIR = "events";

/**
 * Auto-discovery for event schemas: import every `*.event.ts` under the events
 * dir and collect all exported EventDefinition values (any export, not just the
 * default). These populate the registry so their event types can be published
 * and validated regardless of whether a local handler consumes them.
 */
export async function discoverEventDefinitions(
  logger: Logger,
  dir: string = DEFAULT_EVENTS_DIR,
): Promise<Array<EventDefinition<unknown>>> {
  const glob = new Glob("**/*.event.ts");
  const defs: Array<EventDefinition<unknown>> = [];

  for await (const rel of glob.scan({ cwd: dir, onlyFiles: true })) {
    const path = resolve(dir, rel);
    const mod = (await import(path)) as Record<string, unknown>;
    for (const value of Object.values(mod)) {
      if (isEventDefinition(value)) {
        defs.push(value);
        logger.debug("discovered event definition", { path, eventType: value.type });
      }
    }
  }

  return defs;
}

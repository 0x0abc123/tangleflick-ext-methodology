import type { ZodType } from "zod";

/**
 * Maps event type → Zod payload schema. Populated at startup from the set of
 * registered handlers (each handler carries the schema for the event type it
 * owns). Used by the codec to validate payloads on publish and on receive.
 *
 * If two handlers declare the same event type they must agree on the schema;
 * the first registration wins and a conflicting second one throws.
 */
export class EventRegistry {
  private readonly schemas = new Map<string, ZodType>();

  register(eventType: string, schema: ZodType): void {
    const existing = this.schemas.get(eventType);
    if (existing && existing !== schema) {
      throw new Error(
        `Conflicting schema registered for event type "${eventType}". ` +
          `Each event type must map to exactly one schema.`,
      );
    }
    this.schemas.set(eventType, schema);
  }

  get(eventType: string): ZodType | undefined {
    return this.schemas.get(eventType);
  }

  has(eventType: string): boolean {
    return this.schemas.has(eventType);
  }

  types(): string[] {
    return [...this.schemas.keys()];
  }
}

import { z } from "zod";
import { defineEvent } from "../src/core/events/define.ts";

/* URL: full URL of a resource */

export const UrlDetectedEvent = defineEvent(
  "url.detected",
  z.object({
    url: z.string().min(1),
  }),
);
export type UrlDetectedPayload = z.infer<typeof UrlDetectedEvent.schema>;



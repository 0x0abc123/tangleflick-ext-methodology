import { z } from "zod";
import { defineEvent } from "../src/core/events/define.ts";

/* WebFingerprint: web service fingerprint (CMS, server, tech stack etc.) */

export const WebFingerprintEvent = defineEvent(
  "web.fingerprint",
  z.object({
    url: z.string().min(1),
    fingerprint: z.string().min(1) // space-separated list of keywords
  }),
);
export type WebFingerprintPayload = z.infer<typeof WebFingerprintEvent.schema>;



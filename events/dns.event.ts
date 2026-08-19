import { z } from "zod";
import { defineEvent } from "../src/core/events/define.ts";

export const DnsNameEvent = defineEvent(
  "dns.name",
  z.object({
    name: z.string().min(1),
    isRoot: z.boolean(),
    exclude: z.boolean(),
    force: z.boolean()
  }),
);
export type DnsNamePayload = z.infer<typeof DnsNameEvent.schema>;

export const DnsUnresolvedCnameEvent = defineEvent(
  "dns.unresolvedcname",
  z.object({
    cname: z.string().min(1)
  }),
);
export type DnsUnresolvedCnamePayload = z.infer<typeof DnsUnresolvedCnameEvent.schema>;

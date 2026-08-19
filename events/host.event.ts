import { z } from "zod";
import { defineEvent } from "../src/core/events/define.ts";
import { IpSchema, PortSchema } from "./common.ts";


/* HostUp: host is alive */

export const HostUpEvent = defineEvent(
  "host.up",
  z.object({
    ip: IpSchema,
    force: z.boolean(),
  }),
);
export type HostUpPayload = z.infer<typeof HostUpEvent.schema>;


/* HostPort: an open port was detected on a host */

export const HostPortEvent = defineEvent(
  "host.port",
  z.object({
    ip: IpSchema,
    port: PortSchema,
    force: z.boolean(),
  }),
);
export type HostPortPayload = z.infer<typeof HostPortEvent.schema>;

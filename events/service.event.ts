import { z } from "zod";
import { defineEvent } from "../src/core/events/define.ts";
import { IpSchema, PortSchema } from "./common.ts";

/* ServiceHttp: Service fingerprint (HTTP) */

export const ServiceHttpEvent = defineEvent(
  "svc.http",
  z.object({
    ip: IpSchema,
    port: PortSchema,
    svcType: z.string().min(1),
    svcVersion: z.string().min(1),
    hostNames: z.array(z.string()),
  }),
);
export type ServiceHttpPayload = z.infer<typeof ServiceHttpEvent.schema>;


export const ServiceOtherEvent = defineEvent(
  "svc.other",
  z.object({
    ip: IpSchema,
    port: PortSchema,
    svcType: z.string().min(1),
    svcVersion: z.string().min(1)
  }),
);
export type ServiceOtherPayload = z.infer<typeof ServiceOtherEvent.schema>;

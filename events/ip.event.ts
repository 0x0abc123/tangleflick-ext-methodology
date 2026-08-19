import { z } from "zod";
import { defineEvent } from "../src/core/events/define.ts";
import { IpSchema } from "./common.ts";


export const IpAddrEvent = defineEvent(
  "ip.addr",
  z.object({
    ip: IpSchema,
    exclude: z.boolean(),
    force: z.boolean()
  }),
);
export type IpAddrPayload = z.infer<typeof IpAddrEvent.schema>;

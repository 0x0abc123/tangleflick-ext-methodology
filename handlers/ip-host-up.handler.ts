import { defineHandler } from "../src/core/handler/types.ts";

import { 
    setAddressExcluded, 
    getExclusionsList, 
    executePortScan,
    type HostPortScanRecord 
} from "./host.common.ts";

import {
  IpAddrEvent,
  type IpAddrPayload,
} from "../events/ip.event.ts";

import {
  HostUpEvent,
} from "../events/host.event.ts";


export default defineHandler<IpAddrPayload>({
  eventType: IpAddrEvent.type,
  schema: IpAddrEvent.schema,

  async handle(event, ctx) {
    const ipData: IpAddrPayload = event.payload;
    const ipAddr: string = ipData.ip.address;

    ctx.logger.debug("handling ip-addr event", {
      id: event.id,
      message: `${ipAddr}`,
    });

    // Persist state to the shared data store (SQLite or Postgres — same API).
    const history = ctx.store.repository<{seen: boolean}>("ip_addr_host_up");
    const alreadySeen = await history.get(ipAddr);

    if (alreadySeen && !ipData.force) {
      ctx.logger.debug("ip-addr", {name: ipAddr, message: "seen - skipping"});
      return;
    }

    if (ipData.exclude) {
        await setAddressExcluded(ctx, ipData.ip);
        ctx.logger.debug("ip-addr", {name: ipAddr, message: "set excluded"});
        return;
    }

    ctx.logger.debug("ip-addr", {name: ipAddr, message: "checking host is alive"});

    const records: HostPortScanRecord[] | undefined = await executePortScan(
      ipData.ip,
      [{ num: 0, proto: "tcp"}],
      "alive",
      await getExclusionsList(ctx),
    );
    if (!!records && records.length > 0) {
        const firstRecord = records[0];
        if (firstRecord?.ip.address == ipData.ip.address) {
            await ctx.publish(HostUpEvent.type, {
                ip: ipData.ip,
                force: ipData.force,
            });
            ctx.logger.debug("ip-addr is up ", { data: firstRecord });
        } 
    } else {
        ctx.logger.info("ip-addr", {name: ipAddr, message: `Host not found or not up - ${ipAddr}`});
    }

    await history.put(ipAddr, {seen: true});
  },
});

import { defineHandler } from "../src/core/handler/types.ts";

import {
    getExclusionsList, 
    executePortScan,
    type HostPortScanRecord 
} from "./host.common.ts";

import {
  HostUpEvent,
  type HostUpPayload
} from "../events/host.event.ts";

import {
    ServiceHttpEvent,
    type ServiceHttpPayload,
    ServiceOtherEvent
} from "../events/service.event.ts";

import type {
  Entry,
} from "../src/core/ports/data-store.ts";

function determineEventType(serviceType: string): string {
    let eventType = ServiceOtherEvent.type;
    if (serviceType.indexOf("http") > -1)
        eventType = ServiceHttpEvent.type;
    return eventType;
}

export default defineHandler<HostUpPayload>({
  eventType: HostUpEvent.type,
  schema: HostUpEvent.schema,

  async handle(event, ctx) {
    const hostUp: HostUpPayload = event.payload;
    const ipAddr: string = hostUp.ip.address;

    ctx.logger.debug("handling host-up event", {
      id: event.id,
      message: `${ipAddr}`,
    });

    // Persist state to the shared data store (SQLite or Postgres — same API).
    const history = ctx.store.repository<{seen: boolean}>("host_port_scan");
    const alreadySeen = await history.get(ipAddr);

    if (alreadySeen && !hostUp.force) {
      ctx.logger.debug("host-port-scan", {name: ipAddr, message: "seen - skipping"});
      return;
    }

    ctx.logger.debug("host-port-scan", {name: ipAddr, message: "port scan host"});

    const records: HostPortScanRecord[] | undefined = await executePortScan(
      hostUp.ip,
      [{ num: 0, proto: "tcp"}],
      "fingerprint",
      await getExclusionsList(ctx),
    );

    if (!!records) {
        const dnsNames = ctx.store.repository<{ip: string, name: string}>("shared_dns_names");

        for (const record of records) {
            if (record.port.num > 0) {
                const eventType = determineEventType(record.serviceType || "");
                const payload = {
                    ip: record.ip,
                    port: record.port,
                    svcType: record.serviceType || "unknown",
                    svcVersion: record.serviceVersion || "unknown",
                }
                let payloadHttpSvc: ServiceHttpPayload | null = null;

                if (eventType == ServiceHttpEvent.type) {
                  const resolves: Entry<{ip: string, name: string}>[] = 
                    await dnsNames.where("ip", record.ip.address);
                  const _hostNames: string[] = resolves.map(res => res.value.name);
                  const hostNames = _hostNames.length ? _hostNames : [record.ip.address];
                  payloadHttpSvc = { ...payload, hostNames };
                  ctx.logger.debug("host-port-scan http.svc", {data: hostNames});
                }
                await ctx.publish(eventType, payloadHttpSvc || payload);
                ctx.logger.info("host-port-scan found service", { data: record });
            } 
        }
    }

    await history.put(ipAddr, {seen: true});
  },
});

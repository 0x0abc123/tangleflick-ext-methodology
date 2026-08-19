import { defineHandler } from "../src/core/handler/types.ts";
import {
  DnsNameEvent,
  type DnsNamePayload,
} from "../events/dns.event.ts";

import { handleExcluded } from "./dns.common.ts";
import { IpAddrEvent } from "../events/ip.event.ts";
import { type DigRecord, executeDig } from "./dns.common.ts";


export default defineHandler<DnsNamePayload>({
  eventType: DnsNameEvent.type,
  schema: DnsNameEvent.schema,

  async handle(event, ctx) {
    const dnsName: string = event.payload.name;

    ctx.logger.debug("handling dns-name event", {
      id: event.id,
      message: dnsName,
    });

    // Persist state to the shared data store (SQLite or Postgres — same API).
    const history = ctx.store.repository<{seen: boolean}>("dns_resolver");

    if (event.payload.exclude) {
        await handleExcluded(ctx, dnsName, "dns_resolver");
        return;
    }

    const alreadySeen = await history.get(dnsName);

    if (alreadySeen && !event.payload.force) {
      ctx.logger.debug("dns-resolver", {name: dnsName, message: "seen - skipping"});
      return;
    }
    ctx.logger.debug("dns-resolver", {name: dnsName, message: "resolving DNS name"});

    const dnsNames = ctx.store.repository<{ip: string, name: string}>("shared_dns_names");

    // dig +noall +answer a <dns.name>
    // if dnsName is a CNAME, dig will return a sequence of CNAMEs in order of resolving 
    // and the last record should be an A record for the final CNAME

    const records: DigRecord[] | null = await executeDig(dnsName, "A");
    if (!!records && records.length > 0) {
        for (const r of records) {
            ctx.logger.debug("dns-resolver", { data: r });
            if (r.type !== 'A')
                continue;
            const _ip = r.data.trim();
            const _name = dnsName;
            dnsNames.put(`${_ip}_${_name}`,{ip: _ip, name: _name})
            ctx.logger.debug("dns-resolver store ",{data: {ip: _ip, name: _name}});
        }

        const firstRecord = records[0];
        if (firstRecord?.type == "A") {
            // TODO: there could be multiple A records (load balancing), but for now we just take the first
            await ctx.publish(IpAddrEvent.type, {
                ip: {
                    address: firstRecord.data.trim(),
                    version: 4,
                    cidr: false,
                },
                exclude: false,
                force: false,
            });
            ctx.logger.info("dns-resolver", { data: firstRecord });
        } else {
            // if last record in sequence is CNAME then it is a dangling record so raise an alert
            const lastRecord = records[ records.length - 1 ];
            if (lastRecord?.type !== "A") {
                ctx.logger.warn("dns-resolver", { message: `[!] Dangling CNAME ${dnsName} -> ${lastRecord?.name}` });
            }
        }
    } else {
        ctx.logger.debug("dns-resolver", {name: dnsName, message: `There was an error resolving ${dnsName}`});
    }
    
    await history.put(dnsName, {seen: true});
  },
});

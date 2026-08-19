import { defineHandler } from "../src/core/handler/types.ts";
import {
  DnsNameEvent,
  type DnsNamePayload,
} from "../events/dns.event.ts";

import { handleExcluded } from "./dns.common.ts";
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
    const history = ctx.store.repository<{seen: boolean}>("dns_record_enum");

    if (event.payload.exclude) {
        await handleExcluded(ctx, dnsName, "dns_record_enum");
        return;
    }
    const alreadySeen = await history.get(dnsName);

    if (alreadySeen && !event.payload.force) {
      ctx.logger.debug("dns-record-enum", {name: dnsName, message: "seen - skipping"});
      return;
    }
    ctx.logger.debug("dns-record-enum", {name: dnsName, message: "enumerating records"});

    // dig +noall +answer txt <domain.tld>
    const recTypes: string[] = ["AFSDB","AFS","CAA","CDNSKEY","CDS","CERT","CSYNC","DHCID","DLV","DNAME","DNSKEY","DS","EUI48","EUI64","HINFO","HIP","HTTPS","IPSECKEY","KEY","KX","LOC","MX","NAPTR","NS","NSEC","NSEC3","NSEC3PARAM","OPENPGPKEY","PTR","RP","RRSIG","SIG","SMIMEA","SOA","SRV","SSHFP","SVCB","TA","TKEY","TLSA","TSIG","TXT","URI","ZONEMD","AXFR","IXFR","ALIAS","ANAME","OPT"];

    let isCname: boolean = false;

    for (const recType of recTypes) {
      const records: DigRecord[] | null = await executeDig(dnsName, recType);
      if (!!records && records.length > 0) {
        for (const r of records) {
          // if the record is a CNAME, every dig query will return CNAME records, so abort enumeration
          if (r.type == "CNAME") {
            isCname = true;
            break;
          }
          ctx.logger.info("dns-record-enum", {
            data: r,
          });
        }
      } else {
        ctx.logger.debug("dns-record-enum", {name: dnsName, message: `There was an error fetching record type ${recType}`});
      }
      if (isCname) {
        break;
      }
    }

    await history.put(dnsName, {seen: true});
  },
});

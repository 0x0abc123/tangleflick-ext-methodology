import { defineHandler } from "../src/core/handler/types.ts";
import {
  DnsNameEvent,
  type DnsNamePayload,
} from "../events/dns.event.ts";

import { handleExcluded } from "./dns.common.ts";
import { runCommand } from "./common.ts";

const SUBFINDER_BIN_PATH = "/opt/subfinder/subfinder";
const SUBFINDER_PROVIDER_CONF_PATH = "/opt/subfinder/config.yml";

interface SubfinderJsonResult {
  host: string,
  input: string,
  source: string,
}

export default defineHandler<DnsNamePayload>({
  eventType: DnsNameEvent.type,
  schema: DnsNameEvent.schema,

  async handle(event, ctx) {
    const dnsName: string = event.payload.name;
    const isRootDomain: boolean = event.payload.isRoot || false;

    ctx.logger.debug("handling dns-name event", {
      id: event.id,
      message: dnsName,
    });

    // Persist state to the shared data store (SQLite or Postgres — same API).
    const history = ctx.store.repository<{seen: boolean}>("dns_subdomain_enum");

    if (event.payload.exclude) {
        await handleExcluded(ctx, dnsName, "dns_record_enum");
        return;
    }

    const alreadySeen = await history.get(dnsName);

    if (alreadySeen && !event.payload.force) {
      ctx.logger.debug("dns-subdomain-enum", {name: dnsName, message: "seen - skipping"});
      return;
    }
    
    if (isRootDomain) {
        ctx.logger.info("dns-subdomain-enum", {name: dnsName, message: "enumerating subdomain records"});

        // /path/to/subfinder -pc /path/to/subfinder/config.yml -nc -all -oJ -d somedomain.com.au
        // expected JSONL: {"host":"abcdef.somedomain.com.au","input":"somedomain.com.au","source":"securitytrails"}

        const result = await runCommand([SUBFINDER_BIN_PATH,"-pc", SUBFINDER_PROVIDER_CONF_PATH, "-nc", "-all", "-oJ", "-d",dnsName], "subfinder");
        if (result?.exitCode == 0) {
            const output = result.stdout.trim();
            if (output.length > 0) {
                const lines: string[] = output.split("\n");
                for (const line of lines) {
                    try {
                        const lineTrimmed = line.trim();
                        if (lineTrimmed.startsWith('{') && lineTrimmed.endsWith('}')) {
                            const result = JSON.parse(lineTrimmed) as SubfinderJsonResult;
                            ctx.logger.info("dns-subdomain-enum", { host: result.host });
                            await ctx.publish(DnsNameEvent.type, { 
                                name: result.host,
                                isRoot: false,
                                exclude: false,
                                force: false
                            });
                        }
                    } catch (err: unknown) {
                        ctx.logger.error("dns-subdomain-enum", { error: err });
                    }
                }
            }
        }
    } else {
      ctx.logger.debug("dns-subdomain-enum", {name: dnsName, message: "is not root domain - skipping"});
    }
    await history.put(dnsName, {seen: true});
  },
});

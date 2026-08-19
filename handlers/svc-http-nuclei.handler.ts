import { defineHandler } from "../src/core/handler/types.ts";
import { runCommand, type CommandResult } from "./common.ts";

import {
    ServiceHttpEvent,
    type ServiceHttpPayload
} from "../events/service.event.ts";


const NUCLEI_BIN = "nuclei";

type NucleiResult = {
    name: string,
    severity: string,
    description: string,
    template: string,
    results: string
}

interface NucleiJson {
    "template": string;
    "template-id": string;
    "template-url": string;
    "type": string;
    "host": string;
    "extracted-results": string[];
    "info": {
        [key: string]: string;
    };
}

export default defineHandler<ServiceHttpPayload>({
  eventType: ServiceHttpEvent.type,
  schema: ServiceHttpEvent.schema,

  async handle(event, ctx) {
    const svcHttp: ServiceHttpPayload = event.payload;
    const ipAddr: string = svcHttp.ip.address;
    const portNum: number = svcHttp.port.num;
    const hostNames: string[] = svcHttp.hostNames;
    const scheme: string = svcHttp.svcType.toLowerCase().indexOf("ssl") > -1 ? "https" : "http";
    const repoKey: string = `${scheme}_${ipAddr}_${portNum}`;

    ctx.logger.debug("handling svc-http event (nuclei)", {
      id: event.id,
      message: `${repoKey}`,
    });

    // Persist state to the shared data store (SQLite or Postgres — same API).
    const history = ctx.store.repository<{seen: boolean}>("svc_http_nuclei");
    const alreadySeen = await history.get(repoKey);

    if (alreadySeen) {
      ctx.logger.debug("svc-http-nuclei", {name: repoKey, message: "seen - skipping"});
      return;
    }

    ctx.logger.debug("svc-http-nuclei", {name: repoKey, message: "nuclei scan host"});

    for (const hostName of hostNames) {
        const url: string = `${scheme}://${hostName}:${portNum}`;
        const records: NucleiResult[] | undefined = await executeNucleiScan(url);

        if (!!records)
            for (const record of records) {
                ctx.logger.info("svc-http-nuclei result ", { url, data: record });
            }

    }

    await history.put(repoKey, {seen: true});
  },
});

export async function executeNucleiScan(
  url: string,
): Promise<NucleiResult[] | undefined> {

    let result: CommandResult | undefined = undefined;

    let cmd: string[] = [NUCLEI_BIN,"-u",url,"-jsonl"];

    result = await runCommand(cmd, "httpscan");

    if (result?.exitCode == 0) {
        const output = result.stdout.trim();
        return parseNucleiOutput(output);
    }
    return undefined;
}


function parseNucleiOutput(output: string): NucleiResult[] {
    const records: NucleiResult[] = new Array<NucleiResult>();

    if (output.length > 0) {
        const lines: string[] = output.split("\n");
        for (const line of lines) {
            try {
                const parsedData = JSON.parse(line) as NucleiJson;
                let r = parsedData["extracted-results"] || [];

                const result: NucleiResult = {
                    name: parsedData["info"]["name"] || "unknown",
                    severity: parsedData["info"]["severity"] || "unknown",
                    description: parsedData["info"]["description"] || "unknown",
                    template: parsedData["template-url"],
                    results: r.join('\n'),
                }
                records.push(result);
            } catch {
                console.log('json parse error',line)
            }
        }
        
    }
    return records;
}
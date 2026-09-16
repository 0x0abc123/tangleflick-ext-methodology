import { defineHandler } from "../src/core/handler/types.ts";
import { runCommand, type CommandResult } from "./common.ts";

import {
    ServiceHttpEvent,
    type ServiceHttpPayload
} from "../events/service.event.ts";


interface HttprevMeta {
  "name": string;
  "content": string;
}

interface HttprevForm {
  "action": string;
  "inputs": string[];
}

interface HttprevCert {
    "subject": string;
    "issuer": string;
    "san": string[];
    "from": string;
    "until": string;
    "serial": string;
}

interface HttprevJson {
  "title": string;
  "a_hrefs": string[];
  "link_hrefs": string[];
  "script_src": string[];
  "iframe_src": string[];
  "metas": HttprevMeta[];
  "forms": HttprevForm[];
  "comments": string[];
  "text": string;
  "headers": {
        [key: string]: string;
   };
  "statuscode": number;
  "url_scheme": string;
  "url_host": string;
  "url_port": string;
  "ipv4": string;
  "tlscert": HttprevCert;
}


const HTTPREV_CMD = "/opt/httprev/.venv/bin/python3";
const HTTPREV_ARGS = ["/opt/httprev/httprev.py", "-od", "-"];


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

    ctx.logger.debug("handling svc-http event (httprev)", {
      id: event.id,
      message: `${repoKey}`,
    });

    // Persist state to the shared data store (SQLite or Postgres — same API).
    const history = ctx.store.repository<{seen: boolean}>("svc_http_httprev");
    const alreadySeen = await history.get(repoKey);

    if (alreadySeen) {
      ctx.logger.debug("svc-http-httprev", {name: repoKey, message: "seen - skipping"});
      return;
    }

    ctx.logger.debug("svc-http-httprev", {name: repoKey, message: "httprev scan host"});

    for (const hostName of hostNames) {
        const url: string = `${scheme}://${hostName}:${portNum}`;
        const record: HttprevJson | undefined = await executeHttprevScan(url);

        if (!!record)
            ctx.logger.info("svc-http-httprev result", { url, data: record });
    }

    await history.put(repoKey, {seen: true});
  },
});

export async function executeHttprevScan(
  url: string,
): Promise<HttprevJson | undefined> {

    let result: CommandResult | undefined = undefined;

    let cmd: string[] = [HTTPREV_CMD, ...HTTPREV_ARGS, "-u", url];

    result = await runCommand(cmd, "httpscan");

    if (result?.exitCode == 0) {
        const output = result.stdout.trim();
        const parsedData = JSON.parse(output) as HttprevJson;
        return parsedData;
    }
    return undefined;
}



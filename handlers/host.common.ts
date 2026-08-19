import { z } from 'zod';
import { runCommand, type CommandResult } from "./common.ts";
import { isIpv6InCidr, isIpInCidr, cidrsOverlap, cidrsOverlapV6 } from "./cidr.common.ts";
import { type HandlerContext } from '@core/handler/types';
import { 
    IpSchema, 
    PortSchema, 
    type IpType, 
    type PortType 
} from "../events/common.ts";


/**
 * Shared handler logic reusable across Host/IP event types. Because it accepts a
 * generic `EventEnvelope` (payload typed as `unknown`), any handler can use it
 * as its `handle` regardless of the event's payload shape.
 *
 * Files that don't end in `.handler.ts` (like this one) are NOT auto-discovered,
 * so this is a plain helper, not a handler itself.
 */


// 1. Define the runtime schema (the validation blueprint)
export const HostPortScanRecordSchema = z.object({
    ip: IpSchema,
    port: PortSchema,
    serviceType: z.string().optional(),
    serviceVersion: z.string().optional(),
});

// 2. Extract the TypeScript type from the schema
export type HostPortScanRecord = z.infer<typeof HostPortScanRecordSchema>;

const NMAP_CMD = "nmap";

// ip, port/range, scantype: alive|open|fingerprint
type ScanType = "alive" | "open" | "fingerprint";


/*
    "f1": "Host:",
    "f2": "45.33.32.156",
    "f3": "(scanme.nmap.org)",
    "f4": "Status: Up"
  },
  {
    "f1": "Host:",
    "f2": "45.33.32.156",
    "f3": "(scanme.nmap.org)",
    "f4": "Ports: 22/open/tcp//ssh//OpenSSH 6.6.1p1 Ubuntu 2ubuntu2.13 (Ubuntu Linux; protocol 2.0)/, 80/open/tcp//http//Apache httpd 2.4.7 ((Ubuntu))/, 2000/open/tcp//tcpwrapped///, 5060/open/tcp//tcpwrapped///"
*/
function getNmapOpenPortRecords(host: string, data: string): HostPortScanRecord[] {
    const records: HostPortScanRecord[] = new Array<HostPortScanRecord>();
    if (data.toLowerCase().startsWith("status: up")) {
        records.push({
            ip: { 
                address: host || "0.0.0.0",
                version: 4,
                cidr: false, 
            },
            port: { num: 0, proto: "tcp" }
        });
    } else if (data.toLowerCase().startsWith("ports:")) {
        const portsString = data.substring("Ports: ".length);
        const portInstances = portsString.split(',');
        for (const portInstance of portInstances) {
            const parts = portInstance.split('/');
            // 0_portnum/1_state/2_proto/3_owner/4_service/5_rpcinfo/6_version
            if (parts[1] == "open") {
                records.push({
                    ip: { 
                        address: host || "0.0.0.0",
                        version: 4,
                        cidr: false, 
                    },
                    port: { 
                        num: parseInt(parts[0] || "0", 10), 
                        proto: parts[2] || "tcp" 
                    },
                    serviceType: parts[4] || "",
                    serviceVersion: parts[6] || ""
                });
            }
        }

    }
    return records;
}

function parseNmapOutput(output: string): HostPortScanRecord[] {
    const records: HostPortScanRecord[] = new Array<HostPortScanRecord>();

    if (output.length > 0) {
        const lines: string[] = output.split("\n");
        for (const line of lines) {
            const reMatchGroups: RegExpMatchArray | null = line.match(/(\S+)\s+(\S+)\s+(\S+)\s+(.*)/);
            if (reMatchGroups) {
                if (reMatchGroups[1] == "Host:" && !!reMatchGroups[2] && !!reMatchGroups[4]) {
                    const pr = getNmapOpenPortRecords(reMatchGroups[2], reMatchGroups[4]);
                    if (!!pr && pr.length > 0) {
                        records.push(...pr);
                    }
                }
            }
        }
        
    }
    return records;
}

// nmap -sn -PE -PP -PS22,80,443 -PA80,443 192.168.1.0/24
const NMAP_CMD_ALIVE = [NMAP_CMD,"-sn","-PE","-PP","-PS22,80,443","-PA80,443", "-oG","-"];

// nmap -sS -p 80 --open -n -Pn --min-rate 5000 target_ip
const NMAP_CMD_OPEN = [NMAP_CMD,"-Pn","-n","-sT","--open", "--min-rate","100", "--max-retries", "1", "-oG","-"];

// nmap -Pn -n -sV --open --min-rate 100 --max-retries 1 -oG - --top-ports 1000 1.2.3.4
const NMAP_CMD_FINGERPRINT = [NMAP_CMD,"-Pn","-n","-sV","--open", "--min-rate","100", "--max-retries", "1", "-oG","-"];

export async function executePortScan(
  ip: IpType,
  ports: PortType[],
  scanType: ScanType,
  excluded: string,
): Promise<HostPortScanRecord[] | undefined> {


  let result: CommandResult | undefined = undefined;

  // generate ports list:
  /*
  let portsCommaSeparated: string = "-";

  if (scanType == "open" || scanType == "fingerprint") {
    const portsList = new Array<number>();
    for (const p of ports) {
        if (p.proto == "tcp")
            portsList.push(p.num);
    }
    portsCommaSeparated = portsList.join(',');
  }
    */

  let cmd: string[] = [];
  switch (scanType) {
    case "alive":
        cmd = NMAP_CMD_ALIVE.concat([ip.address]);
        break;
    case "open":
        cmd = NMAP_CMD_OPEN.concat(["--top-ports","1000", ip.address]);
        break;
    case "fingerprint":
        cmd = NMAP_CMD_FINGERPRINT.concat(["--top-ports","1000", ip.address]);
        break;
    }

    if (excluded.length > 0)
        cmd = cmd.concat(["--exclude",excluded])
    result = await runCommand(cmd, "portscan");

    if (result?.exitCode == 0) {
        const output = result.stdout.trim();
        return parseNmapOutput(output);
    }
    return undefined;
}


const IP_CIDR_EXCLUSIONS = "ip_cidr_exclusions";

export async function setAddressExcluded(ctx: HandlerContext, ip: IpType) {
    const history = ctx.store.repository<boolean>(IP_CIDR_EXCLUSIONS);
    await history.put(ip.address, true);
    ctx.logger.info(IP_CIDR_EXCLUSIONS, {name: ip.address, message: "set exclusion"});
}

export async function unsetAddressExcluded(ctx: HandlerContext, ip: IpType) {
    const history = ctx.store.repository<boolean>(IP_CIDR_EXCLUSIONS);
    await history.delete(ip.address);
    ctx.logger.info(IP_CIDR_EXCLUSIONS, {name: ip.address, message: "unset exclusion"});
}

export function isCidr(ip: string): boolean {
    return ip.indexOf('/') >= 0
}

export function isV6(ip: string): boolean {
    return ip.indexOf(':') >= 0
}

export async function getExclusionsList(ctx: HandlerContext): Promise<string> {
    const history = ctx.store.repository<boolean>(IP_CIDR_EXCLUSIONS);
    const exclusions = await history.list();
    const exclusionsList: string[] = new Array<string>();
    exclusions.map(({id}) => { exclusionsList.push(id) });
    return exclusionsList.join(',');
}


// TODO: CIDR ip arguments do not check if a single-IP exclusion falls within the range
//  we are currently using nmap's --exclude option, so this function is not used at the moment  
export async function isAddressExcluded(ctx: HandlerContext, ip: IpType): Promise<boolean> {
    const history = ctx.store.repository<boolean>(IP_CIDR_EXCLUSIONS);
    const exclusionsList = await history.list();
    const exclusionsIpV4: Set<string> = new Set<string>();
    const exclusionsCidrV4: Set<string> = new Set<string>();
    const exclusionsIpV6: Set<string> = new Set<string>();
    const exclusionsCidrV6: Set<string> = new Set<string>();
    exclusionsList.map(({id}) => {
        if (isCidr(id))
            if (isV6(id))
                exclusionsCidrV6.add(id);
            else
                exclusionsCidrV4.add(id);
        else
            if (isV6(id))
                exclusionsIpV6.add(id);
            else
                exclusionsIpV4.add(id);
     });
    // simple case (matches entry)
    if (ip.version == 6) {
        if (!ip.cidr && exclusionsIpV6.has(ip.address))
            return true;
        if ( ip.cidr && exclusionsCidrV6.has(ip.address))
            return true;
    } else {
        if (!ip.cidr && exclusionsIpV4.has(ip.address))
            return true;
        if ( ip.cidr && exclusionsCidrV4.has(ip.address))
            return true;
    }
    // ip falls within excluded CIDRs, or CIDR overlaps with excluded CIDR
    if (ip.version == 6) {
        if (ip.cidr) {
            for (const ex of exclusionsCidrV6) {
                if (cidrsOverlapV6(ip.address, ex))
                    return true;
            }
        } else {
            for (const ex of exclusionsCidrV6) {
                if (isIpv6InCidr(ip.address, ex))
                    return true;
            }
        }
    } else {
        if (ip.cidr) {
            for (const ex of exclusionsCidrV4) {
                if (cidrsOverlap(ip.address, ex))
                    return true;
            }
        } else {
            for (const ex of exclusionsCidrV4) {
                if (isIpInCidr(ip.address, ex))
                    return true;
            }
        }
    }
    return false;
}

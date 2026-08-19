import { z } from 'zod';
import { runCommand } from "./common.ts";
import { type HandlerContext } from '@core/handler/types';

/**
 * Shared handler logic reusable across DNS event types. Because it accepts a
 * generic `EventEnvelope` (payload typed as `unknown`), any handler can use it
 * as its `handle` regardless of the event's payload shape.
 *
 * Files that don't end in `.handler.ts` (like this one) are NOT auto-discovered,
 * so this is a plain helper, not a handler itself.
 */


// 1. Define the runtime schema (the validation blueprint)
export const DigRecordSchema = z.object({
  name: z.string(),
  ttl: z.number(),
  class: z.string(),
  type: z.string(),
  data: z.string(),
});

// 2. Extract the TypeScript type from the schema
export type DigRecord = z.infer<typeof DigRecordSchema>;

// rotate randomly through public resolvers to avoid rate limiting
const dnsResolverList = ["1.1.1.1","8.8.8.8","1.0.0.1","8.8.4.4","149.112.112.112","9.9.9.9"];

function randomDnsResolver(): string {
  const ri: number = Math.round(Math.random() * (dnsResolverList.length-1));
  return dnsResolverList[ri] || "1.1.1.1";
}

export async function executeDig(
  dnsName: string,
  recType: string,
): Promise<DigRecord[] | null> {

  const records: DigRecord[] = new Array<DigRecord>();

  const resolver = randomDnsResolver();

  const result = await runCommand(["dig",`@${resolver}`,"+noall","+answer", recType, dnsName], "dig");
  if (result?.exitCode == 0) {
      const output = result.stdout.trim();
      if (output.length > 0) {
          const lines: string[] = output.split("\n");
          for (const line of lines) {
              const reMatchGroups: RegExpMatchArray | null = line.match(/(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)/);
              if (reMatchGroups) {
                  records.push({
                    name: reMatchGroups[1] || dnsName,
                    ttl: parseInt(reMatchGroups[2] || "0", 10),
                    class: reMatchGroups[3] || "",
                    type: reMatchGroups[4] || "",
                    data: reMatchGroups[5] || ""
                  });
              }
          }
          return records;
      }
  }
  return null;
}


export async function handleExcluded(ctx: HandlerContext, key: string, repoName: string) {
    const history = ctx.store.repository<{seen: boolean}>(repoName);
    await history.put(key, {seen: true});
    ctx.logger.info(repoName, {name: key, message: "exclude - ignoring"});
}

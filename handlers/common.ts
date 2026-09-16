import { z } from 'zod';

// shared, process-wide command limiter. Files not ending in
// `.handler.ts` are NOT auto-discovered, so this is a plain helper.

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();        // hand the slot straight to the next waiter
    else this.active--;
  }
}

// One instance, imported by every handler → the cap is global across all
// handlers and all in-flight events.

type CommandGroup = {
    throttler: Semaphore,
    timeout: number,
}

const commandThrottleGroups: Record<string, CommandGroup> = {
    default: { 
        throttler: new Semaphore(Number(2)), 
        timeout: 3600*1000 // 1 hour
    },
    dig: { 
        throttler: new Semaphore(Number(2)), 
        timeout: 3*1000 // 3 sec
    },
    subfinder: { 
        throttler: new Semaphore(Number(1)), 
        timeout: 1800*1000 // 30 mins
    },
    portscan: { 
        throttler: new Semaphore(Number(1)), 
        timeout: 3600*1000 // 60 mins
    },
    httpscan: { 
        throttler: new Semaphore(Number(1)), 
        timeout: 3600*1000 // 60 mins
    },
};

const CommandResultSchema = z.object({
  stdout: z.string().default(""),
  stderr: z.string().default(""),
  exitCode: z.number(),
});

export type CommandResult = z.infer<typeof CommandResultSchema>;


export async function runCommand(commandAndArgs: string[], throttleGroup: string = "default"): Promise<CommandResult | undefined> {
    if (!(throttleGroup in commandThrottleGroups)) {
        throw new Error(`unknown throttle group ${throttleGroup}`)
    }
    const tg = commandThrottleGroups[throttleGroup];
    const throttledRunner = tg?.throttler;
    const commandResult = await throttledRunner?.run(async () => {
        const controller = new AbortController();
        const proc = Bun.spawn(commandAndArgs, {
            stdout: "pipe",
            stderr: "pipe",
            signal: controller.signal,
            timeout: tg?.timeout || 10*1000
        });
        const exitCode = await proc.exited;
        const stdout = await proc.stdout.text();
        const stderr = await proc.stderr.text();
        const _commandResult: CommandResult = { exitCode, stdout, stderr };
        return _commandResult;
    });
    return commandResult;
}



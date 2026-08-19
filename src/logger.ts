/**
 * Minimal leveled logger. No external dependency — good enough for a template,
 * and easy for users to swap for pino/winston if they want.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function write(
  level: LogLevel,
  minLevel: LogLevel,
  bindings: Record<string, unknown>,
  msg: string,
  meta?: Record<string, unknown>,
): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const record = {
    level,
    time: new Date().toISOString(),
    msg,
    ...bindings,
    ...meta,
  };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(
  minLevel: LogLevel = "info",
  bindings: Record<string, unknown> = {},
): Logger {
  return {
    debug: (msg, meta) => write("debug", minLevel, bindings, msg, meta),
    info: (msg, meta) => write("info", minLevel, bindings, msg, meta),
    warn: (msg, meta) => write("warn", minLevel, bindings, msg, meta),
    error: (msg, meta) => write("error", minLevel, bindings, msg, meta),
    child: (extra) => createLogger(minLevel, { ...bindings, ...extra }),
  };
}

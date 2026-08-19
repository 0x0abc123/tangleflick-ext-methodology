import { ConfigSchema, type Config } from "./schema.ts";

export const DEFAULT_CONFIG_PATH = "config/config.json";

/**
 * Read, parse and validate the JSON config file. On validation failure prints
 * a readable error and throws — the caller (Application) exits non-zero.
 */
export async function loadConfig(
  path: string = process.env.TANGLEFLICK_CONFIG ?? DEFAULT_CONFIG_PATH,
): Promise<Config> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(
      `Config file not found at "${path}". Copy config/config.example.json to config/config.json and edit it.`,
    );
  }

  let raw: unknown;
  try {
    raw = await file.json();
  } catch (err) {
    throw new Error(
      `Config file "${path}" is not valid JSON: ${(err as Error).message}`,
    );
  }

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid config in "${path}":\n${issues}`);
  }

  return result.data;
}

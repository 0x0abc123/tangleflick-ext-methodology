import { Application } from "./application.ts";

const app = new Application();

app.run().catch((err: unknown) => {
  console.error(`[tangleflick] fatal: ${(err as Error).message}`);
  process.exit(1);
});

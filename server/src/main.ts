import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createPool } from "./db.js";
import { readFixture } from "./fixture/load.js";
import { startConsumerTicks } from "./tick.js";

const pool = createPool();
const port = Number(process.env.PORT ?? 3002);
const production = process.env.NODE_ENV === "production";
const app = createApp(pool, production ? {} : { demo: readFixture() });

serve({ fetch: app.fetch, port }, () => console.log(`server on http://localhost:${port}`));

if (process.env.CONSUMER !== "off") {
  const interval = Number(process.env.CONSUMER_TICK_MS ?? 1000);
  startConsumerTicks(pool, interval, (result) => {
    if (result instanceof Error) console.error(`consumer tick failed: ${result.message}`);
    else if (result.outcome === "processed")
      console.log(
        `checkpoint ${result.checkpoint}: applied ${result.applied}, duplicates ${result.duplicates}, conflicts ${result.conflicts}, restatements ${result.restatements}`,
      );
  });
}

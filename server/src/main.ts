import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createPool } from "./db.js";

const pool = createPool();
const port = Number(process.env.PORT ?? 3002);
serve({ fetch: createApp(pool).fetch, port }, () =>
  console.log(`server on http://localhost:${port}`),
);

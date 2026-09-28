import { processUntilCaughtUp } from "./consumer.js";
import { createPool } from "./db.js";

const pool = createPool();
const results = await processUntilCaughtUp(pool);
const processed = results.filter((r) => r.outcome === "processed");
const last = results.at(-1);
console.log(
  `${processed.length} batches, checkpoint ${last?.checkpoint ?? 0}, applied ${processed.reduce((n, r) => n + r.applied, 0)}, duplicates ${processed.reduce((n, r) => n + r.duplicates, 0)}, conflicts ${processed.reduce((n, r) => n + r.conflicts, 0)}, restatements ${processed.reduce((n, r) => n + r.restatements, 0)}, stopped because ${last?.outcome}`,
);
await pool.end();

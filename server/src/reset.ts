import { createPool } from "./db.js";
import { loadFixture, readFixture } from "./fixture/load.js";
import { migrate } from "./migrate.js";

const pool = createPool();
await migrate(pool);
const fixture = readFixture();
await loadFixture(pool, fixture);
console.log(
  `loaded ${fixture.deliveries.length} deliveries, head at ${fixture.initial_head}, checkpoint 0`,
);
await pool.end();

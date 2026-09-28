import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import { migrate } from "../src/migrate.js";

const pool = createPool(
  process.env.TEST_DATABASE_URL ?? "postgres://fresh:fresh@localhost:5433/fresh_ledger_test",
);

beforeAll(async () => {
  await migrate(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("health", () => {
  it("answers with the database time", async () => {
    const response = await createApp(pool).request("/api/health");
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });
});

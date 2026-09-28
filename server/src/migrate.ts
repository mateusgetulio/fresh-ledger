import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { createPool } from "./db.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function migrate(pool: pg.Pool): Promise<string[]> {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const applied = new Set(
    (await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map(
      (r) => r.name,
    ),
  );
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(readFileSync(join(migrationsDir, file), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      ran.push(file);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return ran;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool();
  const ran = await migrate(pool);
  console.log(ran.length === 0 ? "nothing to migrate" : `applied ${ran.join(", ")}`);
  await pool.end();
}

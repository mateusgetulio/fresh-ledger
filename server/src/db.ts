import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const NUMERIC_OID = 1700;
pg.types.setTypeParser(NUMERIC_OID, (value) => value);

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "postgres://fresh:fresh@localhost:5433/fresh_ledger";
}

export function createPool(url: string = databaseUrl()): pg.Pool {
  return new pg.Pool({ connectionString: url, max: 5, options: "-c TimeZone=UTC" });
}

const sqlDir = join(dirname(fileURLToPath(import.meta.url)), "..", "sql");

export function loadSql(name: string): string {
  return readFileSync(join(sqlDir, `${name}.sql`), "utf8");
}

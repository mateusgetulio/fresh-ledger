import { Hono } from "hono";
import type pg from "pg";

export function createApp(pool: pg.Pool): Hono {
  const app = new Hono();
  app.get("/api/health", async (c) => {
    const { rows } = await pool.query<{ now: string }>("SELECT now()::text AS now");
    return c.json({ ok: true, now: rows[0]?.now ?? null });
  });
  return app;
}

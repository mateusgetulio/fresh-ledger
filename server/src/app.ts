import { Hono } from "hono";
import type pg from "pg";
import { applyDemoAction, DEMO_ACTIONS, type DemoAction, type DemoOffsets } from "./demo.js";
import { currentMetrics, metricsHistory, restatements } from "./metrics.js";

export interface AppOptions {
  demo?: DemoOffsets;
}

export function createApp(pool: pg.Pool, options: AppOptions = {}): Hono {
  const app = new Hono();
  app.get("/api/health", async (c) => {
    const { rows } = await pool.query<{ now: string }>("SELECT now()::text AS now");
    return c.json({ ok: true, now: rows[0]?.now ?? null });
  });
  app.get("/api/metrics/current", async (c) => c.json(await currentMetrics(pool)));
  app.get("/api/metrics/history", async (c) => c.json(await metricsHistory(pool)));
  app.get("/api/restatements", async (c) => c.json(await restatements(pool)));

  const demo = options.demo;
  if (demo) {
    app.post("/api/demo/:action", async (c) => {
      const action = c.req.param("action");
      if (!isDemoAction(action)) return c.json({ error: `unknown demo action ${action}` }, 404);
      return c.json(await applyDemoAction(pool, action, demo));
    });
  }
  return app;
}

function isDemoAction(value: string): value is DemoAction {
  return (DEMO_ACTIONS as string[]).includes(value);
}

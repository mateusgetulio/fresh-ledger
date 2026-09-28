import { Hono } from "hono";
import type pg from "pg";
import {
  applyDemoAction,
  DEMO_ACTIONS,
  demoInfo,
  offsetsOf,
  resetDemo,
  type DemoAction,
} from "./demo.js";
import type { Fixture } from "./fixture/generate.js";
import { currentMetrics, deliveryAt, metricsHistory, restatements } from "./metrics.js";

export interface AppOptions {
  demo?: Fixture;
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
  app.get("/api/deliveries/:offset", async (c) => {
    const offset = Number(c.req.param("offset"));
    if (!Number.isInteger(offset) || offset < 1) return c.json({ error: "bad offset" }, 400);
    const delivery = await deliveryAt(pool, offset);
    return delivery ? c.json(delivery) : c.json({ error: `no delivery at offset ${offset}` }, 404);
  });

  const fixture = options.demo;
  if (fixture) {
    const offsets = offsetsOf(fixture);
    app.get("/api/demo", async (c) => c.json(await demoInfo(pool, fixture)));
    app.post("/api/demo/reset", async (c) => c.json(await resetDemo(pool, fixture)));
    app.post("/api/demo/:action", async (c) => {
      const action = c.req.param("action");
      if (!isDemoAction(action)) return c.json({ error: `unknown demo action ${action}` }, 404);
      return c.json(await applyDemoAction(pool, action, offsets));
    });
  }
  return app;
}

function isDemoAction(value: string): value is DemoAction {
  return (DEMO_ACTIONS as string[]).includes(value);
}

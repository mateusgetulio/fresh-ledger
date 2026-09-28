import type pg from "pg";
import { processBatch, type BatchResult } from "./consumer.js";

export interface Ticker {
  stop: () => void;
}

export function startConsumerTicks(
  pool: pg.Pool,
  intervalMs: number,
  onResult: (result: BatchResult | Error) => void = () => undefined,
): Ticker {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      onResult(await processBatch(pool));
    } catch (error) {
      onResult(error instanceof Error ? error : new Error(String(error)));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  return { stop: () => clearInterval(timer) };
}

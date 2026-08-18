/**
 * Minimal Server-Timing emitter.
 *
 * Diagnostic seam only: it measures wall-clock around a stage and appends a
 * `Server-Timing` entry. It never inspects, logs or emits the stage's value —
 * only its duration — so no credential, token, id, SQL or PII can leak through
 * the header.
 *
 * Uses a monotonic clock so a wall-clock adjustment mid-request cannot produce
 * a negative or wildly wrong duration.
 */
import type { NextApiResponse } from 'next';

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/** Stage names are fixed identifiers chosen by the caller — never user input. */
const SAFE_NAME = /^[a-z][a-z0-9_]*$/i;

export function appendServerTiming(res: NextApiResponse, name: string, durationMs: number): void {
  try {
    if (!SAFE_NAME.test(name) || !Number.isFinite(durationMs) || durationMs < 0) return;
    if (res.headersSent) return;
    const entry = `${name};dur=${Math.round(durationMs)}`;
    const existing = res.getHeader('Server-Timing');
    const next = existing ? `${String(existing)}, ${entry}` : entry;
    res.setHeader('Server-Timing', next);
  } catch {
    // Instrumentation must never break a response.
  }
}

/**
 * Times `fn`, records the stage, and returns its result untouched. The timing
 * is recorded on the failure path too — a stage that throws is exactly the one
 * worth measuring — and the original error is always rethrown unchanged.
 */
export async function timeStage<T>(
  res: NextApiResponse,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = now();
  try {
    return await fn();
  } finally {
    appendServerTiming(res, name, now() - start);
  }
}

/**
 * Timing sink for code below the HTTP layer.
 *
 * Services should not receive `res` just to be measured — that couples them to
 * the transport. They take a `TimingSink` instead: an optional collector the
 * caller drains into `Server-Timing` afterwards. Absent sink = zero overhead
 * and no behaviour change, so every existing caller is unaffected.
 */
export type TimingSink = { record(name: string, durationMs: number): void };

export function createTimingSink(): TimingSink & { entries(): Array<[string, number]> } {
  const rows: Array<[string, number]> = [];
  return {
    record(name: string, durationMs: number) {
      if (Number.isFinite(durationMs) && durationMs >= 0) rows.push([name, durationMs]);
    },
    entries: () => rows,
  };
}

/** Times `fn` into an optional sink. Result and errors pass through untouched. */
export async function timeInto<T>(
  sink: TimingSink | undefined,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!sink) return fn();
  const start = now();
  try {
    return await fn();
  } finally {
    sink.record(name, now() - start);
  }
}

/** Drains a sink onto the response as Server-Timing entries. */
export function flushTimingSink(
  res: NextApiResponse,
  sink: { entries(): Array<[string, number]> },
): void {
  for (const [name, dur] of sink.entries()) appendServerTiming(res, name, dur);
}

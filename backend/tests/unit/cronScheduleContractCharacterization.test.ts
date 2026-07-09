/**
 * CHARACTERIZATION (source contract) — backend/scheduler/cron.ts
 *
 * cron.ts cannot be safely EXECUTED under jest: startCron() immediately runs a
 * full runSchedulerCycle() (the publish pipeline), spawns ~22 self-rescheduling
 * jittered timers, and reads/writes Redis-backed cron-guard state through 42
 * module-level mutable variables. A prior decomposition attempt was reverted
 * for exactly these coupling reasons (see commit 6b8eff1e findings).
 *
 * What CAN — and must — be locked is the SCHEDULING CONTRACT itself, because
 * "never change scheduler timing" is a standing non-negotiable:
 *
 *   1. every timing constant definition (name → expression),
 *   2. the recurring-worker registry (interval constant ↔ worker label),
 *   3. the cron-guard restore map (Redis persistence keys),
 *   4. the base-tick wiring.
 *
 * This test extracts those tables from the SOURCE (same pattern as the repo's
 * other enforcement scans, e.g. generateFontParity) and golden-masters them.
 * Renaming a worker label, changing an interval, adding/removing a worker, or
 * dropping a guard key now fails CI until the snapshot is updated deliberately.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const CRON_PATH = join(__dirname, '../../scheduler/cron.ts');
const src = readFileSync(CRON_PATH, 'utf8');

describe('cron.ts scheduling contract (source characterization)', () => {
  it('locks every timing-constant definition', () => {
    const constants: Record<string, string> = {};
    const re = /^const ([A-Z_0-9]+(?:_MS|_SECONDS|_HOURS))\s*=\s*([^;]+);/gm;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      constants[m[1]] = m[2].trim();
    }
    expect(Object.keys(constants).length).toBeGreaterThanOrEqual(35);
    expect(constants).toMatchSnapshot('timing-constants');
  });

  it('locks the recurring-worker registry (interval constant ↔ label)', () => {
    // scheduleWorker call sites pass `INTERVAL_CONST, 'label',` on one line.
    const registry: Array<{ interval: string; label: string }> = [];
    const re = /^\s*([A-Z_0-9]+_MS),\s*'([^']+)'/gm;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      registry.push({ interval: m[1], label: m[2] });
    }
    // Line-anchored: counts call sites only (not the declaration or comments).
    const scheduleWorkerCalls = (src.match(/^\s*scheduleWorker\(/gm) ?? []).length;
    expect(registry.length).toBe(scheduleWorkerCalls);
    // No duplicate labels — each worker is registered exactly once.
    const labels = registry.map((r) => r.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(registry).toMatchSnapshot('worker-registry');
  });

  it('locks the cron-guard restore map (Redis persistence keys)', () => {
    const keys = new Set<string>();
    const re = /saved\.([a-zA-Z0-9]+)\s*\?\?/g;
    for (let m = re.exec(src); m; m = re.exec(src)) keys.add(m[1]);
    expect(keys.size).toBeGreaterThanOrEqual(25);
    expect([...keys].sort()).toMatchSnapshot('cron-guard-restore-keys');
  });

  it('locks the base-tick wiring (publish cycle cadence)', () => {
    // The publish cycle is gated by shouldRunPublishCycle() on a BASE_TICK_MS interval.
    expect(src).toMatch(/setInterval\([\s\S]{0,200}?shouldRunPublishCycle\(\)[\s\S]{0,200}?BASE_TICK_MS\)/);
    // Startup runs the cycle immediately (before the first tick).
    expect(src).toMatch(/_lastPublishCycleRun = Date\.now\(\);\s*\n\s*await runSchedulerCycle\(\);/);
    const baseTick = src.match(/const BASE_TICK_MS\s*=\s*([^;]+);/);
    expect(baseTick?.[1].trim()).toMatchSnapshot('base-tick');
  });

  it('locks the worker tick semantics (jitter, error containment, self-reschedule)', () => {
    const fn = src.slice(src.indexOf('function scheduleWorker('), src.indexOf('async function startCron()'));
    // Jittered delay, never a fixed-phase interval.
    expect(fn).toContain('const delay = intervalMs + Math.random() * jitterMs;');
    // A worker error must not kill the loop: caught, logged, and the tick re-arms.
    expect(fn).toContain('cronInstr.workerExecuted(label, hadError);');
    expect(fn).toMatch(/catch[\s\S]*?worker error/);
    // Self-reschedules after completion (no overlapping runs of the same worker).
    expect(fn).toMatch(/tick\(\);\s*\}, delay\)/);
  });
});

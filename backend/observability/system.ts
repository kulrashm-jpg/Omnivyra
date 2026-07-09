/**
 * HARDEN-001 — System resource sampler.
 *
 * Periodically samples RSS/heap memory, process CPU %, and event-loop lag using
 * only Node built-ins (perf_hooks, process). Starts at most once per process,
 * runs on an unref'd timer (never keeps the process alive), and is fully
 * fail-safe. Disabled by default in serverless (short-lived) environments.
 */
import { monitorEventLoopDelay } from 'perf_hooks';
import { recordSystem } from './metrics';
import { observabilityConfig } from './config';

let started = false;

export function startSystemSampler(): void {
  try {
    if (started) return;
    if (!observabilityConfig.enabled || !observabilityConfig.system) return;
    const intervalMs = observabilityConfig.systemSampleMs;
    if (!intervalMs || intervalMs <= 0) return;
    started = true;

    let loopMonitor: ReturnType<typeof monitorEventLoopDelay> | null = null;
    try {
      loopMonitor = monitorEventLoopDelay({ resolution: 20 });
      loopMonitor.enable();
    } catch { loopMonitor = null; }

    let lastCpu = process.cpuUsage();
    let lastTs = Date.now();

    const timer = setInterval(() => {
      try {
        const mem = process.memoryUsage();
        const nowTs = Date.now();
        const cpu = process.cpuUsage(lastCpu);
        const elapsedUs = Math.max(1, (nowTs - lastTs) * 1000);
        const cpuPct = ((cpu.user + cpu.system) / elapsedUs) * 100;
        lastCpu = process.cpuUsage();
        lastTs = nowTs;

        let loopLagMs = 0;
        if (loopMonitor) {
          // mean is in nanoseconds; convert to ms and reset the window.
          loopLagMs = loopMonitor.mean / 1e6;
          loopMonitor.reset();
        }

        recordSystem({
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          cpuPct: Number.isFinite(cpuPct) ? cpuPct : 0,
          loopLagMs: Number.isFinite(loopLagMs) ? loopLagMs : 0,
        });
      } catch { /* fail-safe */ }
    }, intervalMs);

    // Do not keep the event loop alive because of the sampler.
    if (typeof timer.unref === 'function') timer.unref();
  } catch { /* fail-safe */ }
}

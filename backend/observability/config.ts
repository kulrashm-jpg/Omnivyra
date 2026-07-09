/**
 * HARDEN-001 — Observability configuration.
 *
 * All observability behavior is env-driven and read ONCE at module load. Every
 * flag defaults to a lightweight, production-safe value so enabling the module
 * never changes application behavior or adds meaningful overhead.
 *
 * Instrumentation is purely additive: when disabled, every record* call is a
 * cheap no-op (see registry/metrics). This module NEVER throws.
 */

function boolEnv(name: string, dflt: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return dflt;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function numEnv(name: string, dflt: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : dflt;
}

const isProd = process.env.NODE_ENV === 'production';

export interface ObservabilityConfig {
  /** Master switch. Off → all record* calls no-op. */
  enabled: boolean;
  /** Per-domain switches (all gated by `enabled` too). */
  api: boolean;
  db: boolean;
  ai: boolean;
  queue: boolean;
  scheduler: boolean;
  worker: boolean;
  externalApi: boolean;
  cache: boolean;
  system: boolean;
  /** Fraction of DB queries to time (1 = all). Keeps hot paths cheap in prod. */
  dbSampleRate: number;
  /** A DB query at/over this many ms is tracked as "slow" + logged at WARN. */
  slowDbMs: number;
  /** An API request at/over this many ms is tracked as "slow" + logged at WARN. */
  slowApiMs: number;
  /** An AI provider call at/over this many ms is flagged slow. */
  slowAiMs: number;
  /** Max distinct metric series retained (cardinality guard → bounded memory). */
  maxSeries: number;
  /** Per-series reservoir size for percentile estimation. */
  histogramSamples: number;
  /** Size of each "top-N" leaderboard (slow endpoints, largest payloads, …). */
  topN: number;
  /** System sampler interval (ms). 0 → disabled. */
  systemSampleMs: number;
  /** Emit a structured log line for each slow event (in addition to metrics). */
  logSlow: boolean;
}

export const observabilityConfig: ObservabilityConfig = (() => {
  const enabled = boolEnv('OBSERVABILITY_ENABLED', true);
  return {
    enabled,
    api: boolEnv('OBSERVABILITY_API', true),
    db: boolEnv('OBSERVABILITY_DB', true),
    ai: boolEnv('OBSERVABILITY_AI', true),
    queue: boolEnv('OBSERVABILITY_QUEUE', true),
    scheduler: boolEnv('OBSERVABILITY_SCHEDULER', true),
    worker: boolEnv('OBSERVABILITY_WORKER', true),
    externalApi: boolEnv('OBSERVABILITY_EXTERNAL_API', true),
    cache: boolEnv('OBSERVABILITY_CACHE', true),
    system: boolEnv('OBSERVABILITY_SYSTEM', true),
    // In prod default to sampling 20% of DB queries; dev times everything.
    dbSampleRate: numEnv('OBSERVABILITY_DB_SAMPLE_RATE', isProd ? 0.2 : 1),
    slowDbMs: numEnv('OBSERVABILITY_SLOW_DB_MS', 400),
    slowApiMs: numEnv('OBSERVABILITY_SLOW_API_MS', 1500),
    slowAiMs: numEnv('OBSERVABILITY_SLOW_AI_MS', 8000),
    maxSeries: numEnv('OBSERVABILITY_MAX_SERIES', 5000),
    histogramSamples: numEnv('OBSERVABILITY_HISTOGRAM_SAMPLES', 256),
    topN: numEnv('OBSERVABILITY_TOP_N', 20),
    // System sampler off by default in serverless (Vercel) where processes are
    // short-lived; on by default elsewhere (worker). 0 disables.
    systemSampleMs: numEnv('OBSERVABILITY_SYSTEM_SAMPLE_MS', process.env.VERCEL ? 0 : 15000),
    logSlow: boolEnv('OBSERVABILITY_LOG_SLOW', true),
  };
})();

/** True when the module + a specific domain are both enabled. */
export function domainEnabled(domain: keyof Omit<ObservabilityConfig,
  'enabled' | 'dbSampleRate' | 'slowDbMs' | 'slowApiMs' | 'slowAiMs' | 'maxSeries'
  | 'histogramSamples' | 'topN' | 'systemSampleMs' | 'logSlow'>): boolean {
  return observabilityConfig.enabled && observabilityConfig[domain] === true;
}

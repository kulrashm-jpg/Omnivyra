/**
 * WS-2 Milestone-3A — performance & operational validation.
 *
 * MEASURES the shipped implementation. It changes nothing, and it is not part
 * of the runtime: it constructs snapshots at controlled sizes and times the
 * real engines, so every number below is an observation.
 *
 *   node --expose-gc -r tsx/cjs scripts/ws2-m3a-performance-validation.ts
 *   ... --worker <sizeKey>     → print one envelope hash (cross-process check)
 *
 * Lead size classes are anchored to the REAL snapshot caps in snapshotSource:
 * events 1000, sessions 200, touchpoints 1000 — so "max" is the largest lead
 * the platform can actually load, not an arbitrary number.
 */
/* eslint-disable no-console */

import { createHash } from 'crypto';
import {
  assembleLeadCaptureSnapshot,
  analyzeBehavior,
  buildEvolutionIntelligence,
  buildLeadIntelligenceSummary,
  buildLeadTimeline,
  buildQualification,
  buildRecommendations,
  classifyPersona,
  computeIntentIntelligence,
  defaultEngineConfig,
  type LeadCaptureSnapshot,
} from '../backend/services/leadIntelligenceEngine';
import { registry } from '../backend/observability/registry';

const DAY = 86_400_000;
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const PAGES = ['/', '/pricing', '/demo', '/docs/api', '/security', '/enterprise', '/compare/x', '/case-studies/a', '/blog/p1', '/resources'];
const EVENT_MIX = ['page_view', 'page_view', 'page_view', 'search', 'download', 'video_started', 'video_progress', 'video_completed', 'cta_click'];

/** Deterministic pseudo-random so every run builds the SAME corpus. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type SizeKey = 'small' | 'medium' | 'large' | 'max';
const SIZES: Record<SizeKey, { sessions: number; events: number; touchpoints: number }> = {
  small: { sessions: 1, events: 5, touchpoints: 1 },
  medium: { sessions: 5, events: 50, touchpoints: 10 },
  large: { sessions: 25, events: 300, touchpoints: 100 },
  max: { sessions: 200, events: 1000, touchpoints: 1000 }, // the real snapshot caps
};

function buildSnapshot(size: SizeKey, tenantSeed = 1): LeadCaptureSnapshot {
  const { sessions, events, touchpoints } = SIZES[size];
  const rnd = lcg(size.length * 7919 + tenantSeed);

  const sessionRows = Array.from({ length: sessions }, (_, i) => ({
    id: `vs-${i}`,
    started_at: iso(T0 + i * DAY),
    last_seen_at: iso(T0 + i * DAY + 900_000),
    first_landing_page: 'https://x.test/',
    last_current_page: `https://x.test${PAGES[i % PAGES.length]}`,
    metadata: {
      visitor: { visit_count: i + 1, returning_visitor: i > 0, first_visit_at: iso(T0), session_duration_ms: 900_000 },
      device: { deviceCategory: i % 3 === 0 ? 'mobile' : 'desktop', browser: i % 2 === 0 ? 'Chrome' : 'Safari', os: 'Windows', platform: 'windows' },
      geo: { timezone: 'Europe/Berlin', country: 'DE', region: 'BE', city: 'Berlin' },
    },
  }));

  const eventRows = Array.from({ length: events }, (_, i) => {
    const s = i % Math.max(1, sessions);
    const name = EVENT_MIX[Math.floor(rnd() * EVENT_MIX.length)];
    return {
      id: `e-${i}`,
      event_name: name,
      page_url: `https://x.test${PAGES[Math.floor(rnd() * PAGES.length)]}`,
      visitor_session_id: `vs-${s}`,
      occurred_at: iso(T0 + s * DAY + (i % 900) * 1000),
      metadata: {
        scroll_depth: Math.floor(rnd() * 100),
        dwell_seconds: Math.floor(rnd() * 120),
        query: name === 'search' ? `term ${i % 17}` : undefined,
        asset_name: name === 'download' ? `asset-${i % 11}.pdf` : undefined,
        video_title: name.startsWith('video') ? `video-${i % 5}` : undefined,
        percent: name === 'video_progress' ? Math.floor(rnd() * 100) : undefined,
      },
    };
  });

  const touchpointRows = Array.from({ length: touchpoints }, (_, i) => ({
    id: `tp-${i}`,
    touchpoint_type: i === 0 ? 'first_touch' : 'event',
    source: 'google',
    medium: 'cpc',
    campaign: `c-${i % 9}`,
    page_url: `https://x.test${PAGES[i % PAGES.length]}`,
    touched_at: iso(T0 + (i % Math.max(1, sessions)) * DAY),
  }));

  return assembleLeadCaptureSnapshot({
    leadRow: {
      id: `L-${tenantSeed}`, company_id: `co-${tenantSeed}`, email: `cto${tenantSeed}@bigcorp.com`,
      created_at: iso(T0 + Math.max(0, sessions - 1) * DAY + 800_000),
      visitor_session_id: 'vs-0',
      metadata: { job_title: 'CTO', company_name: 'BigCorp', company_size: '1000+', industry: 'Finance' },
    },
    trackingEventRows: eventRows,
    visitorSessionRows: sessionRows,
    touchpointRows,
    now: iso(T0 + sessions * DAY + 3_600_000),
  });
}

const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

// ── worker mode: one envelope hash, for the cross-process check ─────────────
const workerArg = process.argv.indexOf('--worker');
if (workerArg >= 0) {
  const size = (process.argv[workerArg + 1] ?? 'medium') as SizeKey;
  console.log(hash(buildLeadIntelligenceSummary(buildSnapshot(size))));
  process.exit(0);
}

// ── timing helpers ──────────────────────────────────────────────────────────
type Stats = { p50: number; p95: number; p99: number; mean: number; max: number; n: number };
const pct = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
function stats(samples: number[]): Stats {
  const s = [...samples].sort((a, b) => a - b);
  return {
    p50: pct(s, 0.5), p95: pct(s, 0.95), p99: pct(s, 0.99),
    mean: s.reduce((a, b) => a + b, 0) / s.length, max: s[s.length - 1], n: s.length,
  };
}
const ms = (n: number) => `${n.toFixed(2)}`;
const row = (label: string, st: Stats) =>
  `  ${label.padEnd(30)} p50 ${ms(st.p50).padStart(8)}  p95 ${ms(st.p95).padStart(8)}  p99 ${ms(st.p99).padStart(8)}  max ${ms(st.max).padStart(8)}  (n=${st.n})`;

function time(fn: () => unknown, iterations: number): Stats {
  fn(); // warm the JIT so the first sample is not an outlier
  const out: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const t0 = process.hrtime.bigint();
    fn();
    out.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return stats(out);
}

const findings: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string) => {
  findings.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(44)} ${detail}`);
};

const gc = (): void => { (global as { gc?: () => void }).gc?.(); };
const heapMB = (): number => { gc(); return process.memoryUsage().heapUsed / 1048576; };

const ITERATIONS: Record<SizeKey, number> = { small: 400, medium: 200, large: 60, max: 25 };

(async () => {
  console.log(`\nWS-2 M3A PERFORMANCE VALIDATION   node ${process.version}   gc=${(global as { gc?: unknown }).gc ? 'exposed' : 'UNAVAILABLE'}\n`);

  // ── 2. SCALE ──────────────────────────────────────────────────────────────
  console.log('── 2. SCALE: component latency by lead size (ms) ──\n');
  const envelopeStats: Partial<Record<SizeKey, Stats>> = {};
  const replayStats: Partial<Record<SizeKey, Stats>> = {};

  for (const size of Object.keys(SIZES) as SizeKey[]) {
    const snap = buildSnapshot(size);
    const n = ITERATIONS[size];
    const behavior = analyzeBehavior(snap, defaultEngineConfig);
    const intent = computeIntentIntelligence(snap, defaultEngineConfig, behavior);
    const persona = classifyPersona(snap, defaultEngineConfig, behavior);
    const evolution = buildEvolutionIntelligence(snap, defaultEngineConfig, behavior);
    const qualification = buildQualification({ snapshot: snap, intent, persona, evolution }, defaultEngineConfig, behavior);

    console.log(`${size.toUpperCase()}  (${SIZES[size].sessions} sessions, ${SIZES[size].events} events, ${SIZES[size].touchpoints} touchpoints, ${evolution.intent.checkpoints.length} checkpoints)`);
    const behaviourSt = time(() => analyzeBehavior(snap, defaultEngineConfig), n);
    const replaySt = time(() => buildEvolutionIntelligence(snap, defaultEngineConfig, behavior), n);
    const qualSt = time(() => buildQualification({ snapshot: snap, intent, persona, evolution }, defaultEngineConfig, behavior), n);
    const recSt = time(() => buildRecommendations({ snapshot: snap, intent, persona, qualification, segments: [], evolution }, defaultEngineConfig, behavior), n);
    const tlSt = time(() => buildLeadTimeline(snap, { evolution }, defaultEngineConfig), n);
    const envSt = time(() => buildLeadIntelligenceSummary(snap), n);

    console.log(row('behaviour analysis', behaviourSt));
    console.log(row('replay (evolution)', replaySt));
    console.log(row('qualification', qualSt));
    console.log(row('recommendation', recSt));
    console.log(row('timeline', tlSt));
    console.log(row('FULL ENVELOPE', envSt));
    console.log(`  checkpoint unit cost           ${ms(replaySt.p50 / Math.max(1, evolution.intent.checkpoints.length))} ms/checkpoint`);
    console.log(`  throughput                     ${(1000 / envSt.p50).toFixed(1)} envelopes/sec (single core, p50)\n`);

    envelopeStats[size] = envSt;
    replayStats[size] = replaySt;
  }

  // Replay must stay bounded by the checkpoint cap, not scale with history.
  const maxCp = buildEvolutionIntelligence(buildSnapshot('max')).intent.checkpoints.length;
  check('checkpoint cap enforced at max size', maxCp <= defaultEngineConfig.evolution.maxCheckpoints, `${maxCp} checkpoints for a 200-session lead (cap ${defaultEngineConfig.evolution.maxCheckpoints})`);
  const growth = envelopeStats.max!.p50 / envelopeStats.small!.p50;
  const dataGrowth = (SIZES.max.events + SIZES.max.sessions) / (SIZES.small.events + SIZES.small.sessions);
  check('envelope cost grows sub-linearly with history', growth < dataGrowth, `${dataGrowth.toFixed(0)}× the data → ${growth.toFixed(1)}× the time`);

  // ── 1. CONCURRENCY ────────────────────────────────────────────────────────
  console.log('── 1. CONCURRENT REPLAY VALIDATION ──\n');

  const serial = hash(buildLeadIntelligenceSummary(buildSnapshot('large')));
  const interleaved = await Promise.all(Array.from({ length: 32 }, async () => {
    await Promise.resolve();
    return hash(buildLeadIntelligenceSummary(buildSnapshot('large')));
  }));
  check('concurrent envelope generation is identical', new Set(interleaved).size === 1 && interleaved[0] === serial, `32 interleaved builds → ${new Set(interleaved).size} distinct hash(es)`);

  const replayHashes = await Promise.all(Array.from({ length: 32 }, async () => {
    await Promise.resolve();
    return hash(buildEvolutionIntelligence(buildSnapshot('large')));
  }));
  check('concurrent replay is identical', new Set(replayHashes).size === 1, `32 concurrent replays → ${new Set(replayHashes).size} distinct hash(es)`);

  // Mixed sizes and mixed tenants at once — the realistic worker shape.
  const mixedSpecs: Array<[SizeKey, number]> = [['small', 1], ['max', 2], ['medium', 3], ['large', 4], ['small', 5], ['medium', 6]];
  const expected = mixedSpecs.map(([s, t]) => hash(buildLeadIntelligenceSummary(buildSnapshot(s, t))));
  const mixed = await Promise.all(mixedSpecs.map(async ([s, t]) => {
    await Promise.resolve();
    return hash(buildLeadIntelligenceSummary(buildSnapshot(s, t)));
  }));
  check('mixed sizes + tenants concurrently', JSON.stringify(mixed) === JSON.stringify(expected), `${mixedSpecs.length} concurrent leads across 6 tenants, all match their serial result`);

  // Checkpoint selection must not drift between runs of the same input.
  const cpRuns = Array.from({ length: 10 }, () => buildEvolutionIntelligence(buildSnapshot('max')).intent.checkpoints.map((c) => c.at).join('|'));
  check('checkpoint selection is stable', new Set(cpRuns).size === 1, `10 runs over a 200-session lead → ${new Set(cpRuns).size} distinct selection(s)`);

  // Evolution must not duplicate itself inside one envelope.
  const evoLarge = buildEvolutionIntelligence(buildSnapshot('large'));
  const cpTimes = evoLarge.intent.checkpoints.map((c) => c.at);
  const mKeys = evoLarge.journey.milestones.map((m) => m.key);
  check('no duplicate evolution entries', new Set(cpTimes).size === cpTimes.length && new Set(mKeys).size === mKeys.length,
    `${cpTimes.length} unique checkpoints, ${mKeys.length} unique milestones`);

  // Regeneration wave: the same population regenerated repeatedly.
  const population = (['small', 'medium', 'large', 'max'] as SizeKey[]).flatMap((s) => [1, 2, 3].map((t) => buildSnapshot(s, t)));
  const waveT0 = process.hrtime.bigint();
  const waveHashes = population.map((s) => hash(buildLeadIntelligenceSummary(s)));
  const waveMs = Number(process.hrtime.bigint() - waveT0) / 1e6;
  const waveHashes2 = population.map((s) => hash(buildLeadIntelligenceSummary(s)));
  check('regeneration wave is deterministic', JSON.stringify(waveHashes) === JSON.stringify(waveHashes2),
    `${population.length} leads regenerated in ${waveMs.toFixed(0)} ms (${(population.length / (waveMs / 1000)).toFixed(1)} leads/sec)`);

  console.log('');

  // ── 3. STRESS ─────────────────────────────────────────────────────────────
  console.log('── 3. STRESS: sustained load ──\n');
  const STRESS_ROUNDS = 1200;
  const stressSnap = buildSnapshot('medium');
  const baselineHash = hash(buildLeadIntelligenceSummary(stressSnap));

  const heapBefore = heapMB();
  const seriesBefore = registry.counterEntries().length;
  const latencies: number[] = [];
  let divergences = 0;

  for (let i = 0; i < STRESS_ROUNDS; i += 1) {
    const t0 = process.hrtime.bigint();
    const h = hash(buildLeadIntelligenceSummary(stressSnap));
    latencies.push(Number(process.hrtime.bigint() - t0) / 1e6);
    if (h !== baselineHash) divergences += 1;
  }

  const heapAfter = heapMB();
  const decile = Math.floor(STRESS_ROUNDS / 10);
  const firstDecile = stats(latencies.slice(0, decile));
  const lastDecile = stats(latencies.slice(-decile));
  const drift = lastDecile.p50 / firstDecile.p50;

  console.log(row('sustained envelope latency', stats(latencies)));
  console.log(`  first decile p50 ${ms(firstDecile.p50)} ms → last decile p50 ${ms(lastDecile.p50)} ms (drift ×${drift.toFixed(2)})`);
  console.log(`  heap ${heapBefore.toFixed(1)} MB → ${heapAfter.toFixed(1)} MB after ${STRESS_ROUNDS} envelopes\n`);

  check('sustained output is deterministic', divergences === 0, `${STRESS_ROUNDS} envelopes, ${divergences} divergence(s)`);
  check('no latency drift under sustained load', drift < 1.5, `last/first decile p50 ratio ×${drift.toFixed(2)}`);
  check('no memory growth under sustained load', heapAfter - heapBefore < 25, `Δheap ${(heapAfter - heapBefore).toFixed(1)} MB over ${STRESS_ROUNDS} envelopes`);
  check('telemetry series stay bounded', registry.counterEntries().length - seriesBefore <= 4, `series ${seriesBefore} → ${registry.counterEntries().length}`);

  // Memory under the WORST case, repeated.
  const maxSnap = buildSnapshot('max');
  const heapMaxBefore = heapMB();
  for (let i = 0; i < 60; i += 1) buildLeadIntelligenceSummary(maxSnap);
  const heapMaxAfter = heapMB();
  const envBytes = Buffer.byteLength(JSON.stringify(buildLeadIntelligenceSummary(maxSnap)));
  check('no memory growth at maximum lead size', heapMaxAfter - heapMaxBefore < 25, `Δheap ${(heapMaxAfter - heapMaxBefore).toFixed(1)} MB over 60 max-size envelopes`);
  console.log(`  max-size envelope: ${(envBytes / 1024).toFixed(1)} KB serialized, transient heap ${(heapMaxAfter - heapMaxBefore).toFixed(1)} MB\n`);

  // ── summary ───────────────────────────────────────────────────────────────
  const failed = findings.filter((f) => !f.ok);
  console.log(`${'─'.repeat(72)}`);
  console.log(`TOTAL ${findings.length}   PASS ${findings.length - failed.length}   FAIL ${failed.length}`);
  if (failed.length) for (const f of failed) console.log(`  • ${f.name}: ${f.detail}`);
  console.log(`\nRESULT: ${failed.length === 0 ? 'ALL CHECKS PASSED' : 'FAILURES PRESENT'}\n`);
  process.exit(failed.length === 0 ? 0 : 1);
})();

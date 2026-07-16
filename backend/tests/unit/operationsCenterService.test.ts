/**
 * POP — operationsCenterService read-only snapshot.
 * Verifies the Operations Center surfaces rollout flags (resolved mode/source +
 * kill), the version fingerprint, the runtime/queue/cron topology, and SPOFs —
 * without changing any runtime behaviour.
 */
import { defineRolloutFlag } from '../../../lib/platform/rollout';
import { getOperationsCenterSnapshot, summarizeAiRuntime, summarizeEmailRuntime, summarizeStorageRuntime, summarizeWebsiteIntelligenceRuntime, summarizeMarketIntelligenceRuntime, getDeploymentRuntimeView, buildOperationsSummary } from '../../services/operationsCenterService';

const ENV = ['ROLLOUT_OPS_TEST_FLAG_MODE', 'ROLLOUT_OPS_TEST_FLAG_KILL', 'ROLLOUT_KILL_SWITCH'];
beforeEach(() => { for (const k of ENV) delete process.env[k]; });
afterAll(() => { for (const k of ENV) delete process.env[k]; });

describe('operationsCenterService', () => {
  test('surfaces topology and SPOFs (deployment/version owned by getDeploymentRuntimeView)', () => {
    const s = getOperationsCenterSnapshot();
    // deployment/version is NOT duplicated here — see getDeploymentRuntimeView.
    expect((s as unknown as { version?: unknown }).version).toBeUndefined();
    // topology reflects committed vercel.json / railway.json
    expect(s.topology.vercelCrons.length).toBeGreaterThanOrEqual(12);
    expect(s.topology.worker.replicas).toBe(1); // railway.json numReplicas
    expect(s.topology.queues).toContain('bolt-execution');
    expect(s.singlePointsOfFailure.length).toBeGreaterThan(0);
  });

  test('surfaces registered rollout flags with resolved mode/source', () => {
    defineRolloutFlag({ key: 'ops-test-flag', description: 'ops center test flag' });
    const off = getOperationsCenterSnapshot().rolloutFlags.find((f) => f.key === 'ops-test-flag')!;
    expect(off).toBeDefined();
    expect(off.mode).toBe('off');       // default
    expect(off.killed).toBe(false);
    expect(off.envPrefix).toBe('ROLLOUT_OPS_TEST_FLAG');

    process.env.ROLLOUT_OPS_TEST_FLAG_MODE = 'shadow';
    expect(getOperationsCenterSnapshot().rolloutFlags.find((f) => f.key === 'ops-test-flag')!.mode).toBe('shadow');
  });

  test('reflects kill switch as killed', () => {
    defineRolloutFlag({ key: 'ops-test-flag', description: 'ops center test flag' });
    process.env.ROLLOUT_OPS_TEST_FLAG_MODE = 'enforce';
    process.env.ROLLOUT_OPS_TEST_FLAG_KILL = '1';
    const f = getOperationsCenterSnapshot().rolloutFlags.find((x) => x.key === 'ops-test-flag')!;
    expect(f.mode).toBe('off');
    expect(f.killed).toBe(true);
    expect(f.source).toBe('env-kill');
  });

  test('read-only: no secrets in the snapshot payload', () => {
    const json = JSON.stringify(getOperationsCenterSnapshot());
    expect(json).not.toMatch(/secret|token|password|rediss:\/\/|postgres:\/\//i);
  });
});

describe('summarizeAiRuntime (AI runtime rollup from existing signals)', () => {
  const base = {
    counters: [
      { name: 'ai.provider.count', labels: { provider: 'openai' }, value: 100 },
      { name: 'ai.provider.errors', labels: { provider: 'openai' }, value: 10 },
      { name: 'ai.provider.retries', labels: { provider: 'openai' }, value: 5 },
      { name: 'ai.provider.tokens_in', labels: { provider: 'openai' }, value: 2000 },
      { name: 'ai.provider.tokens_out', labels: { provider: 'openai' }, value: 800 },
      { name: 'ai.provider.slow', labels: { provider: 'openai' }, value: 3 },
      { name: 'ai.provider.count', labels: { provider: 'anthropic' }, value: 20 },
      { name: 'unrelated.metric', labels: { provider: 'openai' }, value: 999 }, // ignored
    ],
    histograms: [{ name: 'ai.provider.duration_ms', labels: { provider: 'openai' }, count: 100, sum: 120000 }],
    slowAi: [{ providerModel: 'openai:gpt-4o-mini', ms: 4200 }],
    providerEnv: [{ provider: 'openai', keyPresent: true }, { provider: 'anthropic', keyPresent: false }],
    defaultModel: 'gpt-4o-mini',
  };

  test('rolls up per-provider calls/errors/retries/tokens/avg from real series (no fabrication)', () => {
    const v = summarizeAiRuntime({ ...base, pools: { pool: 'all', activeCalls: 1, pendingAcquires: 0, maxAllowed: 8, recentAvgWaitMs: 5 } });
    const oa = v.byProvider.find((p) => p.provider === 'openai')!;
    expect(oa.calls).toBe(100);
    expect(oa.errors).toBe(10);
    expect(oa.errorRate).toBeCloseTo(0.1);
    expect(oa.avgDurationMs).toBe(1200); // 120000/100
    expect(v.totals.calls).toBe(120); // openai 100 + anthropic 20
    expect(v.configuredProviders).toEqual(base.providerEnv);
    expect(v.slowTop[0].providerModel).toBe('openai:gpt-4o-mini');
  });

  test('healthy verdict from real data: low error + no backpressure → healthy', () => {
    const v = summarizeAiRuntime({ ...base, pools: { pool: 'all', activeCalls: 1, pendingAcquires: 0, maxAllowed: 8, recentAvgWaitMs: 5 } });
    expect(v.healthy).toBe(true); // 10% error, no waiting
  });

  test('degraded when error rate high OR pool has pending acquires', () => {
    const highErr = summarizeAiRuntime({ ...base, counters: [{ name: 'ai.provider.count', labels: { provider: 'openai' }, value: 10 }, { name: 'ai.provider.errors', labels: { provider: 'openai' }, value: 5 }], pools: null });
    expect(highErr.healthy).toBe(false); // 50% error
    const backpressure = summarizeAiRuntime({ ...base, pools: { pool: 'all', activeCalls: 8, pendingAcquires: 4, maxAllowed: 8, recentAvgWaitMs: 900 } });
    expect(backpressure.healthy).toBe(false); // 4 waiting
  });

  test('no traffic → healthy; missing signals listed honestly', () => {
    const v = summarizeAiRuntime({ counters: [], histograms: [], slowAi: [], pools: null, providerEnv: [], defaultModel: null });
    expect(v.healthy).toBe(true);
    expect(v.totals.calls).toBe(0);
    expect(v.missingSignals.some((m) => /circuit-breaker/i.test(m))).toBe(true);
  });
});

describe('summarizeEmailRuntime (email_jobs queue rollup)', () => {
  const ts = '2026-07-16T10:00:00Z';

  test('healthy: low backlog + low failure rate', () => {
    const v = summarizeEmailRuntime({ counts: { pending: 3, sent: 900, failed: 20 }, lastSuccessfulSendAt: ts, mostRecentFailureAt: ts });
    expect(v.available).toBe(true);
    expect(v.backlog).toBe(3);
    expect(v.failureRate).toBeCloseTo(20 / 920);
    expect(v.healthy).toBe(true);
    expect(v.provider).toMatch(/SES/);
  });

  test('degraded: high backlog OR high failure rate', () => {
    expect(summarizeEmailRuntime({ counts: { pending: 400, sent: 100, failed: 1 }, lastSuccessfulSendAt: ts, mostRecentFailureAt: ts }).healthy).toBe(false); // backlog
    expect(summarizeEmailRuntime({ counts: { pending: 1, sent: 10, failed: 10 }, lastSuccessfulSendAt: ts, mostRecentFailureAt: ts }).healthy).toBe(false); // 50% failure
  });

  test('no traffic → healthy; missing signals + no PII in note', () => {
    const v = summarizeEmailRuntime({ counts: { pending: 0, sent: 0, failed: 0 }, lastSuccessfulSendAt: null, mostRecentFailureAt: null });
    expect(v.healthy).toBe(true);
    expect(v.failureRate).toBe(0);
    expect(v.missingSignals.some((m) => /provider availability|SES/i.test(m))).toBe(true);
    expect(v.note).toMatch(/no recipient/i);
    // no ACTUAL PII (email addresses) in the view — the note's prose is documentation
    expect(JSON.stringify(v)).not.toMatch(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
  });
});

describe('summarizeStorageRuntime (Supabase Storage rollup)', () => {
  const buckets = ['media-uploads', 'media-images', 'media-videos', 'media-audios', 'media-documents'];

  test('healthy: connectivity configured + low stuck-upload backlog', () => {
    const v = summarizeStorageRuntime({ connectivityConfigured: true, buckets, counts: { mediaFiles: 5000, creatorAssets: 1200, awaitingUpload: 3 } });
    expect(v.available).toBe(true);
    expect(v.provider).toBe('Supabase Storage');
    expect(v.buckets).toContain('media-uploads');
    expect(v.healthy).toBe(true);
  });

  test('degraded: stuck-upload backlog over threshold', () => {
    const v = summarizeStorageRuntime({ connectivityConfigured: true, buckets, counts: { mediaFiles: 1, creatorAssets: 1, awaitingUpload: 250 } });
    expect(v.healthy).toBe(false);
  });

  test('degraded: connectivity not configured', () => {
    const v = summarizeStorageRuntime({ connectivityConfigured: false, buckets, counts: { mediaFiles: 0, creatorAssets: 0, awaitingUpload: 0 } });
    expect(v.healthy).toBe(false);
  });

  test('missing signals listed; no object paths/contents in payload', () => {
    const v = summarizeStorageRuntime({ connectivityConfigured: true, buckets, counts: { mediaFiles: 0, creatorAssets: 0, awaitingUpload: 0 } });
    expect(v.missingSignals.some((m) => /signed-URL|quota|janitor/i.test(m))).toBe(true);
    // no actual object URLs/paths in the view (the missing-signals prose is documentation)
    expect(JSON.stringify(v)).not.toMatch(/https?:\/\/|\.png|\.jpg|\.mp4|object_path/i);
  });
});

describe('summarizeWebsiteIntelligenceRuntime', () => {
  const engines = ['accessibility', 'brand', 'businessImpact', 'content', 'technical'];

  test('healthy when websites are tracked; surfaces counts + engines', () => {
    const v = summarizeWebsiteIntelligenceRuntime({ counts: { websitesTracked: 40, websitesActive: 35, healthScores: 120, signals: 900, alerts: 4 }, engines });
    expect(v.available).toBe(true);
    expect(v.healthy).toBe(true);
    expect(v.counts.websitesTracked).toBe(40);
    expect(v.engines).toContain('technical');
  });

  test('degraded when nothing is tracked', () => {
    const v = summarizeWebsiteIntelligenceRuntime({ counts: { websitesTracked: 0, websitesActive: 0, healthScores: 0, signals: 0, alerts: 0 }, engines });
    expect(v.healthy).toBe(false);
  });

  test('missing signals listed; no domains/URLs in payload', () => {
    const v = summarizeWebsiteIntelligenceRuntime({ counts: { websitesTracked: 1, websitesActive: 1, healthScores: 0, signals: 0, alerts: 0 }, engines });
    expect(v.missingSignals.some((m) => /crawl freshness|backlog|retry/i.test(m))).toBe(true);
    expect(JSON.stringify(v)).not.toMatch(/https?:\/\/|\.com|\.io|domain=/i);
  });
});

describe('summarizeMarketIntelligenceRuntime', () => {
  const NOW = Date.parse('2026-07-16T00:00:00Z');
  const counts = { signals: 5000, runsCompleted: 90, runsFailed: 5, findings: 400, monitoredCompanies: 30, competitorEnrichments: 120 };

  test('healthy: low failure rate + recent run', () => {
    const v = summarizeMarketIntelligenceRuntime({ counts, lastRunAt: '2026-07-15T04:30:00Z', nowMs: NOW });
    expect(v.available).toBe(true);
    expect(v.runFailureRate).toBeCloseTo(5 / 95);
    expect(v.freshnessDays).toBe(0);
    expect(v.healthy).toBe(true);
  });

  test('degraded: high run failure rate', () => {
    const v = summarizeMarketIntelligenceRuntime({ counts: { ...counts, runsCompleted: 10, runsFailed: 10 }, lastRunAt: '2026-07-15T04:30:00Z', nowMs: NOW });
    expect(v.healthy).toBe(false);
  });

  test('degraded: stale (last run older than threshold)', () => {
    const v = summarizeMarketIntelligenceRuntime({ counts, lastRunAt: '2026-07-01T00:00:00Z', nowMs: NOW });
    expect(v.freshnessDays).toBeGreaterThan(3);
    expect(v.healthy).toBe(false);
  });

  test('no runs → healthy; missing signals; no company identities', () => {
    const v = summarizeMarketIntelligenceRuntime({ counts: { signals: 0, runsCompleted: 0, runsFailed: 0, findings: 0, monitoredCompanies: 0, competitorEnrichments: 0 }, lastRunAt: null, nowMs: NOW });
    expect(v.healthy).toBe(true);
    expect(v.freshnessDays).toBeNull();
    expect(v.missingSignals.some((m) => /backlog|enrichment latency|scheduler/i.test(m))).toBe(true);
    expect(JSON.stringify(v)).not.toMatch(/company_id=|@|https?:\/\//i);
  });
});

describe('getDeploymentRuntimeView (boot fingerprint reuse)', () => {
  test('exposes build/env/fingerprint/schema + verification tooling + drift missing signals', () => {
    const v = getDeploymentRuntimeView();
    expect(v.nodeVersion).toBe(process.version);
    expect(typeof v.fingerprint).toBe('string');
    expect(typeof v.bootedAt).toBe('string');
    expect(v.healthy).toBe(true); // fingerprint + environment resolve
    // repo-owned verification tooling surfaced (documentation, not executed)
    expect(v.verification.some((x) => /deploy:check|predeploy/i.test(x.command))).toBe(true);
    // drift that is not computable at runtime is honestly listed
    expect(v.missingSignals.some((m) => /build parity|origin\/main|schema drift/i.test(m))).toBe(true);
    // no secrets in the payload
    expect(JSON.stringify(v)).not.toMatch(/secret|token|password|rediss:\/\//i);
  });
});

describe('buildOperationsSummary (executive rollup — reuses existing decisions)', () => {
  const ext = ['Vercel (app)', 'Supabase'];

  test('all healthy → overall healthy; no new rules invented', () => {
    const s = buildOperationsSummary({
      domains: [
        { name: 'Deployment & Runtime', view: { healthy: true } },
        { name: 'AI Runtime', view: { healthy: true, missingSignals: ['x'] } },
        { name: 'Email Runtime', view: { available: true, healthy: true } },
      ],
      externalDependencies: ext,
    });
    expect(s.overall).toBe('healthy');
    expect(s.counts).toEqual({ healthy: 3, degraded: 0, unavailable: 0 });
    expect(s.domainsWithMissingSignals).toEqual(['AI Runtime']);
    expect(s.externalDependencies).toBe(ext);
  });

  test('a degraded section → overall degraded + investigate-first list', () => {
    const s = buildOperationsSummary({
      domains: [
        { name: 'AI Runtime', view: { healthy: true } },
        { name: 'Email Runtime', view: { available: true, healthy: false } },
      ],
      externalDependencies: ext,
    });
    expect(s.overall).toBe('degraded');
    expect(s.degradedDomains).toEqual(['Email Runtime']);
  });

  test('available:false → unavailable (visibility gap), still degrades overall', () => {
    const s = buildOperationsSummary({
      domains: [
        { name: 'AI Runtime', view: { healthy: true } },
        { name: 'Storage Runtime', view: { available: false, healthy: false } },
        { name: 'Market Intelligence', view: null },
      ],
      externalDependencies: ext,
    });
    expect(s.overall).toBe('degraded');
    expect(s.unavailableDomains).toEqual(['Storage Runtime', 'Market Intelligence']);
    expect(s.counts.unavailable).toBe(2);
  });

  test('all sections unavailable → overall unavailable', () => {
    const s = buildOperationsSummary({ domains: [{ name: 'A', view: null }, { name: 'B', view: { available: false, healthy: false } }], externalDependencies: ext });
    expect(s.overall).toBe('unavailable');
  });
});

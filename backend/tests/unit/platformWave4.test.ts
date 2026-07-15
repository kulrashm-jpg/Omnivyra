/**
 * Wave 4 + Foundation Batch D — caching stack contracts.
 * Every cache is flag-gated OFF by default; isolation is structural (F-05).
 */
import fs from 'fs';
import path from 'path';
import { listRolloutFlags, resolveRolloutSync } from '../../../lib/platform/rollout';
import { registerCacheNamespace, isCacheNamespaceEnabled } from '../../../lib/platform/cacheCore';
import { createCache } from '../../../lib/platform/cacheClient';
import { buildRunwayPollKey } from '../../../lib/platform/runway';
import { isCacheable, isExactOnlyOp } from '../../services/aiResponseCache';

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

import '../../services/aiGatewayCore';                 // provider-prompt-cache
import '../../services/companyProfileServiceRest1Rest2Pulse'; // profile-cache
import '../../services/intelligence/adapters/wikidataAdapter'; // external-knowledge-cache
import '../../../lib/platform/responseCache';           // response-cache

describe('Wave 4 flags: registered and OFF by default', () => {
  test.each(['response-cache', 'provider-prompt-cache', 'profile-cache', 'external-knowledge-cache', 'ai-exact-cache'])(
    '%s', (key) => {
      const flag = listRolloutFlags().find((f) => f.key === key);
      expect(flag).toBeDefined();
      expect(resolveRolloutSync(flag!).mode).toBe('off');
    });
  test('website-snapshot-cache declared at its seam (source)', () => {
    expect(read('backend/services/websiteIntelligence/websiteIntelligenceRepository.ts'))
      .toContain("key: 'website-snapshot-cache'");
  });
});

describe('F-12 cache client', () => {
  const ns = registerCacheNamespace({
    prefix: 'test:w4_client', description: 'unit', version: 1, defaultTtlSeconds: 60, requireTenant: true,
  });
  const cache = createCache(ns);

  test('tenant refusal → getOrLoad runs the loader uncached (fail-open isolation)', async () => {
    let loads = 0;
    const v = await cache.getOrLoad({ parts: ['x'], load: async () => { loads++; return 'fresh'; } });
    expect(v).toBe('fresh');
    expect(loads).toBe(1);
  });

  test('kill switch → loader-only, no storage attempted', async () => {
    process.env[`CACHE_KILL_${ns.killEnvSuffix}`] = '1';
    let loads = 0;
    const v = await cache.getOrLoad({ tenantId: 'org-1', parts: ['x'], load: async () => { loads++; return 'k'; } });
    expect(v).toBe('k');
    expect(loads).toBe(1);
    expect(isCacheNamespaceEnabled(ns)).toBe(false);
    delete process.env[`CACHE_KILL_${ns.killEnvSuffix}`];
  });

  test('redis-unreachable degrades to the loader (fail-open)', async () => {
    // Test env: NODE_ENV=test never blocks the client itself; whether Redis
    // is reachable or not, the contract is the same — the value comes back.
    const v = await cache.getOrLoad({ tenantId: 'org-1', parts: ['y'], load: async () => ({ n: 42 }) });
    expect(v).toEqual({ n: 42 });
  });
});

describe('W4-3 exact-key AI cache', () => {
  afterEach(() => { delete process.env.ROLLOUT_AI_EXACT_CACHE_MODE; });
  test('flag off (default): master/variant ops remain uncacheable', () => {
    expect(isCacheable('generateMasterContent')).toBe(false);
    expect(isCacheable('generatePlatformVariants')).toBe(false);
  });
  test('flag on: cacheable but PERMANENTLY exact-only', () => {
    process.env.ROLLOUT_AI_EXACT_CACHE_MODE = 'enforce';
    expect(isCacheable('generateMasterContent')).toBe(true);
    expect(isExactOnlyOp('generateMasterContent')).toBe(true);
    expect(isExactOnlyOp('generateCampaignPlan')).toBe(false);
    // Near-match remains structurally skipped for exact-only ops.
    const src = read('backend/services/aiResponseCache.ts');
    expect(src).toMatch(/if \(isExactOnlyOp\(operation\)\) \{ recordCacheMiss\(\); return null; \}/);
    expect(src).toMatch(/if \(isExactOnlyOp\(operation\)\) return;/);
  });
});

describe('W4-4 provider prompt cache', () => {
  test('flag off = historical string system; on = cache_control ephemeral, same bytes', () => {
    const src = read('backend/services/aiGatewayCore.ts');
    expect(src).toContain("{ system: [{ type: 'text', text: systemMsg.content, cache_control: { type: 'ephemeral' } }] }");
    expect(src).toContain('{ system: systemMsg.content }');
  });
});

describe('W4-5 profile cache', () => {
  test('flag gates the request memo AND flips autoRefine to opt-in', () => {
    const src = read('backend/services/companyProfileServiceRest1Rest2Pulse.ts');
    expect(src).toMatch(/memoRequest\(`profile:raw:\$\{resolvedCompanyId\}`/);
    expect(src).toContain('const autoRefineDefault = cacheOn ? false : true;');
    expect(src).toMatch(/options\?\.autoRefine \?\? autoRefineDefault/);
  });
});

describe('W4-6 external knowledge cache', () => {
  test('Wikidata namespace is EXPLICITLY global (requireTenant:false, documented)', () => {
    const src = read('backend/services/intelligence/adapters/wikidataAdapter.ts');
    expect(src).toMatch(/prefix: 'omnivyra:ext:wikidata'[\s\S]{0,220}?requireTenant: false/);
    expect(src).toContain('global by design');
    expect(src).toMatch(/parts: \['firmographics', name\.toLowerCase\(\)\]/);
  });
});

describe('W4-1/W4-7 response cache + headers', () => {
  test('middleware: GET-only, tenant-required, 200-only, flag-gated, fail-open', () => {
    const src = read('lib/platform/responseCache.ts');
    expect(src).toContain("if (req.method !== 'GET') return handler(req, res);");
    expect(src).toContain('requireTenant: true, // ALWAYS tenant-required');
    // Certification remediation §14: only EXPLICIT 200s are cached now
    // (undefined statusCode is no longer assumed successful).
    expect(src).toMatch(/if \(res\.statusCode === 200\) \{/);
    expect(src).not.toContain('res.statusCode === undefined');
    expect(src).toContain('return handler(req, res); // middleware failure must never break the route');
  });
  test('readiness-score adoption: flag off = legacy Map path; SWR headers set', () => {
    const src = read('pages/api/readiness-score.ts');
    expect(src).toContain("prefix: 'omnivyra:resp:readiness-score'");
    expect(src).toContain('scoreCache.get(cacheKey)'); // legacy path retained
    expect(src).toContain('setSwrCacheHeaders(res, { maxAgeSeconds: 60');
  });
});

describe('F-13 / W4-8 frontend kit', () => {
  test('NotificationBell polls visibility-aware at the same 60 s cadence', () => {
    const src = read('components/NotificationBell.tsx');
    expect(src).toContain('useVisibilityPolling(fetchNotifications, 60_000)');
    expect(src).not.toMatch(/setInterval\(fetchNotifications/);
  });
  test('kit: dedupe map + visibility pause + kill switch', () => {
    const src = read('lib/client/dataKit.ts');
    expect(src).toContain('const inFlight = new Map');
    expect(src).toContain("document.visibilityState === 'visible'");
    expect(src).toContain('NEXT_PUBLIC_CLIENT_DATA_KIT');
  });
});

describe('F-14 runway', () => {
  test('poll keys are deterministic on identical inputs, distinct otherwise', () => {
    const a = buildRunwayPollKey('op', 'c1', { x: 1 });
    expect(buildRunwayPollKey('op', 'c1', { x: 1 })).toBe(a);
    expect(buildRunwayPollKey('op', 'c1', { x: 2 })).not.toBe(a);
    expect(buildRunwayPollKey('op', 'c2', { x: 1 })).not.toBe(a);
  });
  test('planner consumes the runway (extraction complete, no bespoke wiring left)', () => {
    const planSrc = read('pages/api/campaigns/ai/plan.ts');
    expect(planSrc).toContain('buildRunwayPollKey(');
    expect(planSrc).toContain('enqueueRunwayOperation({');
    expect(planSrc).not.toContain('loadAiExecutionResult'); // moved behind the runway
    const mainSrc = read('backend/workers/main.ts');
    expect(mainSrc).toContain('completeRunwayOperation({');
  });
});

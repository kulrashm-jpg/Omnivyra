/**
 * P0 — AI cache containment, invalidation repair and durable telemetry.
 *
 * The decisive assertions are negative: a conversation-carrying payload must
 * NEVER receive a near-match response, and an invalidated key must NEVER be
 * retrievable afterwards — including from the process-local hot tier.
 *
 * These are the regressions the production incident proved were untested:
 * the previous suite asserted list membership and source-text shape only, and
 * nothing exercised the near-match algorithm itself.
 */

import * as fs from 'fs';
import * as path from 'path';

/* ── In-memory Redis double ──────────────────────────────────────────────────
 * Models only what the cache uses: string get/set, list ops, set ops, scan,
 * del, expire and pipeline. Keys are observable so tests can assert the ACTUAL
 * key format rather than an assumed one.
 */
class FakeRedis {
  strings = new Map<string, string>();
  lists = new Map<string, string[]>();
  sets = new Map<string, Set<string>>();
  status = 'ready';

  async get(k: string) { return this.strings.has(k) ? this.strings.get(k)! : null; }
  async set(k: string, v: string) { this.strings.set(k, v); return 'OK'; }
  async lrange(k: string, a: number, b: number) { return (this.lists.get(k) ?? []).slice(a, b + 1); }
  async smembers(k: string) { return Array.from(this.sets.get(k) ?? []); }
  async expire() { return 1; }
  async connect() { return undefined; }
  // The cache marks itself available from the 'connect' event; fire handlers
  // immediately so getClient() produces a usable client, as it does in Redis.
  on(event: string, cb?: () => void) { if (event === 'connect' && cb) cb(); return this; }
  async del(...keys: string[]) {
    let n = 0;
    for (const k of keys) {
      if (this.strings.delete(k)) n++;
      if (this.lists.delete(k)) n++;
      if (this.sets.delete(k)) n++;
    }
    return n;
  }
  async scan(_cursor: string, _m: string, pattern: string, _c: string, _n: number) {
    const rx = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    const all = [...this.strings.keys(), ...this.lists.keys(), ...this.sets.keys()];
    return ['0', all.filter((k) => rx.test(k))] as [string, string[]];
  }
  pipeline() {
    const ops: Array<() => void> = [];
    const self = this;
    const api: Record<string, unknown> = {
      lpush(k: string, v: string) { ops.push(() => { const l = self.lists.get(k) ?? []; l.unshift(v); self.lists.set(k, l); }); return api; },
      ltrim(k: string, a: number, b: number) { ops.push(() => { const l = self.lists.get(k) ?? []; self.lists.set(k, l.slice(a, b + 1)); }); return api; },
      sadd(k: string, v: string) { ops.push(() => { const s = self.sets.get(k) ?? new Set<string>(); s.add(v); self.sets.set(k, s); }); return api; },
      expire() { return api; },
      async exec() { ops.forEach((f) => f()); return []; },
    };
    return api;
  }
  async quit() { return 'OK'; }
}

const fake = new FakeRedis();
jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn(() => fake) }));
jest.mock('../../../lib/redis/instrumentation', () => ({ createInstrumentedClient: (c: unknown) => c }));
jest.mock('../../../lib/redis/retryPolicy', () => ({ circuitBreakerRetryStrategy: jest.fn(), reconnectOnError: jest.fn() }));
jest.mock('../../services/metricsCollector', () => ({
  recordCacheExactHit: jest.fn(), recordCacheNearHit: jest.fn(), recordCacheMiss: jest.fn(),
}));

/** Request-scoped meta bag double — the durable-telemetry hand-off. */
const meta: Record<string, unknown> = {};
jest.mock('../../../lib/platform/requestContext', () => ({
  getTenantId: () => 'tenant-a',
  setContextMeta: (k: string, v: unknown) => { meta[k] = v; },
  getContextMeta: (k: string) => meta[k],
}));

import {
  getCachedCompletion, setCachedCompletion, buildNormalizedKey,
  invalidateOperation, invalidateAllAiCache, invalidateByPattern,
  carriesConversationState, CACHE_TIER_META_KEY, CACHE_SIMILARITY_META_KEY,
} from '../../services/aiResponseCache';
import { hotClear } from '../../services/hotKeyCache';

const OP = 'testCacheableOp';
const MODEL = 'gpt-4o-mini';
const SYSTEM = 'You are a strategist. '.repeat(40); // dominates the token set, as in production

const sys = { role: 'system', content: SYSTEM };
const turn1 = [sys, { role: 'user', content: 'help me create a post about our product launch' }];
const turn2 = [sys, turn1[1], { role: 'assistant', content: 'What angle should this take?' },
  { role: 'user', content: 'now make it shorter and more conversational' }];

beforeEach(() => {
  fake.strings.clear(); fake.lists.clear(); fake.sets.clear();
  // The hot tier is process-local and survives a Redis clear — the exact reason
  // invalidateAllAiCache() has to drop it too. Isolate tests explicitly.
  hotClear();
  for (const k of Object.keys(meta)) delete meta[k];
  jest.clearAllMocks();
});

/* ── Containment ─────────────────────────────────────────────────────────── */

describe('P0 · conversational payloads never near-match', () => {
  it('detects conversation state structurally, not by operation name', () => {
    expect(carriesConversationState(turn1)).toBe(false);
    expect(carriesConversationState(turn2)).toBe(true);
  });

  it('turn 2 does NOT receive turn 1 response even though similarity is far above threshold', async () => {
    await setCachedCompletion(OP, MODEL, turn1, 'ANSWER-FOR-TURN-1');
    const got = await getCachedCompletion(OP, MODEL, turn2);
    expect(got).toBeNull();               // the incident, asserted directly
  });

  it('a conversational payload is never indexed as a near-match candidate', async () => {
    await setCachedCompletion(OP, MODEL, turn2, 'ANSWER-FOR-TURN-2');
    const indexed = Array.from(fake.lists.values()).flat().join(' ');
    expect(indexed).not.toContain('ANSWER-FOR-TURN-2');
    // its exact entry still exists — a retry of the SAME turn is a legitimate hit
    expect(await getCachedCompletion(OP, MODEL, turn2)).toBe('ANSWER-FOR-TURN-2');
  });

  it('exact match still works for a first-turn payload (containment is not a blanket disable)', async () => {
    await setCachedCompletion(OP, MODEL, turn1, 'ANSWER-1');
    expect(await getCachedCompletion(OP, MODEL, turn1)).toBe('ANSWER-1');
  });

  it('a different cacheVersion is a different entry', async () => {
    await setCachedCompletion(OP, MODEL, turn1, 'V1', 'ver-1');
    expect(await getCachedCompletion(OP, MODEL, turn1, 'ver-2')).toBeNull();
  });

  it('a different model is a different entry', async () => {
    await setCachedCompletion(OP, MODEL, turn1, 'V1');
    expect(await getCachedCompletion(OP, 'gpt-4o', turn1)).toBeNull();
  });
});

/* ── Durable telemetry hand-off ──────────────────────────────────────────── */

describe('P0 · cache tier is recorded for durable telemetry', () => {
  it('records tier=exact on an exact hit', async () => {
    await setCachedCompletion(OP, MODEL, turn1, 'A');
    await getCachedCompletion(OP, MODEL, turn1);
    expect(meta[CACHE_TIER_META_KEY]).toBe('exact');
  });

  it('records tier=miss when nothing matches', async () => {
    await getCachedCompletion(OP, MODEL, turn1);
    expect(meta[CACHE_TIER_META_KEY]).toBe('miss');
  });

  it('records tier=miss for a suppressed conversational near-match', async () => {
    await setCachedCompletion(OP, MODEL, turn1, 'A');
    await getCachedCompletion(OP, MODEL, turn2);
    expect(meta[CACHE_TIER_META_KEY]).toBe('miss');
  });

  it('stores no prompt content in the telemetry hand-off', async () => {
    await setCachedCompletion(OP, MODEL, turn1, 'A');
    await getCachedCompletion(OP, MODEL, turn1);
    const dumped = JSON.stringify(meta);
    expect(dumped).not.toContain('product launch');
    expect(dumped).not.toContain(SYSTEM.slice(0, 30));
    expect(Object.keys(meta).every((k) => k === CACHE_TIER_META_KEY || k === CACHE_SIMILARITY_META_KEY)).toBe(true);
  });
});

/* ── Invalidation repair ─────────────────────────────────────────────────── */

describe('P0 · invalidation actually deletes', () => {
  it('writes the key format the invalidation path targets', async () => {
    await setCachedCompletion(OP, MODEL, turn1, 'A');
    const expected = buildNormalizedKey(MODEL, turn1, undefined);
    expect(expected).toMatch(/^omnivyra:ai_resp:v2:[0-9a-f]{64}$/);
    expect(fake.strings.has(expected)).toBe(true);
    // the operation never appears in the key — which is why prefix-by-operation
    // could never match and an index is required
    expect(expected).not.toContain(OP);
  });

  it('invalidateOperation deletes the entry and it is not retrievable afterwards', async () => {
    await setCachedCompletion(OP, MODEL, turn1, 'A');
    expect(await getCachedCompletion(OP, MODEL, turn1)).toBe('A');
    const deleted = await invalidateOperation(OP);
    expect(deleted).toBeGreaterThan(0);
    expect(await getCachedCompletion(OP, MODEL, turn1)).toBeNull();
  });

  it('invalidateAllAiCache clears both namespaces and the operation index', async () => {
    await setCachedCompletion(OP, MODEL, turn1, 'A');
    await setCachedCompletion('otherOp', MODEL, [sys, { role: 'user', content: 'different subject entirely' }], 'B');
    const deleted = await invalidateAllAiCache();
    expect(deleted).toBeGreaterThan(0);
    expect(fake.strings.size).toBe(0);
    expect(fake.lists.size).toBe(0);
    expect(fake.sets.size).toBe(0);
    expect(await getCachedCompletion(OP, MODEL, turn1)).toBeNull();
  });

  it('refuses an unbounded pattern that would delete keys this module does not own', async () => {
    fake.strings.set('bull:queue:job:1', 'x');
    expect(await invalidateByPattern('*')).toBe(0);
    expect(await invalidateByPattern('bull:*')).toBe(0);
    expect(fake.strings.has('bull:queue:job:1')).toBe(true);
  });

  it('the admin flush targets the LIVE namespace versions', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../pages/api/admin/cache-management.ts'), 'utf8');
    expect(src).toContain('invalidateAllAiCache');
    // The retired v2 semantic namespace must not appear as a live target
    // anywhere in the route — neither the flush nor the key-count listing.
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toContain('ai_sem:v2');
    expect(code).toContain('ai_sem:v3');
  });
});

/* ── Regression guards ───────────────────────────────────────────────────── */

describe('P0 · nothing outside the cache changed', () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');

  it('no operation was added to or removed from NO_CACHE_OPS', () => {
    const src = read('backend/services/aiResponseCache.ts');
    const block = src.slice(src.indexOf('const NO_CACHE_OPS'), src.indexOf('// ── Cache TTL'));
    for (const op of ['chatModeration', 'responseGeneration', 'generateMasterContent', 'profileEnrichment']) {
      expect(block).toContain(op);
    }
    expect((block.match(/'/g) ?? []).length / 2).toBe(13); // unchanged membership count
  });

  it('the gateway still threads companyId into both cache calls (tenant scoping intact)', () => {
    const src = read('backend/services/aiGatewayProvidersOps.ts');
    expect(src).toMatch(/getCachedCompletion\([\s\S]{0,220}?effectiveCacheVersion,[\s\S]{0,120}?request\.companyId \?\? null,\s*\)/);
    expect(src).toMatch(/setCachedCompletion\(request\.operation, effectiveModel, request\.messages, content, effectiveCacheVersion, request\.companyId \?\? null\)/);
  });

  it('the cache-hit usage_events row is still emitted (billing accounting unchanged)', () => {
    const src = read('backend/services/aiGatewayProvidersOps.ts');
    expect(src).toContain("source_type:     'cache'");
    expect(src).toContain('total_cost:      0');
  });
});

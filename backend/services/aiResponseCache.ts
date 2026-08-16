/**
 * Redis-backed AI Response Cache — v2
 *
 * GAP 1 (Normalization)   — inputs are normalized before hashing → +20–30% hits
 * GAP 2 (Near-match)      — Jaccard term-overlap fallback for semantically similar
 *                           prompts → +15% extra hits, zero embedding API cost
 * GAP 4 (In-flight dedup) — exports buildNormalizedKey() so aiGateway can coalesce
 *                           concurrent identical requests into one Promise
 * GAP 5 (Versioning)      — optional cacheVersion param invalidates stale entries
 *                           when campaign/profile changes without a full flush
 * RISK 2 (Compression)    — responses >1 KB are gzip-compressed before storage
 *                           → ~60–70% Redis memory reduction for large campaign plans
 */

import IORedis from 'ioredis';
import { createHash } from 'crypto';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import { recordCacheExactHit, recordCacheNearHit, recordCacheMiss } from './metricsCollector';
import { hotGet, hotSet, recordAccess as hotRecordAccess, hotInvalidate, hotClear } from './hotKeyCache';
import { createInstrumentedClient } from '../../lib/redis/instrumentation';
import { circuitBreakerRetryStrategy, reconnectOnError } from '../../lib/redis/retryPolicy';
import {
  registerCacheNamespace,
  buildCacheKey,
  isCacheNamespaceEnabled,
  noteCacheIsolationViolation,
} from '../../lib/platform/cacheCore';
import { getTenantId, setContextMeta } from '../../lib/platform/requestContext';

const gzipAsync   = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// Threshold above which we compress (bytes). Small responses not worth compressing.
const COMPRESS_THRESHOLD_BYTES = 1024;
const COMPRESS_PREFIX = '\x1fgzip:'; // magic prefix to detect compressed entries

const EXACT_PREFIX    = 'omnivyra:ai_resp:v2';
const SEMANTIC_MAX    = 200;   // entries per operation in semantic index
const NEAR_THRESHOLD  = 0.80;  // Jaccard score required for near-match reuse

// W1-1 (B-04 fix) — the near-match semantic index is TENANT-SCOPED via the
// F-05 cache SDK. v2 keyed the index by operation only, so one company could
// be served another company's cached output when prompts overlapped ≥80%.
// v3 keys are `omnivyra:ai_sem:v3:t.<tenant>:<operation>`; with no resolvable
// tenant (explicit param or request-context orgId) near-match is SKIPPED
// entirely — exact-key matching (full-prompt hash) still applies. Old v2 keys
// are never read again and expire via their TTLs (≤48 h) — no migration.
const SEMANTIC_NS = registerCacheNamespace({
  prefix: 'omnivyra:ai_sem',
  description: 'AI response near-match (Jaccard) index — tenant-scoped per W1-1',
  version: 3,
  defaultTtlSeconds: 3_600, // mirrors DEFAULT_TTL below (declared later in file)
  requireTenant: true,
});

// ── Operations that must NEVER be cached ─────────────────────────────────────
const NO_CACHE_OPS = new Set([
  'chatModeration',
  'extractPlannerCommands',
  'conversationTriage',
  'conversationMemorySummary',
  'responseGeneration',
  'parseRefinedDay',
  'parsePlatformCustomization',
  // Profile refinement is user-triggered — must always run fresh so changes
  // to website, social profiles, or other digital assets are picked up.
  'profileEnrichment',
  'profileExtraction',
  'refineProblemTransformation',
  // Master content and platform variants must NEVER be cached — each activity
  // card has a unique topic and must get its own fresh AI-generated content.
  // Near-match caching (80% Jaccard) was returning the SAME content for similar
  // topics (e.g. "Brand Awareness for B2B Marketers" x 3), making all posts
  // identical. Also caching can serve stale/empty content from failed runs.
  'generateMasterContent',
  'generatePlatformVariants',
  'generateContentVariant',
]);

// ── Cache TTL (seconds) per operation ────────────────────────────────────────
const OPERATION_TTL: Record<string, number> = {
  generateCampaignPlan:              86_400,
  previewStrategy:                   86_400,
  prePlanningExplanation:            86_400,
  suggestDuration:                   86_400,
  refineCampaignIdea:                43_200,
  parsePlanToWeeks:                  43_200,
  optimizeWeek:                      21_600,
  generateDailyPlan:                 43_200,
  generateDailyDistributionPlan:     43_200,
  generateContentBlueprint:           7_200,
  generatePlatformVariants:           7_200,
  generateContentForDay:              7_200,
  regenerateContent:                  3_600,
  generateRecommendation:            21_600,
  generateCampaignRecommendations:   21_600,
  generateAdditionalStrategicThemes: 21_600,
  generateContentIdeas:              21_600,
  // profileEnrichment, profileExtraction, refineProblemTransformation are in NO_CACHE_OPS
};

const DEFAULT_TTL = 3_600;

// ── Redis ─────────────────────────────────────────────────────────────────────
let _client: IORedis | null = null;
let _available = false;

// W2-7 (audit B-45): same key as bullmqClient's flag — one switch converges
// all duplicated client construction. With it ON this cache rides the shared
// instrumented standalone client (feature 'ai_cache') instead of a private
// connection; fail-open semantics preserved (command timeout → catch → miss).
const REDIS_SHARED_CONNECTION_FLAG = registerSharedConnFlag();
function registerSharedConnFlag() {
  try {
    const { defineRolloutFlag } = require('../../lib/platform/rollout') as typeof import('../../lib/platform/rollout');
    return defineRolloutFlag({
      key: 'redis-shared-connection',
      description: 'W2-7: converge duplicated Redis client construction (audit B-21/B-45)',
    });
  } catch {
    return null;
  }
}

function getClient(): IORedis | null {
  if (_client) return _client;
  try {
    if (REDIS_SHARED_CONNECTION_FLAG) {
      const { resolveRolloutSync } = require('../../lib/platform/rollout') as typeof import('../../lib/platform/rollout');
      if (resolveRolloutSync(REDIS_SHARED_CONNECTION_FLAG).mode !== 'off') {
        const { getInstrumentedStandaloneRedisClient } = require('../queue/standaloneRedisClient') as typeof import('../queue/standaloneRedisClient');
        _client = getInstrumentedStandaloneRedisClient('ai_cache');
        // CERT-FIX P2: track availability on the shared client exactly like
        // the private path does — a static `_available = true` masked
        // Redis-down state and made every LLM call block on the command
        // timeout (~1.5 s) during an outage instead of skipping instantly.
        _available = _client.status === 'ready' || _client.status === 'connect';
        _client.on('ready',      () => { _available = true; });
        _client.on('connect',    () => { _available = true; });
        _client.on('error',      () => { _available = false; });
        _client.on('end',        () => { _available = false; });
        _client.on('reconnecting', () => { _available = false; });
        return _client;
      }
    }
  } catch { /* fall through to the private-connection path */ }
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  try {
    const raw = new IORedis(url, {
      enableReadyCheck: false,
      maxRetriesPerRequest: 1,
      retryStrategy: circuitBreakerRetryStrategy,
      reconnectOnError,
      lazyConnect: true,
      // Upstash requires TLS; a plain redis:// connection TCP-connects but
      // never answers RESP commands, so client.get() hangs forever. Mirrors
      // the cronGuard Upstash-TLS fix (commit 79a53031).
      tls: host.includes('upstash.io') ? {} : undefined,
      // The response cache is a non-critical optimization. It must NEVER
      // block the LLM critical path: if Redis is slow/unreachable/misconfigured,
      // commands fail fast and getCachedCompletion's catch returns null
      // (cache miss / fail-open) instead of stalling generateCampaignPlan
      // until the caller's 120s timeout — which is what stuck BOLT on
      // "Creating week plan".
      commandTimeout: 2000,
    });
    raw.on('connect', () => { _available = true; });
    raw.on('error', () => { _available = false; });
    raw.connect().catch(() => {});
    _client = createInstrumentedClient(raw, 'ai_cache') as IORedis;
    return _client;
  } catch {
    return null;
  }
}

/** Disconnect the Redis client (for graceful shutdown). */
export function shutdownAiResponseCache(): void {
  if (_client) {
    _client.quit().catch(() => {});
    _client = null;
    _available = false;
  }
}

// ── GAP 1: Input normalization ────────────────────────────────────────────────
/**
 * Normalize a message array before hashing.
 * Removes timestamps, UUIDs, and extra whitespace so that semantically
 * identical prompts with minor cosmetic differences produce the same key.
 */
function normalizeMessages(messages: Array<{ role: string; content: string }>): Array<{ role: string; content: string }> {
  return messages.map(m => ({
    role: m.role,
    content: m.content
      // Remove ISO-8601 timestamps  e.g. 2024-01-15T12:00:00Z
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, '<ts>')
      // Remove Unix epoch numbers > 10 digits (ms timestamps)
      .replace(/\b1[6-9]\d{11}\b/g, '<epoch>')
      // Remove UUIDs
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim(),
  }));
}

// ── GAP 2: Term tokenization for near-match ───────────────────────────────────
function tokenize(messages: Array<{ role: string; content: string }>): string[] {
  const text = messages.map(m => m.content).join(' ').toLowerCase();
  return Array.from(new Set(
    text.split(/[\s,.:;!?()\[\]{}"'`]+/)
      .filter(w => w.length >= 3 && !/^\d+$/.test(w))
  ));
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const w of setA) { if (setB.has(w)) intersection++; }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ── P0: structural conversational guard ───────────────────────────────────────
/**
 * TRUE when the payload replays prior assistant turns — i.e. it carries
 * conversation state.
 *
 * This is deliberately STRUCTURAL, not a list of operation names. The
 * production incident (one card-chat answer repeated for three different user
 * turns) happened because `blogCardChat` was simply not in NO_CACHE_OPS, and
 * this repository has already produced three such near-misses:
 * `responseGeneration` is excluded while `replyGeneration` and
 * `engagement_reply_suggestions` are not; `refineProblemTransformation` is
 * excluded while `defineProblemTransformation` / `inferProblemTransformation`
 * are not. A name list fails every time someone adds an operation and forgets.
 *
 * A first-turn request contains only system + user messages. The moment an
 * assistant turn is replayed back to the model, the payload carries history,
 * and successive turns are >0.94 similar BY CONSTRUCTION — precisely the
 * condition under which near-match returns the previous answer.
 *
 * Such payloads therefore never near-match and are never indexed as near-match
 * candidates. Exact matching is untouched: an identical retry of the same turn
 * still hits, which is the correct behaviour for a retry.
 *
 * This invariant is independent of CACHE_KILL_OMNIVYRA_AI_SEM and must survive
 * the later CachePolicy allowlist.
 */
export function carriesConversationState(
  messages: Array<{ role: string; content: string }>,
): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some((m) => m && m.role === 'assistant');
}

// ── P0: durable cache telemetry (request-scoped hand-off) ─────────────────────
/**
 * Keys under which this module records WHICH tier served a response. The
 * gateway reads them when it writes the cache-hit `usage_events` row, so the
 * tier reaches durable storage without changing either public cache signature
 * and WITHOUT adding a single extra database write.
 *
 * The in-process metrics registry cannot serve this purpose: it is documented
 * as "process-local", and on Vercel serverless each invocation gets its own
 * registry which is discarded when the lambda ends — `/api/health/metrics`
 * consequently reports an empty counter set even while cache hits are
 * occurring. Request-scoped meta + the existing usage ledger is the smallest
 * mechanism that survives lambda termination, cold starts, concurrency and
 * redeployment.
 */
export const CACHE_TIER_META_KEY = 'ai_cache_tier';
export const CACHE_SIMILARITY_META_KEY = 'ai_cache_similarity';

export type CacheTier = 'exact' | 'near' | 'miss';

function noteCacheTier(tier: CacheTier, similarity?: number): void {
  try {
    setContextMeta(CACHE_TIER_META_KEY, tier);
    if (typeof similarity === 'number' && Number.isFinite(similarity)) {
      setContextMeta(CACHE_SIMILARITY_META_KEY, Number(similarity.toFixed(4)));
    }
  } catch {
    /* fail-safe: telemetry must never affect the critical path */
  }
}

// ── Key construction (exported for in-flight coalescing in aiGateway) ─────────
/** GAP 4 + GAP 5: Build a normalized, versioned cache key. */
export function buildNormalizedKey(
  model: string,
  messages: Array<{ role: string; content: string }>,
  cacheVersion?: string | null,
): string {
  const normalized = normalizeMessages(messages);
  const payload = JSON.stringify({ model, messages: normalized, v: cacheVersion ?? '' });
  const hash = createHash('sha256').update(payload).digest('hex');
  return `${EXACT_PREFIX}:${hash}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

// CKRE-002 §4 — enrichment ops are cacheable only when the policy config opts
// in (default off). This removes the blanket exclusion while keeping the
// safe-by-default behaviour; invalidation/versioning use the existing
// cacheVersion param + invalidateCacheByPrefix, TTL provides freshness.
const ENRICHMENT_CACHE_OPS = new Set(['profileEnrichment', 'profileExtraction']);

// ── W4-3 (audit B-31): exact-key-only re-enable ───────────────────────────────
// Master/variant content ops were blanket-disabled because NEAR-MATCH served
// wrong content for similar topics. Exact-key matching hashes the FULL
// normalized prompt (topic, brief, cacheVersion — inherently input-faithful),
// so under the 'ai-exact-cache' flag these ops become cacheable again with
// near-match PERMANENTLY skipped for them (isExactOnlyOp below). Never
// semantic, never cross-tenant (exact keys embed the full company-specific
// prompt; the near-match index is untouched and stays W1-1 tenant-scoped).
// Flag off (default) = NO_CACHE exactly as today.
const EXACT_ONLY_OPS = new Set([
  'generateMasterContent',
  'generatePlatformVariants',
  'generateContentVariant',
]);

const AI_EXACT_CACHE_FLAG = (() => {
  try {
    const { defineRolloutFlag } = require('../../lib/platform/rollout') as typeof import('../../lib/platform/rollout');
    return defineRolloutFlag({
      key: 'ai-exact-cache',
      description: 'W4-3: exact-key-only caching for master/variant content ops (audit B-31)',
    });
  } catch {
    return null;
  }
})();

function exactCacheEnabled(): boolean {
  try {
    if (!AI_EXACT_CACHE_FLAG) return false;
    const { resolveRolloutSync } = require('../../lib/platform/rollout') as typeof import('../../lib/platform/rollout');
    return resolveRolloutSync(AI_EXACT_CACHE_FLAG).mode !== 'off';
  } catch {
    return false;
  }
}

/** Ops that may ONLY ever exact-match (near-match structurally forbidden). */
export function isExactOnlyOp(operation: string): boolean {
  return EXACT_ONLY_OPS.has(operation);
}

export function isCacheable(operation: string): boolean {
  if (ENRICHMENT_CACHE_OPS.has(operation)) {
    try {
      // Lazy require to avoid a static cycle; fail-closed to uncached.
      const { getRefreshPolicyConfig } = require('./crawl/refreshPolicyConfig') as typeof import('./crawl/refreshPolicyConfig');
      return getRefreshPolicyConfig().enrichmentCacheEnabled;
    } catch {
      return false;
    }
  }
  if (EXACT_ONLY_OPS.has(operation)) return exactCacheEnabled();
  return !NO_CACHE_OPS.has(operation);
}

/**
 * GAP 1+2+5: Check Redis for an exact or near-match cached completion.
 * Returns the raw string content on hit, null on miss or skip.
 */
export async function getCachedCompletion(
  operation: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  cacheVersion?: string | null,
  tenantId?: string | null,
): Promise<string | null> {
  if (!isCacheable(operation)) return null;
  const client = getClient();
  if (!client || !_available) return null;

  try {
    // ── Exact match (GAP 1 + 5) ──────────────────────────────────────────────
    const exactKey = buildNormalizedKey(model, messages, cacheVersion);

    // Hot key tier (memory-only, sub-ms)
    const hotHit = hotGet(exactKey);
    if (hotHit !== null) {
      recordCacheExactHit();
      noteCacheTier('exact');
      return hotHit; // already decompressed when stored in hot tier
    }

    const exactHit = await client.get(exactKey);
    if (exactHit !== null) {
      recordCacheExactHit();
      noteCacheTier('exact');
      const decompressed = await decompressIfNeeded(exactHit);
      // Promote to hot tier on hit
      hotRecordAccess(exactKey, decompressed);
      if (process.env.NODE_ENV !== 'test') {
        console.info('[ai-cache] exact-hit', { op: operation });
      }
      return decompressed;
    }

    // ── Near-match fallback (GAP 2) — TENANT-SCOPED (W1-1 / B-04 fix) ─────────
    // W4-3: exact-only ops NEVER near-match — miss means a fresh generation.
    if (isExactOnlyOp(operation)) { recordCacheMiss(); noteCacheTier('miss'); return null; }
    // P0: a payload replaying prior assistant turns is a CONVERSATION. Successive
    // turns are >0.94 similar by construction, so near-match would serve the
    // previous turn's answer — the production incident. Structural, not a name
    // list. Exact matching above already ran and is unaffected.
    if (carriesConversationState(messages)) { recordCacheMiss(); noteCacheTier('miss'); return null; }
    // No resolvable tenant → no near-match. Exact matching above still ran.
    const tenant = tenantId ?? getTenantId() ?? null;
    const semKey = isCacheNamespaceEnabled(SEMANTIC_NS)
      ? buildCacheKey(SEMANTIC_NS, { tenantId: tenant, parts: [operation] })
      : null;
    if (!semKey) { recordCacheMiss(); noteCacheTier('miss'); return null; }
    const rawEntries = await client.lrange(semKey, 0, SEMANTIC_MAX - 1);
    if (rawEntries.length === 0) { recordCacheMiss(); noteCacheTier('miss'); return null; }

    const queryTerms = tokenize(normalizeMessages(messages));
    let bestKey: string | null = null;
    let bestScore = 0;

    for (const raw of rawEntries) {
      try {
        const entry = JSON.parse(raw) as {
          words: string[]; key: string; t?: string; m?: string; v?: string;
        };
        // Defense in depth: entries record the tenant they were written for.
        // A mismatch means the index itself was corrupted/mis-keyed — count
        // it on the permanent isolation-violation assertion and never serve.
        if (entry.t !== undefined && entry.t !== (tenant ?? '')) {
          noteCacheIsolationViolation(SEMANTIC_NS);
          continue;
        }
        // P0: a near-match must agree on generation identity, not just wording.
        // Entries written before this change carry no `m`/`v` and are skipped
        // rather than trusted — they expire on their own TTL.
        if (entry.m !== model) continue;
        if ((entry.v ?? '') !== (cacheVersion ?? '')) continue;
        const score = jaccardSimilarity(queryTerms, entry.words);
        if (score >= NEAR_THRESHOLD && score > bestScore) {
          bestScore = score;
          bestKey = entry.key;
        }
      } catch { /* corrupt entry — skip */ }
    }

    if (bestKey) {
      const nearHit = await client.get(bestKey);
      if (nearHit !== null) {
        recordCacheNearHit();
        noteCacheTier('near', bestScore);
        if (process.env.NODE_ENV !== 'test') {
          console.info('[ai-cache] near-hit', { op: operation, score: bestScore.toFixed(2) });
        }
        return await decompressIfNeeded(nearHit);
      }
    }

    recordCacheMiss();
    noteCacheTier('miss');
    return null;
  } catch {
    return null;
  }
}

// ── RISK 2: Compression helpers ───────────────────────────────────────────────
async function compressIfLarge(value: string): Promise<string> {
  if (value.length < COMPRESS_THRESHOLD_BYTES) return value;
  try {
    const compressed = await gzipAsync(Buffer.from(value, 'utf8'));
    return COMPRESS_PREFIX + compressed.toString('base64');
  } catch {
    return value; // fall back to uncompressed
  }
}

async function decompressIfNeeded(value: string): Promise<string> {
  if (!value.startsWith(COMPRESS_PREFIX)) return value;
  try {
    const b64 = value.slice(COMPRESS_PREFIX.length);
    const buf = await gunzipAsync(Buffer.from(b64, 'base64'));
    return buf.toString('utf8');
  } catch {
    return value;
  }
}

/**
 * GAP 1+2+5: Store a completion response in Redis (fire-and-forget).
 * Also indexes the entry in the semantic near-match table.
 */
export async function setCachedCompletion(
  operation: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  response: string,
  cacheVersion?: string | null,
  tenantId?: string | null,
): Promise<void> {
  if (!isCacheable(operation) || !response) return;
  const client = getClient();
  if (!client || !_available) return;

  try {
    const exactKey = buildNormalizedKey(model, messages, cacheVersion);
    const ttl = OPERATION_TTL[operation] ?? DEFAULT_TTL;

    // RISK 2: compress large responses before storing
    const stored = await compressIfLarge(response);
    await client.set(exactKey, stored, 'EX', ttl);
    // Hot key tier: store uncompressed for instant access on next hit
    hotSet(exactKey, response);

    // ── P0: operation → keys index ───────────────────────────────────────────
    // Exact keys are `omnivyra:ai_resp:v2:<sha256>`; the OPERATION never appears
    // in the key, so invalidating "everything for operation X" was structurally
    // impossible — `invalidateCacheByPrefix('generateCampaignPlan')` scanned
    // `omnivyra:ai_resp:v2:generateCampaignPlan*` and matched nothing, silently
    // returning 0. This index is the missing reverse mapping. Bounded: one SADD
    // + one EXPIRE per cache write, and the set expires with the entries.
    await indexKeyForOperation(client, operation, exactKey, ttl);

    // ── Update semantic index (GAP 2) — TENANT-SCOPED (W1-1 / B-04 fix) ───────
    // W4-3: exact-only ops are never indexed for near-match.
    if (isExactOnlyOp(operation)) return;
    // P0: never index a conversation-carrying payload as a near-match
    // candidate. See carriesConversationState() — this is what stops turn N+1
    // from matching turn N. Its exact entry above remains retrievable.
    if (carriesConversationState(messages)) return;
    // No resolvable tenant → the entry is NOT indexed for near-match (it
    // remains exactly retrievable via the full-prompt hash above).
    const tenant = tenantId ?? getTenantId() ?? null;
    const semKey = isCacheNamespaceEnabled(SEMANTIC_NS)
      ? buildCacheKey(SEMANTIC_NS, { tenantId: tenant, parts: [operation] })
      : null;
    if (!semKey) return;
    const words = tokenize(normalizeMessages(messages));
    // P0: record the model and cache version ON the candidate. tokenize() sees
    // message CONTENT only, so without these a request differing solely by model
    // or cacheVersion scores 1.0 against this entry and near-matches it — which
    // defeated cacheVersion entirely (GAP 5's invalidation mechanism) and could
    // serve output generated by a different model.
    const entry = JSON.stringify({
      words, key: exactKey, t: tenant ?? '', m: model, v: cacheVersion ?? '',
    });
    const pipe = client.pipeline();
    pipe.lpush(semKey, entry);
    pipe.ltrim(semKey, 0, SEMANTIC_MAX - 1);
    pipe.expire(semKey, ttl * 2); // keep index alive longer than entries
    await pipe.exec();
  } catch {
    // fail-safe
  }
}

// ── P0: invalidation repair ───────────────────────────────────────────────────
/**
 * THE ACTUAL LIVE KEY FORMATS (verified against this module, not assumed):
 *
 *   exact entry      `omnivyra:ai_resp:v2:<sha256 of {model,messages,v}>`
 *   near-match index `omnivyra:ai_sem:v3:t.<tenant>:<operation>`   (buildCacheKey)
 *   operation index  `omnivyra:ai_opidx:v1:<operation>`            (added by P0)
 *
 * Two defects made invalidation a silent no-op:
 *
 *  1. `invalidateCacheByPrefix` ALWAYS prepended `EXACT_PREFIX`, so every caller
 *     produced an unmatchable pattern — `invalidateCacheByPrefix('omnivyra:ai_resp:v2')`
 *     scanned `omnivyra:ai_resp:v2:omnivyra:ai_resp:v2*`, and an operation name
 *     scanned for a key component that does not exist. Both returned 0 while
 *     reporting success.
 *  2. The admin flush targeted `omnivyra:ai_sem:v2` while the live near-match
 *     namespace is v3, so even a working scan would have missed it.
 */
const OPERATION_INDEX_PREFIX = 'omnivyra:ai_opidx:v1';

function operationIndexKey(operation: string): string {
  return `${OPERATION_INDEX_PREFIX}:${operation}`;
}

async function indexKeyForOperation(
  client: IORedis, operation: string, exactKey: string, ttl: number,
): Promise<void> {
  try {
    const idx = operationIndexKey(operation);
    const pipe = client.pipeline();
    pipe.sadd(idx, exactKey);
    pipe.expire(idx, ttl * 2); // outlive the entries it points at
    await pipe.exec();
  } catch { /* fail-safe — indexing must never fail a cache write */ }
}

/** Delete keys matching a VERBATIM Redis pattern. No prefix is prepended. */
export async function invalidateByPattern(pattern: string): Promise<number> {
  const client = getClient();
  if (!client || !_available) return 0;
  // Refuse an unbounded wildcard: a bare '*' would delete every key in the
  // database, including queues and sessions that this module does not own.
  if (!pattern || pattern === '*' || !pattern.startsWith('omnivyra:')) return 0;
  let deleted = 0;
  try {
    let cursor = '0';
    do {
      const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) {
        await client.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== '0');
  } catch { /* fail-safe */ }
  return deleted;
}

/** Delete every cached entry for one operation, via the operation index. */
export async function invalidateOperation(operation: string): Promise<number> {
  const client = getClient();
  if (!client || !_available || !operation) return 0;
  let deleted = 0;
  try {
    const idx = operationIndexKey(operation);
    const keys = await client.smembers(idx);
    if (keys.length > 0) {
      deleted += await client.del(...keys);
      // The hot tier is consulted before Redis, so it must drop the same keys.
      for (const k of keys) hotInvalidate(k);
    }
    await client.del(idx);
  } catch { /* fail-safe */ }
  return deleted;
}

/**
 * Flush BOTH AI cache namespaces at their live versions. Used by the admin
 * flush control, which previously purged a dead v2 namespace.
 */
export async function invalidateAllAiCache(): Promise<number> {
  const exact = await invalidateByPattern(`${EXACT_PREFIX}:*`);
  const semantic = await invalidateByPattern(`${SEMANTIC_NS.prefix}:v${SEMANTIC_NS.version}:*`);
  const opIndex = await invalidateByPattern(`${OPERATION_INDEX_PREFIX}:*`);
  hotClear();
  return exact + semantic + opIndex;
}

/**
 * Invalidate cache entries.
 *
 * Backwards-compatible entry point retained for the two existing caller shapes:
 * a full namespace/key pattern (admin flush) or an operation name (downstream
 * invalidation). The dispatch is explicit rather than silent because both
 * shapes are already in the codebase and both were previously broken.
 */
export async function invalidateCacheByPrefix(prefixOrOperation: string): Promise<number> {
  if (!prefixOrOperation) return 0;
  if (prefixOrOperation.startsWith('omnivyra:')) {
    return invalidateByPattern(
      prefixOrOperation.endsWith('*') ? prefixOrOperation : `${prefixOrOperation}*`,
    );
  }
  return invalidateOperation(prefixOrOperation);
}

/**
 * Strategy Reuse Index — Day-2 Upgrade A
 *
 * Before calling GPT for a campaign strategy, check whether a similar strategy
 * already exists in the index (same industry + goal bucket + audience segment).
 * If similarity ≥ threshold, return the cached strategy directly — 0 GPT calls.
 *
 * Storage: Redis sorted-set per industry+goal bucket, capped at 200 entries.
 * Match: Jaccard similarity on tokenized (goal + audience + platforms) fingerprint.
 * TTL: 7 days (strategies don't change meaning frequently).
 *
 * Expected savings: 30–50% of L2 GPT calls for accounts in common verticals.
 */

import IORedis from 'ioredis';
import { createHash } from 'crypto';
import type { CampaignStrategy } from './campaignStrategyEngine';
import { createInstrumentedClient } from '../../lib/redis/instrumentation';

const REDIS_URL      = process.env.REDIS_URL || 'redis://localhost:6379';
const PREFIX         = 'omnivyra:strategy_idx:v1';
const MAX_ENTRIES    = 200;
const ENTRY_TTL_SECS = 7 * 24 * 3600;   // 7 days
const SIM_THRESHOLD  = 0.72;            // Jaccard threshold for reuse

// ── Redis ─────────────────────────────────────────────────────────────────────

let _client: IORedis | null = null;

function getClient(): IORedis | null {
  if (_client) return _client;
  try {
    const raw = new IORedis(REDIS_URL, {
      enableReadyCheck: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      lazyConnect: true,
    });
    raw.connect().catch(() => {});
    _client = createInstrumentedClient(raw, 'strategy_index') as IORedis;
    return _client;
  } catch {
    return null;
  }
}

// ── Fingerprinting ────────────────────────────────────────────────────────────

interface StrategyFingerprint {
  industry:  string;
  goal:      string;
  audience:  string;
  platforms: string[];
  duration:  number;
}

function tokenize(text: string): string[] {
  return Array.from(new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3)
  ));
}

function fingerprint(fp: StrategyFingerprint): string[] {
  return tokenize([fp.goal, fp.audience, fp.industry].join(' '));
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Stable bucket key: industry + goal category (coarse, so similar goals share a bucket). */
function bucketKey(fp: StrategyFingerprint): string {
  const industry = fp.industry.toLowerCase().replace(/\s+/g, '_').slice(0, 30) || 'generic';
  // Coarse goal bucket: extract first meaningful word
  const goalWord = tokenize(fp.goal)[0] || 'general';
  return `${PREFIX}:${industry}:${goalWord}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

interface IndexEntry {
  tokens:   string[];
  strategy: CampaignStrategy;
  storedAt: string;
}

/**
 * Look up a matching strategy from the index before calling GPT.
 * Returns the strategy on hit (≥ SIM_THRESHOLD), null on miss.
 */
export async function findSimilarStrategy(
  fp: StrategyFingerprint,
): Promise<CampaignStrategy | null> {
  const client = getClient();
  if (!client) return null;

  const bucket = bucketKey(fp);
  const queryTokens = fingerprint(fp);

  try {
    const rawEntries = await client.lrange(bucket, 0, MAX_ENTRIES - 1);
    let best: { score: number; strategy: CampaignStrategy } | null = null;

    for (const raw of rawEntries) {
      try {
        const entry = JSON.parse(raw) as IndexEntry;
        const score = jaccard(queryTokens, entry.tokens);
        if (score >= SIM_THRESHOLD && (!best || score > best.score)) {
          best = { score, strategy: entry.strategy };
        }
      } catch { /* corrupt entry — skip */ }
    }

    if (best) {
      if (process.env.NODE_ENV !== 'test') {
        console.info('[strategy-reuse] hit', { score: best.score.toFixed(2), bucket });
      }
      return best.strategy;
    }
  } catch { /* fail open */ }

  return null;
}

/**
 * Store a generated strategy in the reuse index.
 * Call after every successful L2 GPT call.
 */
export async function indexStrategy(
  fp: StrategyFingerprint,
  strategy: CampaignStrategy,
): Promise<void> {
  const client = getClient();
  if (!client) return;

  const bucket = bucketKey(fp);
  const entry: IndexEntry = {
    tokens:   fingerprint(fp),
    strategy,
    storedAt: new Date().toISOString(),
  };

  try {
    const pipe = client.pipeline();
    pipe.lpush(bucket, JSON.stringify(entry));
    pipe.ltrim(bucket, 0, MAX_ENTRIES - 1);
    pipe.expire(bucket, ENTRY_TTL_SECS);
    await pipe.exec();
  } catch { /* fire-and-forget */ }
}

export type { StrategyFingerprint };

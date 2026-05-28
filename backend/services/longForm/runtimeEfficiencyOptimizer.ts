/**
 * runtimeEfficiencyOptimizer.ts
 *
 * Phase 6.4 — Reduces wasted work across retries:
 *
 *   - identity-lock / anti-generic / doctrine fragment caching across
 *     sections in the same article (they don't change per section)
 *   - grounding-fragment encode reuse (Phase 5.2's encode cache covers
 *     individual fragments; we add article-level reuse)
 *   - assignment-block caching
 *   - prompt-compression result reuse for identical (segments, mode)
 *     tuples
 *   - retry deduplication: skip the regenerate call when an identical
 *     (contract.sectionContractId, hint.recoveryAction) pair already
 *     ran and failed in this article — emit "retry_deduplicated"
 *     telemetry instead of burning the tokens.
 *
 * The cache is in-process and per-article (keyed by a caller-supplied
 * articleId). The optimizer surfaces metrics so operators can see
 * how much it saved.
 */

import type { PromptSegment, CompressedPromptResult } from './promptCompressionEngine';

// ── Cache entries ────────────────────────────────────────────────────────────

interface IdentityLockEntry {
  systemBlock: string;
  tokens: number;
}

interface DoctrineFragmentEntry {
  body: string;
  tokens: number;
}

interface CompressedPromptEntry {
  result: CompressedPromptResult;
  tokens: number;
}

// ── Public types ─────────────────────────────────────────────────────────────

export interface EfficiencyMetrics {
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;             // 0..1
  retriesDeduplicated: number;
  savedTokens: number;
  savedDurationMs: number;
  /** Aggregate efficiency gain: savedTokens / (savedTokens + actualTokens). */
  efficiencyGain: number;
}

export interface RetryDeduplicationKey {
  sectionContractId: string;
  recoveryAction: string;
  hintAttemptNumber: number;
}

// ── Cache ────────────────────────────────────────────────────────────────────

export class GenerationFragmentCache {
  private identityLocks = new Map<string, IdentityLockEntry>();
  private antiGenericBlocks = new Map<string, IdentityLockEntry>();
  private doctrineFragments = new Map<string, DoctrineFragmentEntry>();
  private groundingFragmentKeys = new Set<string>();
  private assignmentBlocks = new Map<string, string>();
  private compressedPrompts = new Map<string, CompressedPromptEntry>();
  private failedRetries = new Set<string>();

  // Metrics
  private cacheHits = 0;
  private cacheMisses = 0;
  private retriesDeduplicated = 0;
  private savedTokens = 0;
  private savedDurationMs = 0;
  private observedTokens = 0;

  // ── Identity lock ───────────────────────────────────────────────────
  getIdentityLock(companyKey: string): IdentityLockEntry | undefined {
    const hit = this.identityLocks.get(companyKey);
    if (hit) { this.cacheHits += 1; this.savedTokens += hit.tokens; }
    else { this.cacheMisses += 1; }
    return hit;
  }
  setIdentityLock(companyKey: string, systemBlock: string): void {
    this.identityLocks.set(companyKey, {
      systemBlock,
      tokens: estimateTokens(systemBlock),
    });
  }

  // ── Anti-generic rules ──────────────────────────────────────────────
  getAntiGenericBlock(companyKey: string): IdentityLockEntry | undefined {
    const hit = this.antiGenericBlocks.get(companyKey);
    if (hit) { this.cacheHits += 1; this.savedTokens += hit.tokens; }
    else { this.cacheMisses += 1; }
    return hit;
  }
  setAntiGenericBlock(companyKey: string, body: string): void {
    this.antiGenericBlocks.set(companyKey, { systemBlock: body, tokens: estimateTokens(body) });
  }

  // ── Doctrine fragments ─────────────────────────────────────────────
  getDoctrineFragment(key: string): DoctrineFragmentEntry | undefined {
    const hit = this.doctrineFragments.get(key);
    if (hit) { this.cacheHits += 1; this.savedTokens += hit.tokens; }
    else { this.cacheMisses += 1; }
    return hit;
  }
  setDoctrineFragment(key: string, body: string): void {
    this.doctrineFragments.set(key, { body, tokens: estimateTokens(body) });
  }

  // ── Grounding fragments (encode-once flag) ─────────────────────────
  hasGroundingFragmentsEncoded(profileId: string): boolean {
    return this.groundingFragmentKeys.has(profileId);
  }
  markGroundingFragmentsEncoded(profileId: string): void {
    this.groundingFragmentKeys.add(profileId);
  }

  // ── Assignment blocks ──────────────────────────────────────────────
  getAssignmentBlock(sectionAssignmentKey: string): string | undefined {
    const hit = this.assignmentBlocks.get(sectionAssignmentKey);
    if (hit) { this.cacheHits += 1; this.savedTokens += estimateTokens(hit); }
    else { this.cacheMisses += 1; }
    return hit;
  }
  setAssignmentBlock(sectionAssignmentKey: string, body: string): void {
    this.assignmentBlocks.set(sectionAssignmentKey, body);
  }

  // ── Compressed prompts ─────────────────────────────────────────────
  getCompressedPrompt(key: string): CompressedPromptResult | undefined {
    const hit = this.compressedPrompts.get(key);
    if (hit) {
      this.cacheHits += 1;
      this.savedTokens += hit.tokens;
      this.savedDurationMs += 50; // compression is fast but non-trivial
      return hit.result;
    }
    this.cacheMisses += 1;
    return undefined;
  }
  setCompressedPrompt(key: string, result: CompressedPromptResult): void {
    this.compressedPrompts.set(key, { result, tokens: result.tokenReduction });
  }

  // ── Retry deduplication ────────────────────────────────────────────
  hasFailedRetry(key: RetryDeduplicationKey): boolean {
    return this.failedRetries.has(dedupeKey(key));
  }
  markFailedRetry(key: RetryDeduplicationKey, estimatedTokens: number): void {
    const k = dedupeKey(key);
    if (!this.failedRetries.has(k)) {
      this.failedRetries.add(k);
    }
  }
  recordRetryDeduplication(estimatedTokens: number, estimatedDurationMs: number): void {
    this.retriesDeduplicated += 1;
    this.savedTokens += estimatedTokens;
    this.savedDurationMs += estimatedDurationMs;
  }

  // ── Observation hooks ──────────────────────────────────────────────
  recordObservedTokens(tokens: number): void {
    this.observedTokens += tokens;
  }

  // ── Metrics ────────────────────────────────────────────────────────
  getMetrics(): EfficiencyMetrics {
    const totalLookups = this.cacheHits + this.cacheMisses;
    const cacheHitRate = totalLookups === 0 ? 0 : Number((this.cacheHits / totalLookups).toFixed(3));
    const totalCost = this.observedTokens + this.savedTokens;
    const efficiencyGain = totalCost === 0 ? 0 : Number((this.savedTokens / totalCost).toFixed(3));
    return {
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRate,
      retriesDeduplicated: this.retriesDeduplicated,
      savedTokens: this.savedTokens,
      savedDurationMs: this.savedDurationMs,
      efficiencyGain,
    };
  }

  reset(): void {
    this.identityLocks.clear();
    this.antiGenericBlocks.clear();
    this.doctrineFragments.clear();
    this.groundingFragmentKeys.clear();
    this.assignmentBlocks.clear();
    this.compressedPrompts.clear();
    this.failedRetries.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.retriesDeduplicated = 0;
    this.savedTokens = 0;
    this.savedDurationMs = 0;
    this.observedTokens = 0;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function dedupeKey(key: RetryDeduplicationKey): string {
  return `${key.sectionContractId}::${key.recoveryAction}::${key.hintAttemptNumber}`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── In-process article cache registry ───────────────────────────────────────
//
// Articles run in a single Node process; we key caches by article id
// (typically generationContractId). After an article completes the
// orchestrator should call `releaseCache(articleId)` to free memory.

const ARTICLE_CACHES = new Map<string, GenerationFragmentCache>();

export function getOrCreateArticleCache(articleId: string): GenerationFragmentCache {
  let cache = ARTICLE_CACHES.get(articleId);
  if (!cache) {
    cache = new GenerationFragmentCache();
    ARTICLE_CACHES.set(articleId, cache);
  }
  return cache;
}

export function releaseArticleCache(articleId: string): EfficiencyMetrics | undefined {
  const cache = ARTICLE_CACHES.get(articleId);
  if (!cache) return undefined;
  const metrics = cache.getMetrics();
  ARTICLE_CACHES.delete(articleId);
  return metrics;
}

// ── Aggregate metrics across all caches ─────────────────────────────────────

const aggregate = {
  cacheHits: 0,
  cacheMisses: 0,
  retriesDeduplicated: 0,
  savedTokens: 0,
  savedDurationMs: 0,
  observedTokens: 0,
  articles: 0,
};

export function accumulateArticleMetrics(metrics: EfficiencyMetrics, observedTokens: number): void {
  aggregate.cacheHits += metrics.cacheHits;
  aggregate.cacheMisses += metrics.cacheMisses;
  aggregate.retriesDeduplicated += metrics.retriesDeduplicated;
  aggregate.savedTokens += metrics.savedTokens;
  aggregate.savedDurationMs += metrics.savedDurationMs;
  aggregate.observedTokens += observedTokens;
  aggregate.articles += 1;
}

export interface AggregateRuntimeEfficiencyReport {
  total_articles: number;
  total_cache_hits: number;
  total_cache_misses: number;
  overall_cache_hit_rate: number;
  total_retries_deduplicated: number;
  total_saved_tokens: number;
  total_saved_duration_ms: number;
  overall_efficiency_gain: number;
}

export function getAggregateRuntimeEfficiencyReport(): AggregateRuntimeEfficiencyReport {
  const totalLookups = aggregate.cacheHits + aggregate.cacheMisses;
  const rate = totalLookups === 0 ? 0 : Number((aggregate.cacheHits / totalLookups).toFixed(3));
  const totalCost = aggregate.observedTokens + aggregate.savedTokens;
  const gain = totalCost === 0 ? 0 : Number((aggregate.savedTokens / totalCost).toFixed(3));
  return {
    total_articles: aggregate.articles,
    total_cache_hits: aggregate.cacheHits,
    total_cache_misses: aggregate.cacheMisses,
    overall_cache_hit_rate: rate,
    total_retries_deduplicated: aggregate.retriesDeduplicated,
    total_saved_tokens: aggregate.savedTokens,
    total_saved_duration_ms: aggregate.savedDurationMs,
    overall_efficiency_gain: gain,
  };
}

export function __resetRuntimeEfficiencyAggregatorForTests(): void {
  ARTICLE_CACHES.clear();
  aggregate.cacheHits = 0;
  aggregate.cacheMisses = 0;
  aggregate.retriesDeduplicated = 0;
  aggregate.savedTokens = 0;
  aggregate.savedDurationMs = 0;
  aggregate.observedTokens = 0;
  aggregate.articles = 0;
}

// Re-export PromptSegment for consumers that wire compression through the cache.
export type { PromptSegment, CompressedPromptResult };

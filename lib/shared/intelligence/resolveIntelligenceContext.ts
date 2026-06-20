/**
 * Phase 6D-A / 6E-2 — Intelligent Mix intelligence resolver (READ-ONLY).
 *
 * Aggregates high-confidence intelligence into a compact advisory payload. It
 * creates no tables, no analytics, and never writes. Phase 6E-2 re-pointed every
 * field at LIVE, company-scoped authorities (replacing the dark
 * campaign_autonomous_learnings backbone and the campaign-scoped platform ranker):
 *   topLearnings     ← marketing_memory (campaign_outcome / content_performance / narrative_performance)
 *   platformRankings ← campaign_performance_signals (company-scoped engagement)
 *   contentBiases    ← marketing_memory (content_performance)
 *
 * Company-scoped, confidence-filtered, empty-safe. Every call is guarded — the
 * resolver NEVER throws. Return shape and the ResolveIntelligenceParams contract
 * are unchanged (no consumer/prompt impact).
 */

import {
  getMarketingMemoriesByType,
  type MarketingMemoryEntry,
} from '../../../backend/services/marketingMemoryService';
import { rankPlatformsByCompanyPerformance } from '../../../backend/services/companyPerformanceAggregator';

export interface IntelligenceContext {
  /** General "what worked / what to avoid" patterns (≤5). */
  topLearnings: string[];
  /** Platforms ranked by engagement (≤5). */
  platformRankings: string[];
  /** Content-type / format effectiveness signals (≤5). */
  contentBiases: string[];
}

export interface ResolveIntelligenceParams {
  companyId: string;
  /**
   * Optional campaign to source campaign-scoped engagement signals from. When
   * omitted (the Architect's default), platform/content signals derive from the
   * company's typed learnings instead.
   */
  campaignId?: string | null;
}

const EMPTY: IntelligenceContext = { topLearnings: [], platformRankings: [], contentBiases: [] };

const MAX_ITEMS = 5;
const MAX_LINE_CHARS = 120;
/** HIGH-confidence floor — only signals at/above this are planning-suitable. */
const MIN_CONFIDENCE = 0.6;

const STRONG_ENGAGEMENT = 0.05; // ≥5% avg engagement → "high"
const WEAK_ENGAGEMENT = 0.01; //   <1% avg engagement → "low"

function clip(s: string, n: number = MAX_LINE_CHARS): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function engagementBand(rate: number): string {
  if (rate >= STRONG_ENGAGEMENT) return 'high engagement';
  if (rate >= WEAK_ENGAGEMENT) return 'medium engagement';
  return 'low engagement';
}

/** Pull a usable advisory line from a marketing_memory entry. */
function lineFromMemory(e: MarketingMemoryEntry): string | null {
  const mv = (e?.memory_value ?? {}) as Record<string, unknown>;
  const fmt = mv.format;
  if (typeof fmt === 'string' && fmt.trim()) return clip(`${fmt} content performed well historically`);
  const narrative = mv.narrative;
  if (typeof narrative === 'string' && narrative.trim()) return clip(`${narrative} narrative resonated with the audience`);
  const er = mv.engagement_rate;
  if (typeof er === 'number' && er > 0) return clip(`Past campaigns averaged ${(er * 100).toFixed(1)}% engagement`);
  return null;
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of items) {
    const key = s.toLowerCase();
    if (s && !seen.has(key)) { seen.add(key); out.push(s); }
  }
  return out;
}

async function safeArray<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return (await fn()) ?? [];
  } catch {
    return [];
  }
}

/**
 * Resolve a compact advisory intelligence payload from LIVE company-scoped
 * authorities. Read-only; company-scoped; confidence-filtered; never throws;
 * empty arrays are valid (graceful degradation when no signals exist).
 */
export async function resolveIntelligenceContext(
  params: ResolveIntelligenceParams,
): Promise<IntelligenceContext> {
  try {
    const companyId = params?.companyId?.trim();
    if (!companyId) return EMPTY;

    const [contentPerf, narrativePerf, campaignOutcome, platformRanks] = await Promise.all([
      safeArray(() => getMarketingMemoriesByType(companyId, 'content_performance', 20)),
      safeArray(() => getMarketingMemoriesByType(companyId, 'narrative_performance', 20)),
      safeArray(() => getMarketingMemoriesByType(companyId, 'campaign_outcome', 20)),
      safeArray(() => rankPlatformsByCompanyPerformance(companyId)),
    ]);

    // topLearnings — confidence-filtered marketing_memory across the three types.
    const learningEntries = [...contentPerf, ...narrativePerf, ...campaignOutcome].filter(
      (e) => (e.confidence ?? 0) >= MIN_CONFIDENCE,
    );
    const topLearnings = dedupe(
      learningEntries.map(lineFromMemory).filter((l): l is string => !!l),
    ).slice(0, MAX_ITEMS);

    // platformRankings — company-scoped engagement from campaign_performance_signals.
    const platformRankings = platformRanks
      .slice(0, MAX_ITEMS)
      .map((r) => clip(`${String(r.platform).toLowerCase()} (${engagementBand(r.avg_engagement_rate ?? 0)})`));

    // contentBiases — content_performance formats only.
    const contentBiases = dedupe(
      contentPerf
        .filter((e) => (e.confidence ?? 0) >= MIN_CONFIDENCE)
        .map((e) => {
          const f = (e.memory_value as Record<string, unknown> | undefined)?.format;
          return typeof f === 'string' && f.trim() ? clip(`${f} content performs best`) : null;
        })
        .filter((l): l is string => !!l),
    ).slice(0, MAX_ITEMS);

    // Observability (6E-2) — counts only; no content, no PII, no company values.
    const recordsConsidered = learningEntries.length + platformRanks.length + contentPerf.length;
    const recordsKept = topLearnings.length + platformRankings.length + contentBiases.length;
    console.info('[intelligence/resolve]', JSON.stringify({
      source_used: 'marketing_memory+campaign_performance_signals',
      records_considered: recordsConsidered,
      records_kept: recordsKept,
      records_discarded: Math.max(0, recordsConsidered - recordsKept),
      top_learnings_kept: topLearnings.length,
      platform_rankings_kept: platformRankings.length,
      content_biases_kept: contentBiases.length,
    }));

    return { topLearnings, platformRankings, contentBiases };
  } catch {
    return EMPTY;
  }
}

/**
 * Render an IntelligenceContext into a compact prompt block. Returns '' when
 * there is nothing to inject. Hard-capped at `maxLines` total (default 10) and
 * never emits a section header without at least one item.
 */
export function formatIntelligenceContextBlock(
  ctx: IntelligenceContext,
  maxLines: number = 10,
): string {
  const sections: Array<{ title: string; items: string[] }> = [
    { title: 'Top Learnings:', items: ctx?.topLearnings ?? [] },
    { title: 'Platform Performance:', items: ctx?.platformRankings ?? [] },
    { title: 'Content Performance:', items: ctx?.contentBiases ?? [] },
  ].filter((s) => s.items.length > 0);

  if (sections.length === 0) return '';

  const lines: string[] = ['INTELLIGENCE INSIGHTS'];
  for (const s of sections) {
    // Need room for a header plus at least one item.
    if (lines.length + 2 > maxLines) break;
    lines.push(s.title);
    for (const item of s.items) {
      if (lines.length >= maxLines) break;
      lines.push(`- ${item}`);
    }
  }
  return lines.join('\n');
}

// ─── Phase 6D-B: plan-generation reuse ──────────────────────────────────────

/**
 * Plan-generation shape. Structurally compatible with the backend
 * `PerformanceInsight` ({ issues, opportunities, recommendations, plannerFeedback })
 * so the BOLT pipeline can populate the EXISTING `previous_performance_insights`
 * field without any schema expansion. `linesAdded` is for observability only.
 */
export interface PlanningIntelligence {
  issues: string[];
  opportunities: string[];
  recommendations: string[];
  plannerFeedback: string;
  /** Count of advisory lines contributed — logged as a count, never the content. */
  linesAdded: number;
}

/**
 * Translate resolver output into a compact PerformanceInsight-shaped payload for
 * the planning prompt. Returns null when there is nothing meaningful to inject
 * (so callers omit the field entirely rather than passing empty strings).
 * Hard-capped at `maxLines` total advisory lines.
 */
export function formatIntelligenceForPlanning(
  ctx: IntelligenceContext,
  maxLines: number = 10,
): PlanningIntelligence | null {
  const opportunities = [...(ctx?.topLearnings ?? []), ...(ctx?.platformRankings ?? [])].slice(0, MAX_ITEMS);
  const recommendations = [...(ctx?.contentBiases ?? [])].slice(0, MAX_ITEMS);
  if (opportunities.length === 0 && recommendations.length === 0) return null;

  // Enforce the hard total-line ceiling across both lists.
  while (opportunities.length + recommendations.length > maxLines) {
    if (recommendations.length >= opportunities.length) recommendations.pop();
    else opportunities.pop();
  }

  return {
    issues: [],
    opportunities,
    recommendations,
    plannerFeedback: formatIntelligenceContextBlock(ctx, maxLines),
    linesAdded: opportunities.length + recommendations.length,
  };
}

export type PlanningIntelligenceMode = 'off' | 'shadow' | 'advisory' | 'active';

/** Normalize the INTELLIGENT_MIX_PLANNING_INTELLIGENCE_MODE env value (default 'shadow'). */
export function normalizePlanningIntelligenceMode(raw: string | undefined | null): PlanningIntelligenceMode {
  const m = String(raw ?? 'shadow').toLowerCase().trim();
  return m === 'off' || m === 'shadow' || m === 'advisory' || m === 'active' ? m : 'shadow';
}

/** The resolver is consulted ONLY for combined campaigns and when mode !== 'off'. */
export function shouldResolvePlanningIntelligence(mode: PlanningIntelligenceMode, isCombined: boolean): boolean {
  return isCombined && mode !== 'off';
}

/** The prompt is enriched ONLY in advisory/active — shadow computes but never injects. */
export function shouldEnrichPlanning(mode: PlanningIntelligenceMode): boolean {
  return mode === 'advisory' || mode === 'active';
}

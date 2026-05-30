/**
 * Active Leads — Source Recommendation API Contract (PR-CAR-3).
 *
 * Single shared response shape used by BOTH endpoints:
 *
 *   POST /api/active-leads/source-recommendations/discovery
 *   GET  /api/active-leads/source-recommendations/audit
 *
 * The discovery and audit endpoints differ ONLY in what they add to
 * the shared shape. They MUST NOT define their own versions of the
 * shared fields — every field on RecommendedSource is produced by
 * `toRecommendedSource` in this module.
 *
 * Rationale: prevents the two endpoints from drifting as the model
 * evolves (PR-CAR-2 added strength, PR-CAR-2.1 added yield, etc.).
 * One serializer, one place to update.
 */

import type { CompanyContext } from './activeLeadsCompanyContext';
import type {
  ScoredSource,
  SourceTier,
  RecommendationStrength,
  SourceYield,
  OpportunityType,
} from './sourceRecommendationEngine';
import {
  OPPORTUNITY_LABELS,
  STRENGTH_LABELS,
} from './sourceRecommendationEngine';

// ---------------------------------------------------------------------------
// Shared shape
// ---------------------------------------------------------------------------

export type RecommendedSource = {
  /**
   * Stable identifier for the source. For discovery candidates that
   * have no persisted UUID yet, this is the composite key
   * `${source_type}:${source_identifier}`. For audit (already-connected
   * listening_sources), this is the row UUID.
   */
  source_id: string;
  source_name: string;
  source_type: string;

  tier: SourceTier;
  strength: RecommendationStrength;
  overall_score: number;

  yield: SourceYield;

  /** Opportunity types this source is strongest for. Top 3, score >= 0.55. */
  best_for: OpportunityType[];
  /**
   * Opportunity types this source is weakest for. Below the engine's
   * "Low" yield threshold (0.35), bottom 3, sorted ascending by score.
   * Empty when the source has no clearly weak dimensions.
   */
  not_ideal_for: OpportunityType[];

  /** Highest-scoring opportunity type. null when no potentials exist. */
  primary_opportunity: OpportunityType | null;
  /** Second-highest opportunity type. null when fewer than two exist. */
  secondary_opportunity: OpportunityType | null;
  /** Lowest-scoring opportunity type. */
  weakest_opportunity: OpportunityType | null;

  /** One-sentence summary, ready for UI. */
  rationale: string;

  /**
   * 0..1. Composite of context completeness (PR-CAR-1) and source
   * signal quality. Low values mean the recommendation rests on
   * sparse company context OR a noisy source.
   */
  confidence: number;

  /**
   * PR-CAR-4.1 — "Why this matches your company" bullets.
   *
   * 2–4 short statements that connect a specific facet of the user's
   * company context (ICP, industry, products, competitors) with a
   * specific characteristic of this source (top opportunity types,
   * persona tags, competitor adjacency). No new scoring — purely text
   * composition over existing fields.
   *
   * Empty array means we don't have enough company context to say
   * anything specific (the UI surfaces the profile-completeness CTA
   * separately).
   */
  fit_reasons: string[];
};

// ---------------------------------------------------------------------------
// Endpoint-specific variants
// ---------------------------------------------------------------------------

export type RecommendedSourceDiscoveryItem = RecommendedSource & {
  /** Verbatim from the underlying discovery candidate when available. */
  recommendation_reason: string;
  /**
   * One-liner aimed at users new to the workspace. Surfaces
   * context-completeness gaps and the "where to start" hint.
   */
  onboarding_suggestion: string;
};

export type AuditAction = 'Keep' | 'Monitor' | 'Consider Pausing';

export type RecommendedSourceAuditItem = RecommendedSource & {
  action: AuditAction;
  action_reason: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Opportunity-potential threshold for "not_ideal_for" classification. */
const NOT_IDEAL_THRESHOLD = 0.35;
const NOT_IDEAL_MAX = 3;

// ---------------------------------------------------------------------------
// Derivation helpers — used ONLY by toRecommendedSource. No public exports.
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pickOpportunity(scored: ScoredSource, index: number): OpportunityType | null {
  return scored.opportunity_potentials[index]?.type ?? null;
}

function pickWeakest(scored: ScoredSource): OpportunityType | null {
  if (scored.opportunity_potentials.length === 0) return null;
  return scored.opportunity_potentials[scored.opportunity_potentials.length - 1]?.type ?? null;
}

function deriveNotIdealFor(scored: ScoredSource): OpportunityType[] {
  return [...scored.opportunity_potentials]
    .filter((p) => p.score < NOT_IDEAL_THRESHOLD)
    .sort((a, b) => a.score - b.score)
    .slice(0, NOT_IDEAL_MAX)
    .map((p) => p.type);
}

function deriveConfidence(ctx: CompanyContext, scored: ScoredSource): number {
  // Signal quality is the per-source half; context confidence (PR-CAR-1) is
  // the per-tenant half. Weighted 0.4 / 0.6 — context completeness matters
  // more because a sparse profile invalidates every recommendation, while a
  // noisy source merely degrades one.
  const signalQuality = scored.yield.scores.signal_quality;
  return clamp01(ctx.confidence * 0.6 + signalQuality * 0.4);
}

function tierLabel(tier: SourceTier): string {
  return tier === 'highly_recommended' ? 'Highly Recommended'
    : tier === 'recommended' ? 'Recommended'
    : 'Lower relevance';
}

// ---------------------------------------------------------------------------
// Discovery extras
// ---------------------------------------------------------------------------

function deriveOnboardingSuggestion(
  ctx: CompanyContext,
  scored: ScoredSource,
): string {
  // Top-priority signal: incomplete profile. If the user has fewer than half
  // the spec fields filled, every recommendation is uncertain — call that out
  // first so they know how to improve future scans.
  if (ctx.confidence < 0.5 && ctx.missingFields.length > 0) {
    const missing = ctx.missingFields.slice(0, 3).join(', ');
    return `Add ${missing} to your company profile to sharpen this recommendation.`;
  }
  if (scored.tier === 'highly_recommended') {
    const headlines = scored.best_for.map((t) => OPPORTUNITY_LABELS[t]).join(' and ');
    return headlines
      ? `Start here — strongest for ${headlines}.`
      : 'Start here — high context alignment.';
  }
  if (scored.tier === 'recommended') {
    return 'Worth enabling once you have spare listening capacity.';
  }
  return 'Skip unless you have a specific reason — better fits exist for your profile.';
}

// ---------------------------------------------------------------------------
// Audit extras
// ---------------------------------------------------------------------------

function deriveAuditAction(tier: SourceTier): AuditAction {
  if (tier === 'highly_recommended') return 'Keep';
  if (tier === 'recommended') return 'Monitor';
  return 'Consider Pausing';
}

function deriveAuditActionReason(scored: ScoredSource): string {
  const y = scored.yield;
  const primary = scored.best_for[0];
  const primaryLabel = primary ? OPPORTUNITY_LABELS[primary] : null;
  const yieldFacets: string[] = [];
  if (y.signal_quality === 'high') yieldFacets.push('high signal quality');
  if (y.lead_potential === 'high') yieldFacets.push('high lead potential');
  if (y.discovery_efficiency === 'low') yieldFacets.push('low discovery efficiency');
  if (y.signal_volume === 'low') yieldFacets.push('low signal volume');

  if (scored.tier === 'highly_recommended') {
    const head = primaryLabel ? `Strongest for ${primaryLabel}.` : 'Strong company-context alignment.';
    const tail = yieldFacets.length > 0 ? ` ${yieldFacets[0]} support keeping it active.` : '';
    return `${head}${tail}`;
  }
  if (scored.tier === 'recommended') {
    const head = primaryLabel ? `${primaryLabel} signals present.` : 'Some alignment with your context.';
    return `${head} Re-evaluate if it stops producing leads.`;
  }
  // low_relevance
  const reasons = yieldFacets.length > 0 ? yieldFacets.join(' and ') : 'limited fit with your company context';
  return `Lower relevance — ${reasons}. Consider pausing to focus credit on better-fit sources.`;
}

// ---------------------------------------------------------------------------
// PR-CAR-4.1 — Fit-reason composition
// ---------------------------------------------------------------------------

/**
 * PR-CAR-6.1 — Integration footprint matcher (hardened).
 *
 * Anchor tokens that signal a product surface includes technical
 * integrations. Matching is performed at the WORD level after
 * tokenizing multi-word product/service entries on whitespace and
 * common separators. Both singular and plural variants are listed
 * explicitly (cheaper and clearer than runtime stemming).
 *
 * The anchor set covers:
 *   • Core integration vocabulary (api, sdk, webhook, integration,
 *     connector, plugin, cli, embed and variants)
 *   • Architecture vocabulary that frequently anchors integration
 *     products even when paired with a generic noun (middleware,
 *     gateway, adapter, protocol, bridge)
 *   • Audience anchor for developer-platform products (developer)
 *
 * Generic productivity nouns (platform, engine, layer, toolkit) are
 * deliberately NOT in the anchor set — they would over-fire on
 * non-integration products. Phrase patterns like "api gateway" and
 * "developer platform" still match because the anchor word ("api" /
 * "developer") is present after tokenization.
 */
const TECHNICAL_INTEGRATION_ANCHOR_TOKENS: ReadonlySet<string> = new Set([
  // Core integration surface
  'api', 'apis',
  'sdk', 'sdks',
  'webhook', 'webhooks',
  'integration', 'integrations',
  'connector', 'connectors',
  'plugin', 'plugins',
  'cli', 'clis',
  'embed', 'embeds', 'embedded', 'embedding', 'embeddable',
  // Architecture-anchored vocabulary
  'middleware', 'middlewares',
  'gateway', 'gateways',
  'adapter', 'adapters',
  'protocol', 'protocols',
  'bridge', 'bridges',
  // Audience anchor (developer-platform / dev-tooling)
  'developer', 'developers',
]);

/**
 * Common separators that occur inside multi-word product/service
 * entries. Hyphens, slashes, ampersands and parens are treated as
 * word boundaries so "api-gateway", "auth/sso", "sdk(s)" all decompose
 * cleanly.
 */
const PRODUCT_TOKEN_SPLIT_RE = /[\s,;|/\\\-_+&()]+/;

function tokenizeProductEntry(entry: string): string[] {
  if (!entry) return [];
  return entry
    .toLowerCase()
    .split(PRODUCT_TOKEN_SPLIT_RE)
    .map((t) => t.trim())
    .filter(Boolean);
}

function hasTechnicalIntegrationFootprint(ctx: CompanyContext): boolean {
  const seen = new Set<string>();
  for (const entry of ctx.products.values) {
    for (const token of tokenizeProductEntry(entry)) seen.add(token);
  }
  for (const entry of ctx.services.values) {
    for (const token of tokenizeProductEntry(entry)) seen.add(token);
  }
  for (const token of seen) {
    if (TECHNICAL_INTEGRATION_ANCHOR_TOKENS.has(token)) return true;
  }
  return false;
}

function fitReasonForOpportunity(
  type: OpportunityType,
  scored: ScoredSource,
): string {
  switch (type) {
    case 'buying_intent':
      return 'Buying-intent conversations occur frequently here.';
    case 'competitor_dissatisfaction': {
      const competitors = scored.context_match.matched_competitors;
      if (competitors.length > 0) {
        const first = competitors.slice(0, 2).join(', ');
        return `Discussions about your competitors (${first}) are common.`;
      }
      return 'Competitor-pain conversations are common.';
    }
    case 'migration_signal':
      return 'Tool-switching and migration discussions are common.';
    case 'hiring_signal':
      return 'Hiring and team-growth posts surface here.';
    case 'growth_signal':
      return 'Growth and scaling chatter is regular.';
    case 'integration_need':
      return 'Integration-need signals are common.';
  }
}

/**
 * Compose 2–4 "why this matches your company" bullets from existing
 * inputs. No new scoring — every bullet maps onto a specific facet
 * already present on CompanyContext or ScoredSource. Deduplicated.
 */
function deriveFitReasons(scored: ScoredSource, ctx: CompanyContext): string[] {
  const reasons: string[] = [];

  // 1) ICP / persona alignment.
  if (scored.persona_tags.length > 0 && ctx.icp.present) {
    const personas = scored.persona_tags.slice(0, 2).join(' and ');
    reasons.push(`Your ICP overlaps with this source's typical audience (${personas}).`);
  } else if (scored.persona_tags.length > 0) {
    const personas = scored.persona_tags.slice(0, 2).join(' and ');
    reasons.push(`This source attracts ${personas} — relevant if they influence purchasing.`);
  } else if (scored.context_match.matched_verticals.length > 0) {
    const verticals = scored.context_match.matched_verticals.slice(0, 2).join(', ');
    reasons.push(`Your industry (${verticals}) is well represented here.`);
  }

  // 2) Top opportunity types — one bullet each, capped at 2.
  for (const type of scored.best_for.slice(0, 2)) {
    reasons.push(fitReasonForOpportunity(type, scored));
  }

  // 3) Technical-integration footprint.
  if (
    hasTechnicalIntegrationFootprint(ctx)
    && scored.best_for.includes('integration_need')
  ) {
    reasons.push('Your product surface includes technical integrations.');
  }

  // Deduplicate while preserving order; cap at 4.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const reason of reasons) {
    const key = reason.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(reason);
    if (deduped.length >= 4) break;
  }
  return deduped;
}

// ---------------------------------------------------------------------------
// Public serializers
// ---------------------------------------------------------------------------

/**
 * Project a ScoredSource into the shared shape. Both endpoints MUST
 * call this — never reach into ScoredSource directly when emitting an
 * API response.
 */
export function toRecommendedSource(
  scored: ScoredSource,
  ctx: CompanyContext,
  sourceId: string,
): RecommendedSource {
  return {
    source_id: sourceId,
    source_name: scored.display_name,
    source_type: scored.source_type,
    tier: scored.tier,
    strength: scored.strength,
    overall_score: scored.overall_score,
    yield: scored.yield,
    best_for: scored.best_for,
    not_ideal_for: deriveNotIdealFor(scored),
    primary_opportunity: pickOpportunity(scored, 0),
    secondary_opportunity: pickOpportunity(scored, 1),
    weakest_opportunity: pickWeakest(scored),
    rationale: scored.rationale,
    confidence: Number(deriveConfidence(ctx, scored).toFixed(3)),
    fit_reasons: deriveFitReasons(scored, ctx),
  };
}

export function toDiscoveryItem(
  scored: ScoredSource,
  ctx: CompanyContext,
  sourceId: string,
  recommendationReason?: string | null,
): RecommendedSourceDiscoveryItem {
  const base = toRecommendedSource(scored, ctx, sourceId);
  return {
    ...base,
    recommendation_reason: recommendationReason && recommendationReason.trim()
      ? recommendationReason
      : scored.rationale,
    onboarding_suggestion: deriveOnboardingSuggestion(ctx, scored),
  };
}

export function toAuditItem(
  scored: ScoredSource,
  ctx: CompanyContext,
  sourceId: string,
): RecommendedSourceAuditItem {
  const base = toRecommendedSource(scored, ctx, sourceId);
  return {
    ...base,
    action: deriveAuditAction(scored.tier),
    action_reason: deriveAuditActionReason(scored),
  };
}

// ---------------------------------------------------------------------------
// Convenience: composite source_id for discovery candidates
// ---------------------------------------------------------------------------

export function compositeSourceId(sourceType: string, sourceIdentifier: string): string {
  return `${sourceType}:${sourceIdentifier}`;
}

// Re-export labels so endpoint consumers don't need a second import.
export { OPPORTUNITY_LABELS, STRENGTH_LABELS };
export type { ScoredSource, SourceTier, RecommendationStrength, SourceYield, OpportunityType };

/**
 * Phase 4 — Opportunity feed service.
 *
 * Two surfaces:
 *
 *   1. `recordOpportunityFromSignal(...)`  — pipeline writer. Called by the
 *      Phase 3 listeningSignalPipeline immediately after a successful
 *      writeLeadSignal. Classifies + clusters + persists one
 *      opportunity_feed_items row. Idempotent on (organization_id,
 *      signal_id) — re-runs are no-ops.
 *
 *   2. `queryOpportunityFeed(...)`         — reader. Filters by type,
 *      platform, confidence, urgency, time window. Returns paged results
 *      with the structured explanation payload intact.
 *
 * Per the Phase 4 prompt: every feed item carries a complete
 * `explanation` JSONB so the UI never surfaces an opaque score. The
 * explanation includes the score breakdown, source trace, matched
 * keywords, moderation outcome, and cluster pointer.
 *
 * Pure additive — does NOT modify lead_signals.
 */

import { ownedDbTable } from '../db/writeOwner';
import { classifyOpportunity } from './opportunityClassifierService';
import { upsertClusterForSignal } from './intentClusteringService';
import {
  publishOpportunityDetectedEvent,
  publishFeedUpdatedEvent,
} from '../events/listeningEvents';
import type {
  IdentityConfidence,
  OpportunityExplanation,
  OpportunityFeedItem,
  OpportunityType,
} from '../types/opportunityFeed';
import { SIGNAL_EXCERPT_MAX_LENGTH, TYPE_VALUE_MULTIPLIER } from '../types/opportunityFeed';
import type { RawSignal } from '../types/listeningConnector';
import type { ModerationDecision } from './moderation/moderationGateService';
import { adoptLead } from './leadIntelligence/leadIntelligenceRuntime';

// ---------------------------------------------------------------------------
// PR-OPA-6 — Value-aware priority ranking
// ---------------------------------------------------------------------------

/**
 * Recency decay with a 2-day half-life (per PR-OPA-6 spec). An
 * opportunity that's 2 days old contributes 0.5; 4 days old → 0.25.
 * Returns 0 for unparseable timestamps so they sink to the bottom on
 * recency contribution alone.
 */
const RECENCY_HALF_LIFE_MS = 2 * 24 * 60 * 60 * 1000;
function recencyDecayValue(createdAtIso: string | null | undefined, now = Date.now()): number {
  if (!createdAtIso) return 0;
  const t = new Date(createdAtIso).getTime();
  if (!Number.isFinite(t)) return 0;
  const ageMs = Math.max(0, now - t);
  return Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS);
}

/**
 * PR-OPA-6 — Composite priority for queue ordering.
 *
 *   priority_score =
 *       (opportunity_score × TYPE_VALUE_MULTIPLIER[type] × 0.40)
 *     + (confidence_score × 0.20)
 *     + (urgency_score    × 0.15)
 *     + identity_bonus     (0.15 high, 0.075 medium, 0 otherwise)
 *     + evidence_bonus     (0.05 when signal_excerpt present, 0 otherwise)
 *     + (recency_decay     × 0.10)
 *
 * Caps at ~1.05 (when every term is at max) — deliberately not
 * clamped to 1.0 because the absolute value isn't surfaced; only the
 * relative ordering matters.
 */
export function computePriorityScore(row: {
  opportunity_type: OpportunityType;
  opportunity_score: number;
  confidence_score: number;
  urgency_score: number;
  identity_confidence: IdentityConfidence | null;
  signal_excerpt: string | null;
  created_at: string;
}, now = Date.now()): number {
  const typeMul = TYPE_VALUE_MULTIPLIER[row.opportunity_type] ?? 0.5;
  const oppScore = clamp01(row.opportunity_score ?? 0);
  const conf     = clamp01(row.confidence_score ?? 0);
  const urg      = clamp01(row.urgency_score ?? 0);
  const idBonus =
    row.identity_confidence === 'high'   ? 0.15 :
    row.identity_confidence === 'medium' ? 0.075 :
    0;
  const evBonus = row.signal_excerpt && row.signal_excerpt.length > 0 ? 0.05 : 0;
  const recency = recencyDecayValue(row.created_at, now);
  return (
      oppScore * typeMul * 0.40
    + conf * 0.20
    + urg  * 0.15
    + idBonus
    + evBonus
    + recency * 0.10
  );
}

// ---------------------------------------------------------------------------
// PR-OPA-3 — High-confidence identity enrichment
// ---------------------------------------------------------------------------

/**
 * Resolved identity tuple returned per-opportunity. All three fields
 * are null together when the platform isn't covered or the metadata
 * doesn't carry enough signal.
 */
export type ResolvedIdentity = {
  resolved_company: string | null;
  resolved_role: string | null;
  identity_confidence: IdentityConfidence | null;
};

const NO_IDENTITY: ResolvedIdentity = {
  resolved_company: null,
  resolved_role: null,
  identity_confidence: null,
};

/**
 * Pattern set for extracting a role/title from a free-text bio. Picks
 * the first match — bios are short enough that this is reliable. The
 * patterns prefer explicit C-suite, VP, and Director titles before
 * fuzzier "Engineer" matches.
 */
const BIO_ROLE_PATTERNS: RegExp[] = [
  /\b(C(?:EO|TO|FO|MO|OO|RO|IO|ISO|PO))\b/,
  /\b(VP(?: of)? [A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*){0,2})\b/,
  /\b(Head of [A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*){0,2})\b/,
  /\b(Director(?: of)? [A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*){0,2})\b/,
  /\b(Founder|Co-?founder|Engineering Manager|Product Manager|Engineering Lead)\b/,
  /\b(Senior [A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?|Staff [A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?)\b/,
];

/** "CTO @ Acme", "VP Eng at Acme Corp", etc. The leading anchor is
 *  (?:^|\s) rather than \b because `@` is a non-word character so `\b`
 *  doesn't behave as expected; the explicit space-or-start lets the
 *  pattern match both "@Acme" (no space) and "@ Acme" (with space). */
const BIO_COMPANY_PATTERNS: RegExp[] = [
  /(?:^|\s)@\s?([A-Z][A-Za-z0-9]+(?:[ -][A-Z][A-Za-z0-9]+)*)/,
  /\bat ([A-Z][A-Za-z0-9]+(?:[ -][A-Z][A-Za-z0-9]+){0,3})\b/,
];

function extractRoleFromBio(bio: string): string | null {
  for (const pattern of BIO_ROLE_PATTERNS) {
    const match = bio.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractCompanyFromBio(bio: string): string | null {
  for (const pattern of BIO_COMPANY_PATTERNS) {
    const match = bio.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function stringField(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * PR-OPA-3 — Resolve company / role / confidence for an opportunity.
 *
 * Coverage per spec:
 *   - linkedin: structured profile fields (profile_company +
 *     profile_title) → 'high' when both present, otherwise 'medium'.
 *   - github:   profile_company field → 'high'. Role from bio if
 *     present (still 'high' confidence, since the company itself is
 *     the structured anchor).
 *   - x:        bio extraction → 'medium' by default; 'high' when
 *     both company AND role anchors are extracted from the bio.
 *
 * All other platforms return NO_IDENTITY — the spec explicitly
 * defers Reddit / HN / Discord inference.
 *
 * NOTE: this resolver does NOT call any external API. It reads
 * whatever profile metadata the listening pipeline already populated
 * on author_metadata. When the upstream pipeline starts capturing
 * richer profile fields (profile_company, profile_title, profile_bio,
 * etc.), enrichment surfaces automatically without further changes
 * to this layer.
 */
export function resolveIdentityFor(
  platform: string | null | undefined,
  authorMetadata: Record<string, unknown> | null | undefined,
): ResolvedIdentity {
  if (!platform || !authorMetadata) return NO_IDENTITY;
  const normalized = platform.toLowerCase();

  if (normalized === 'linkedin') {
    const company = stringField(authorMetadata, 'profile_company');
    const role    = stringField(authorMetadata, 'profile_title');
    if (company && role) {
      return { resolved_company: company, resolved_role: role, identity_confidence: 'high' };
    }
    if (company || role) {
      return { resolved_company: company, resolved_role: role, identity_confidence: 'medium' };
    }
    return NO_IDENTITY;
  }

  if (normalized === 'github') {
    const company = stringField(authorMetadata, 'profile_company');
    if (!company) return NO_IDENTITY;
    const bio = stringField(authorMetadata, 'profile_bio');
    const role = stringField(authorMetadata, 'profile_title')
      ?? (bio ? extractRoleFromBio(bio) : null);
    return { resolved_company: company, resolved_role: role, identity_confidence: 'high' };
  }

  if (normalized === 'x' || normalized === 'twitter') {
    // X may expose structured profile fields OR a free-text bio.
    const structuredCompany = stringField(authorMetadata, 'profile_company');
    const structuredRole    = stringField(authorMetadata, 'profile_title');
    const bio               = stringField(authorMetadata, 'profile_bio');

    const company = structuredCompany ?? (bio ? extractCompanyFromBio(bio) : null);
    const role    = structuredRole    ?? (bio ? extractRoleFromBio(bio) : null);

    if (!company && !role) return NO_IDENTITY;
    // Spec: 'medium unless explicit company title present'.
    // Treat "both extracted from a bio" or "both structured" as
    // 'high'; otherwise 'medium'.
    const bothExplicit = Boolean(company && role);
    return {
      resolved_company: company,
      resolved_role: role,
      identity_confidence: bothExplicit ? 'high' : 'medium',
    };
  }

  if (normalized === 'reddit') {
    // PR-OPA-5 — Reddit profiles have NO structured company / title
    // fields. Resolution is bio-extraction-only, with credibility
    // signals (karma_tier, account_age_years) acting as auxiliary
    // confidence anchors for the low tier (which the UI hides).
    //
    // Rules (per spec):
    //   high:   role + company found in bio
    //   medium: role found in bio
    //   low:    persona only OR karma/account-age only  → UI hides
    //   null:   no usable profile data
    const bio = stringField(authorMetadata, 'profile_bio');
    const company = bio ? extractCompanyFromBio(bio) : null;
    const role    = bio ? extractRoleFromBio(bio)    : null;

    if (company && role) {
      return { resolved_company: company, resolved_role: role, identity_confidence: 'high' };
    }
    if (role) {
      return { resolved_company: null, resolved_role: role, identity_confidence: 'medium' };
    }

    // No role anchor extracted. Check whether credibility signals or
    // a persona hint exist — these qualify as 'low' (hidden by UI but
    // available for downstream scoring / routing experiments).
    const persona    = stringField(authorMetadata, 'inferred_persona');
    const karmaTier  = stringField(authorMetadata, 'karma_tier');
    const ageYearsRaw = authorMetadata.account_age_years;
    const ageYears = typeof ageYearsRaw === 'number' ? ageYearsRaw : null;
    const hasCredibility =
      persona != null
      || karmaTier === 'high' || karmaTier === 'medium'
      || (typeof ageYears === 'number' && ageYears >= 1);
    if (hasCredibility) {
      return { resolved_company: null, resolved_role: null, identity_confidence: 'low' };
    }
    return NO_IDENTITY;
  }

  // HackerNews / Discord / GitHub-without-company / custom:
  // defer to a future PR.
  return NO_IDENTITY;
}

/**
 * PR-OPA-2 — Deterministic next-step guidance per opportunity type.
 *
 * Rule map per spec — no LLM, no CRM integration, no outreach
 * drafting. Returns null for `generic_interest` (vague signals get no
 * specific guidance). Called at read time inside the feed reader and
 * surfaced in the UI directly under the "What was said" block.
 */
export function suggestedNextActionFor(type: OpportunityType): string | null {
  switch (type) {
    case 'buying_intent':              return 'Review discussion.';
    case 'competitor_dissatisfaction': return 'Review complaint thread.';
    case 'migration_signal':           return 'Review migration discussion.';
    case 'hiring_signal':              return 'Review hiring context.';
    case 'product_research':           return 'Monitor evaluation discussion.';
    case 'support_frustration':        return 'Review support issue.';
    case 'integration_need':           return 'Review integration request.';
    case 'generic_interest':           return null;
  }
}

/**
 * PR-OPA-4 — Extract the well-known profile fields a connector may
 * have stashed in `RawSignal.metadata`. Lifts them into
 * `author_metadata` so PR-OPA-3's resolver can see them.
 *
 * Convention (documented; not enforced on the RawSignal type to
 * avoid breaking connector implementors that don't supply profile
 * data): connectors may populate any of:
 *   - profile_company  (e.g. GitHub user.company / LinkedIn title)
 *   - profile_bio      (e.g. GitHub user.bio / X bio)
 *   - profile_name     (e.g. GitHub user.name)
 *   - profile_title    (e.g. LinkedIn structured title)
 *
 * Anything else in metadata stays untouched (and lands on
 * source_context).
 */
function pickProfileFields(meta: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  // String-typed profile fields (PR-OPA-4 + PR-OPA-5).
  const stringKeys = ['profile_company', 'profile_bio', 'profile_name', 'profile_title', 'karma_tier'] as const;
  for (const key of stringKeys) {
    const value = meta[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      out[key] = value.trim();
    }
  }
  // Number-typed profile fields (PR-OPA-5).
  const numberKeys = ['account_age_years'] as const;
  for (const key of numberKeys) {
    const value = meta[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * PR-OPA-1 — Build the signal_excerpt persisted on the feed item.
 * Collapses internal whitespace runs to single spaces, trims, and
 * truncates at SIGNAL_EXCERPT_MAX_LENGTH with an ellipsis suffix when
 * the original content was longer. Returns null for empty input so
 * downstream nullability is preserved.
 */
function buildSignalExcerpt(content: string | null | undefined): string | null {
  if (!content) return null;
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return null;
  if (normalized.length <= SIGNAL_EXCERPT_MAX_LENGTH) return normalized;
  // Truncate to leave room for the ellipsis character.
  return normalized.slice(0, SIGNAL_EXCERPT_MAX_LENGTH - 1).trimEnd() + '…';
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export type RecordOpportunityInput = {
  organizationId: string;
  signalId: string;
  listeningExecutionId: string;
  raw: RawSignal;
  moderation: ModerationDecision;
  baseScores: {
    intent_score: number;
    urgency_score: number;
    icp_score: number;
    confidence_score: number;
    total_score: number;
  };
};

export type RecordOpportunityResult = {
  feed_item: OpportunityFeedItem;
  created: boolean;
  classification: { opportunity_type: OpportunityType; matched_keywords: string[] };
};

export async function recordOpportunityFromSignal(
  input: RecordOpportunityInput,
): Promise<RecordOpportunityResult | null> {
  // Idempotency — if a feed item already exists for this signal, return it.
  const { data: existing } = await ownedDbTable('opportunity_feed_items')
    .select('*')
    .eq('organization_id', input.organizationId)
    .eq('signal_id', input.signalId)
    .maybeSingle();
  if (existing) {
    const item = existing as OpportunityFeedItem;
    return {
      feed_item: item,
      created: false,
      classification: {
        opportunity_type: item.opportunity_type,
        matched_keywords: item.matched_keywords,
      },
    };
  }

  const classification = classifyOpportunity(input.raw.content_text);

  // Score derivation. `total_score` is the canonical signal strength;
  // opportunity_score weights it against classification confidence + a
  // keyword-density bonus, with a moderation penalty when flagged.
  const baseTotal = input.baseScores.total_score ?? 0;
  const typeMultiplier = classification.type_multiplier;
  const keywordBonus = Math.min(0.2, classification.matched_keywords.length * 0.05);
  const moderationPenalty = input.moderation.outcome === 'flagged' ? 0.85 : 1.0;
  const opportunityScore = clamp01((baseTotal * typeMultiplier + keywordBonus) * moderationPenalty);

  // Confidence: blend base confidence with the classifier match strength.
  const classifierConfidence = classification.matched_patterns.length > 0
    ? Math.min(1, 0.7 + classification.matched_patterns.length * 0.05)
    : 0.5;
  const confidence = clamp01(
    (input.baseScores.confidence_score ?? 0.5) * 0.5 + classifierConfidence * 0.5,
  );

  // Urgency carries through; comments are slightly more urgent (someone is
  // actively responding to a thread).
  const urgency = clamp01(
    (input.baseScores.urgency_score ?? 0) * (input.raw.is_comment ? 1.05 : 1.0),
  );

  // Cluster — only for non-generic classifications. Generic-interest signals
  // are stored without a cluster so the UI doesn't fan them across spurious
  // groups.
  let clusterId: string | null = null;
  let clusterKey: string | null = null;
  if (classification.opportunity_type !== 'generic_interest') {
    const sourceIdentifier =
      (input.raw.metadata as { subreddit?: string }).subreddit
      ?? (input.raw.metadata as { source_identifier?: string }).source_identifier
      ?? null;
    const cluster = await upsertClusterForSignal({
      organizationId: input.organizationId,
      sourceType: 'listening',
      sourceIdentifier: sourceIdentifier,
      opportunityType: classification.opportunity_type,
      content: input.raw.content_text,
      matchedKeywords: classification.matched_keywords,
      intentScore: input.baseScores.intent_score ?? 0,
      urgencyScore: urgency,
    });
    clusterId = cluster.cluster.id;
    clusterKey = cluster.cluster.cluster_key;
  }

  const sourceIdentifier =
    typeof (input.raw.metadata as { subreddit?: unknown }).subreddit === 'string'
      ? String((input.raw.metadata as { subreddit: string }).subreddit)
      : null;

  const detectedReason = buildDetectedReason(classification.opportunity_type, classification.matched_keywords);

  const explanation: OpportunityExplanation = {
    why: detectedReason,
    matched_keywords: classification.matched_keywords,
    score_breakdown: {
      base_total_score: Number(baseTotal.toFixed(3)),
      type_multiplier: typeMultiplier,
      keyword_match_bonus: Number(keywordBonus.toFixed(3)),
      moderation_penalty: moderationPenalty,
      final: Number(opportunityScore.toFixed(3)),
    },
    source_trace: {
      listening_execution_id: input.listeningExecutionId,
      source_type: 'listening',
      source_identifier: sourceIdentifier,
      platform: input.raw.platform,
      detected_at: input.raw.detected_at,
    },
    moderation: {
      outcome: input.moderation.outcome,
      reasons: input.moderation.reasons,
    },
    cluster: {
      cluster_key: clusterKey,
      cluster_id: clusterId,
    },
  };

  const { data: inserted, error } = await ownedDbTable('opportunity_feed_items')
    .insert({
      organization_id: input.organizationId,
      signal_id: input.signalId,
      cluster_id: clusterId,
      listening_execution_id: input.listeningExecutionId,
      opportunity_type: classification.opportunity_type,
      opportunity_score: Number(opportunityScore.toFixed(3)),
      confidence_score: Number(confidence.toFixed(3)),
      urgency_score: Number(urgency.toFixed(3)),
      source_context: input.raw.metadata,
      detected_reason: detectedReason,
      matched_keywords: classification.matched_keywords,
      platform: input.raw.platform,
      source_identifier: sourceIdentifier,
      author_metadata: input.raw.platform_user_id
        ? {
            platform_user_id: input.raw.platform_user_id,
            author_handle: input.raw.author_handle,
            // PR-OPA-4 — forward optional profile fields the connector
            // captured on RawSignal.metadata. PR-OPA-3's identity
            // resolver reads from author_metadata, so the forwarding
            // is what lights up the Identity block in the UI for
            // covered platforms.
            ...pickProfileFields(input.raw.metadata),
          }
        : {},
      recommendation_context: {},
      explanation,
      signal_excerpt: buildSignalExcerpt(input.raw.content_text),
    })
    .select('*')
    .single();

  if (error || !inserted) {
    // Race condition: another caller wrote the same (org, signal_id) — return
    // the existing row deterministically.
    if (error?.code === '23505') {
      const { data: raced } = await ownedDbTable('opportunity_feed_items')
        .select('*')
        .eq('organization_id', input.organizationId)
        .eq('signal_id', input.signalId)
        .maybeSingle();
      if (raced) {
        return {
          feed_item: raced as OpportunityFeedItem,
          created: false,
          classification: {
            opportunity_type: classification.opportunity_type,
            matched_keywords: classification.matched_keywords,
          },
        };
      }
    }
    throw new Error(`Failed to record opportunity feed item: ${error?.message ?? 'unknown'}`);
  }

  const feedItem = inserted as OpportunityFeedItem;

  await publishOpportunityDetectedEvent({
    organization_id: feedItem.organization_id,
    opportunity_feed_item_id: feedItem.id,
    signal_id: feedItem.signal_id,
    opportunity_type: feedItem.opportunity_type,
    opportunity_score: feedItem.opportunity_score,
    cluster_id: feedItem.cluster_id,
    occurred_at: feedItem.created_at,
  });

  // Phase 3 — a newly classified community opportunity also becomes a canonical
  // Lead Intelligence record (Active Leads continues to roll these up). Fail-open.
  adoptLead('community', feedItem as unknown as Record<string, unknown>);

  return {
    feed_item: feedItem,
    created: true,
    classification: {
      opportunity_type: classification.opportunity_type,
      matched_keywords: classification.matched_keywords,
    },
  };
}

function buildDetectedReason(type: OpportunityType, matched: string[]): string {
  const matchHint = matched.length > 0 ? ` (matched: ${matched.slice(0, 3).join(', ')})` : '';
  switch (type) {
    case 'buying_intent':
      return `Explicit buyer-intent language detected${matchHint}.`;
    case 'migration_signal':
      return `Active vendor switching language detected${matchHint}.`;
    case 'competitor_dissatisfaction':
      return `Negative competitor sentiment detected${matchHint}.`;
    case 'product_research':
      return `Product-comparison / research language detected${matchHint}.`;
    case 'integration_need':
      return `Integration / API need detected${matchHint}.`;
    case 'hiring_signal':
      return `Hiring signal detected${matchHint}.`;
    case 'support_frustration':
      return `Support pain detected${matchHint}.`;
    case 'generic_interest':
    default:
      return `Topic match without a specific buyer-intent pattern${matchHint}.`;
  }
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

export type OpportunityFeedQuery = {
  organizationId: string;
  types?: OpportunityType[];
  platforms?: string[];
  minConfidence?: number;
  minUrgency?: number;
  sinceIso?: string;
  cursor?: string | null;
  pageSize?: number;
};

export type OpportunityFeedPage = {
  items: OpportunityFeedItem[];
  next_cursor: string | null;
  total: number;
};

/**
 * PR-OPA-6 — bounded read window for the priority-sort path. The
 * priority_score is computed at read time (no DB column) so the
 * server fetches up to this many rows, sorts in memory, and returns
 * the top pageSize. Bounded to keep payload + sort cost predictable.
 */
const PRIORITY_SORT_WINDOW = 500;

export async function queryOpportunityFeed(
  q: OpportunityFeedQuery,
): Promise<OpportunityFeedPage> {
  const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25));

  // PR-OPA-6: no created_at ORDER BY. Fetch a bounded window matching
  // the filters, then sort in-memory by the derived priority_score.
  // Cursor pagination is dropped here — priority_score isn't persisted,
  // so there's no natural DB-side cursor. Callers needing deeper
  // results should request a larger pageSize.
  let query = ownedDbTable('opportunity_feed_items')
    .select('*', { count: 'exact' })
    .eq('organization_id', q.organizationId)
    .limit(PRIORITY_SORT_WINDOW);

  if (q.types && q.types.length > 0) query = query.in('opportunity_type', q.types);
  if (q.platforms && q.platforms.length > 0) query = query.in('platform', q.platforms);
  if (typeof q.minConfidence === 'number') query = query.gte('confidence_score', q.minConfidence);
  if (typeof q.minUrgency === 'number') query = query.gte('urgency_score', q.minUrgency);
  if (q.sinceIso) query = query.gt('created_at', q.sinceIso);

  const { data, error, count } = await query;
  if (error) throw new Error(`Failed to query opportunity feed: ${error.message}`);

  // PR-OPA-2: enrich every returned row with the rule-derived
  // suggested_next_action.
  // PR-OPA-3: resolve identity from author_metadata for covered
  // platforms. NO_IDENTITY when unsupported / absent.
  // PR-OPA-6: compute priority_score AFTER identity enrichment because
  // identity_confidence contributes to the composite.
  const now = Date.now();
  const enriched = ((data as OpportunityFeedItem[]) ?? []).map((row) => {
    const withDerivedFields = {
      ...row,
      suggested_next_action: suggestedNextActionFor(row.opportunity_type),
      ...resolveIdentityFor(row.platform, row.author_metadata),
    };
    return {
      ...withDerivedFields,
      priority_score: computePriorityScore(withDerivedFields, now),
    };
  });

  enriched.sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0));
  const items = enriched.slice(0, pageSize);
  // next_cursor: priority_score isn't a stored column, so no natural
  // cursor exists. The window is bounded; deep pagination requires
  // larger pageSize.
  const next_cursor: string | null = null;
  return { items, next_cursor, total: count ?? items.length };
}

/**
 * Convenience aggregate for the UI's filter chips.
 */
export async function getOpportunityFeedTypeCounts(
  organizationId: string,
): Promise<Record<OpportunityType, number>> {
  const counts: Record<string, number> = {
    buying_intent: 0,
    competitor_dissatisfaction: 0,
    hiring_signal: 0,
    migration_signal: 0,
    product_research: 0,
    integration_need: 0,
    support_frustration: 0,
    generic_interest: 0,
  };
  const { data, error } = await ownedDbTable('opportunity_feed_items')
    .select('opportunity_type')
    .eq('organization_id', organizationId);
  if (error) throw new Error(`Failed to count opportunity types: ${error.message}`);
  for (const row of (data ?? []) as Array<{ opportunity_type: string }>) {
    counts[row.opportunity_type] = (counts[row.opportunity_type] ?? 0) + 1;
  }
  return counts as Record<OpportunityType, number>;
}

export async function publishFeedBatchUpdated(
  organizationId: string,
  itemsAdded: number,
): Promise<void> {
  if (itemsAdded <= 0) return;
  await publishFeedUpdatedEvent({
    organization_id: organizationId,
    items_added: itemsAdded,
    occurred_at: new Date().toISOString(),
  });
}

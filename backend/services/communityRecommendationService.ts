/**
 * Phase 4 — Community recommendation persistence + status transitions.
 *
 * Public surface:
 *   persistDiscoveryResult(orgId, result)  — idempotent upsert from discovery
 *   listRecommendations(orgId, options)
 *   getRecommendation(orgId, id)
 *   approveRecommendation(orgId, id, userId)
 *   rejectRecommendation(orgId, id, userId)
 *   dismissRecommendation(orgId, id, userId)
 *   activateRecommendation(orgId, id, userId) — creates a listening_source
 *
 * Status transitions are explicit and one-way (no reverse moves). Trying to
 * activate a 'rejected' recommendation is refused with a structured error.
 *
 * Activation does NOT enable listening capability or start a scan; it only
 * creates the listening_sources row in 'inactive' state. The user must
 * separately enable listening capability and trigger a Run Now.
 */

import { ownedDbTable } from '../db/writeOwner';
import { createListeningSource } from './listeningSourceService';
import { invalidateCapabilityAggregate } from './capabilityCacheService';
import type {
  CommunityRecommendation,
  RecommendationStatus,
} from '../types/communityRecommendation';
import type { DiscoveryResult, DiscoveryCandidate } from './communityDiscoveryService';

// State machine. One-way only — every transition leads forward. No
// "reactivate dismissed" path (the user can produce a fresh recommendation
// by re-running discovery if they change their mind).
const ALLOWED_TRANSITIONS: Record<RecommendationStatus, RecommendationStatus[]> = {
  suggested: ['approved', 'rejected', 'dismissed'],
  approved: ['activated', 'dismissed'],
  rejected: [],
  dismissed: [],
  activated: [],
};

export class RecommendationTransitionError extends Error {
  constructor(public readonly from: RecommendationStatus, public readonly to: RecommendationStatus, msg: string) {
    super(msg);
    this.name = 'RecommendationTransitionError';
  }
}

function assertTransition(from: RecommendationStatus, to: RecommendationStatus): void {
  if (!(ALLOWED_TRANSITIONS[from] ?? []).includes(to)) {
    throw new RecommendationTransitionError(from, to, `recommendation_transition_${from}_to_${to}_not_permitted`);
  }
}

// ---------------------------------------------------------------------------
// Persistence — bulk upsert from discovery
// ---------------------------------------------------------------------------

export type PersistDiscoveryArgs = {
  organizationId: string;
  candidates: DiscoveryCandidate[];
};

export type PersistDiscoveryResult = {
  inserted: number;
  unchanged: number;
  total: number;
  rows: CommunityRecommendation[];
};

/**
 * Idempotent. The UNIQUE constraint on (org, source_type, source_identifier)
 * means re-running discovery never duplicates rows; existing rows in any
 * status are left intact (so user-approved / dismissed state is preserved
 * across re-runs).
 */
export async function persistDiscoveryResult(
  args: PersistDiscoveryArgs,
): Promise<PersistDiscoveryResult> {
  if (args.candidates.length === 0) {
    return { inserted: 0, unchanged: 0, total: 0, rows: [] };
  }

  // Read existing rows so we can preserve their status without overwriting.
  const identifiers = args.candidates.map((c) => `${c.source_type}::${c.source_identifier}`);
  const { data: existingRows } = await ownedDbTable('community_recommendations')
    .select('*')
    .eq('organization_id', args.organizationId)
    .in('source_type', [...new Set(args.candidates.map((c) => c.source_type))]);
  const existingByKey = new Map<string, CommunityRecommendation>();
  for (const row of (existingRows ?? []) as CommunityRecommendation[]) {
    existingByKey.set(`${row.source_type}::${row.source_identifier}`, row);
  }

  const toInsert: Array<Record<string, unknown>> = [];
  const unchanged: CommunityRecommendation[] = [];

  for (const c of args.candidates) {
    const key = `${c.source_type}::${c.source_identifier}`;
    const existing = existingByKey.get(key);
    if (existing) {
      unchanged.push(existing);
      continue;
    }
    toInsert.push({
      organization_id: args.organizationId,
      source_type: c.source_type,
      source_identifier: c.source_identifier,
      display_name: c.display_name,
      recommendation_reason: c.recommendation_reason,
      recommendation_category: c.recommendation_category,
      confidence_score: c.confidence_score,
      estimated_signal_quality: c.estimated_signal_quality,
      estimated_volume: c.estimated_volume,
      estimated_cost: c.estimated_cost,
      strategic_relevance: c.strategic_relevance,
      related_keywords: c.related_keywords,
      related_competitors: c.related_competitors,
      recommendation_status: 'suggested',
      source_metadata: c.source_metadata,
    });
    void identifiers; // tsc: silence unused-list warning
  }

  let inserted: CommunityRecommendation[] = [];
  if (toInsert.length > 0) {
    const { data, error } = await ownedDbTable('community_recommendations')
      .insert(toInsert)
      .select('*');
    if (error) {
      throw new Error(`Failed to persist community recommendations: ${error.message}`);
    }
    inserted = (data ?? []) as CommunityRecommendation[];
  }

  return {
    inserted: inserted.length,
    unchanged: unchanged.length,
    total: inserted.length + unchanged.length,
    rows: [...inserted, ...unchanged].sort(
      (a, b) => b.strategic_relevance - a.strategic_relevance,
    ),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listRecommendations(
  organizationId: string,
  options?: { status?: RecommendationStatus; limit?: number },
): Promise<CommunityRecommendation[]> {
  let query = ownedDbTable('community_recommendations')
    .select('*')
    .eq('organization_id', organizationId)
    .order('strategic_relevance', { ascending: false })
    .limit(Math.min(200, Math.max(1, options?.limit ?? 100)));
  if (options?.status) query = query.eq('recommendation_status', options.status);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list recommendations: ${error.message}`);
  return (data as CommunityRecommendation[]) ?? [];
}

export async function getRecommendation(
  organizationId: string,
  id: string,
): Promise<CommunityRecommendation | null> {
  const { data, error } = await ownedDbTable('community_recommendations')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load recommendation: ${error.message}`);
  return (data as CommunityRecommendation | null) ?? null;
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

async function transition(
  organizationId: string,
  id: string,
  nextStatus: RecommendationStatus,
  patch: Record<string, unknown>,
): Promise<CommunityRecommendation> {
  const existing = await getRecommendation(organizationId, id);
  if (!existing) throw new Error(`recommendation_not_found:${id}`);
  assertTransition(existing.recommendation_status, nextStatus);
  const { data, error } = await ownedDbTable('community_recommendations')
    .update({ recommendation_status: nextStatus, ...patch })
    .eq('id', existing.id)
    .eq('organization_id', organizationId)
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`Failed to update recommendation: ${error?.message ?? 'unknown'}`);
  }
  return data as CommunityRecommendation;
}

export async function approveRecommendation(
  organizationId: string,
  id: string,
  userId: string | null,
): Promise<CommunityRecommendation> {
  const now = new Date().toISOString();
  return transition(organizationId, id, 'approved', { approved_by: userId, approved_at: now });
}

export async function rejectRecommendation(
  organizationId: string,
  id: string,
  userId: string | null,
): Promise<CommunityRecommendation> {
  const now = new Date().toISOString();
  return transition(organizationId, id, 'rejected', { rejected_at: now, approved_by: userId });
}

export async function dismissRecommendation(
  organizationId: string,
  id: string,
  userId: string | null,
): Promise<CommunityRecommendation> {
  const now = new Date().toISOString();
  return transition(organizationId, id, 'dismissed', { dismissed_at: now, approved_by: userId });
}

/**
 * Activate: creates a listening_sources row in 'inactive' state and links
 * back to the recommendation. Does NOT enable listening capability and does
 * NOT trigger a scan. Activation is a one-way transition (no reverse).
 */
export async function activateRecommendation(
  organizationId: string,
  id: string,
  userId: string | null,
): Promise<{ recommendation: CommunityRecommendation; listeningSourceId: string }> {
  const existing = await getRecommendation(organizationId, id);
  if (!existing) throw new Error(`recommendation_not_found:${id}`);
  assertTransition(existing.recommendation_status, 'activated');

  // Map the seed source_type to the listening_sources enum. Phase 4 only
  // emits known types so this is straightforward.
  type ListeningSourceType =
    | 'subreddit'
    | 'telegram_group'
    | 'discord_server'
    | 'github_repo'
    | 'keyword_stream'
    | 'competitor_domain'
    | 'rss_feed'
    | 'youtube_channel'
    | 'linkedin_topic'
    | 'x_list'
    | 'custom';
  const sourceType = existing.source_type as ListeningSourceType;

  const platformHint =
    (existing.source_metadata as { platform?: string })?.platform
    ?? (sourceType === 'subreddit' ? 'reddit' : null);

  const source = await createListeningSource({
    organizationId,
    sourceType,
    sourceIdentifier: existing.source_identifier,
    displayName: existing.display_name,
    monitoringModes: ['on_demand'],
    metadata: {
      platform: platformHint,
      keywords: existing.related_keywords,
      activated_from_recommendation_id: existing.id,
    },
    createdBy: userId,
  });

  const now = new Date().toISOString();
  const updated = await transition(organizationId, id, 'activated', {
    activated_at: now,
    activated_listening_source_id: source.id,
    approved_by: userId,
  });

  // Activation changes the org's set of sources — invalidate the capability
  // aggregate so the UI panels rehydrate with the new source.
  invalidateCapabilityAggregate(organizationId);

  return { recommendation: updated, listeningSourceId: source.id };
}

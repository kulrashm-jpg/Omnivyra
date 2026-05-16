/**
 * Phase 5 — Cross-source identity resolution.
 *
 * Identity links are CANDIDATE relationships. Nothing is irreversibly
 * merged. Every link carries:
 *   • a confidence_score (0–1)
 *   • an array of evidence_signals (which heuristics matched)
 *   • a link_status ∈ candidate | confirmed | rejected
 *
 * Heuristics:
 *   1. username_exact_match            — exact lowercased match
 *   2. username_normalised_match       — match after stripping common chars
 *   3. username_high_similarity        — Jaro-Winkler ≥ 0.92
 *   4. shared_referenced_domain        — Future enhancement: parse URLs
 *                                        from signal bodies. Not yet wired
 *                                        in Phase 5; placeholder support.
 *   5. shared_referenced_company       — Same competitor mentioned
 *   6. explicit_self_link              — Phase-6 work; placeholder.
 *   7. repeated_identifier             — Same content posted across platforms.
 *
 * The service only proposes candidates from the latest opportunity_feed_items
 * authored-by edges in the graph. It never invents handles.
 */

import { ownedDbTable } from '../db/writeOwner';
import type {
  AuthorIdentityLink,
  IdentityEvidenceSignal,
  IdentityLinkStatus,
} from '../types/authorIdentity';
import { canonicaliseHandle, orderIdentityPair } from '../types/authorIdentity';

// ---------------------------------------------------------------------------
// Similarity helpers
// ---------------------------------------------------------------------------

function jaroWinkler(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  const m = matchingChars(s1, s2);
  if (m === 0) return 0;
  const t = transpositions(s1, s2);
  const jaro = (m / s1.length + m / s2.length + (m - t) / m) / 3;
  // Winkler prefix bonus (max 4 chars)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++; else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

function matchingChars(s1: string, s2: string): number {
  const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s2Matched = new Array(s2.length).fill(false);
  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matched[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s2Matched[j] = true;
      matches++;
      break;
    }
  }
  return matches;
}

function transpositions(s1: string, s2: string): number {
  // Approximate transposition count via Levenshtein lower bound. Good enough
  // for the Phase 5 heuristic.
  let k = 0;
  for (let i = 0; i < Math.min(s1.length, s2.length); i++) {
    if (s1[i] !== s2[i]) k++;
  }
  return Math.floor(k / 2);
}

function normalise(handle: string): string {
  return canonicaliseHandle(handle).replace(/[^a-z0-9]/g, '');
}

// ---------------------------------------------------------------------------
// Candidate evaluation
// ---------------------------------------------------------------------------

export type IdentityCandidateInput = {
  platformA: string;
  handleA: string;
  platformB: string;
  handleB: string;
  /** Optional context that improves confidence — competitors / domains
      seen alongside this author on each platform. */
  sharedCompetitors?: string[];
  sharedDomains?: string[];
  repeatedContentHash?: string | null;
};

export type IdentityCandidate = {
  confidence_score: number;
  evidence_signals: IdentityEvidenceSignal[];
  rationale: string;
};

export function evaluateIdentityCandidate(input: IdentityCandidateInput): IdentityCandidate {
  if (input.platformA.toLowerCase() === input.platformB.toLowerCase()) {
    return { confidence_score: 0, evidence_signals: [], rationale: 'same_platform' };
  }
  const evidence: IdentityEvidenceSignal[] = [];
  const reasons: string[] = [];

  const lowerA = canonicaliseHandle(input.handleA);
  const lowerB = canonicaliseHandle(input.handleB);
  const normA = normalise(lowerA);
  const normB = normalise(lowerB);

  if (lowerA && lowerA === lowerB) {
    evidence.push('username_exact_match');
    reasons.push('handles are identical');
  } else if (normA && normA === normB) {
    evidence.push('username_normalised_match');
    reasons.push('handles match after removing separators');
  } else {
    const jw = jaroWinkler(normA, normB);
    if (jw >= 0.92 && normA.length >= 4 && normB.length >= 4) {
      evidence.push('username_high_similarity');
      reasons.push(`Jaro-Winkler ${jw.toFixed(2)}`);
    }
  }

  if ((input.sharedCompetitors ?? []).length > 0) {
    evidence.push('shared_referenced_company');
    reasons.push(`shared competitors: ${input.sharedCompetitors!.slice(0, 3).join(', ')}`);
  }
  if ((input.sharedDomains ?? []).length > 0) {
    evidence.push('shared_referenced_domain');
    reasons.push(`shared domains: ${input.sharedDomains!.slice(0, 3).join(', ')}`);
  }
  if (input.repeatedContentHash) {
    evidence.push('repeated_identifier');
    reasons.push(`identical content hash observed: ${input.repeatedContentHash.slice(0, 12)}`);
  }

  if (evidence.length === 0) {
    return { confidence_score: 0, evidence_signals: [], rationale: 'no_evidence' };
  }

  // Score = sum of evidence weights, capped at 1. We want exact match to
  // strongly bias to a confirmation prompt; weak similarity should never
  // alone confirm.
  const weights: Record<IdentityEvidenceSignal, number> = {
    username_exact_match: 0.6,
    username_normalised_match: 0.45,
    username_high_similarity: 0.3,
    shared_referenced_domain: 0.25,
    shared_referenced_company: 0.2,
    explicit_self_link: 0.6,
    repeated_identifier: 0.35,
  };
  const total = evidence.reduce((sum, e) => sum + (weights[e] ?? 0), 0);
  const score = Math.min(1, total);
  return {
    confidence_score: Number(score.toFixed(3)),
    evidence_signals: evidence,
    rationale: reasons.join('; '),
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export type PersistCandidateInput = IdentityCandidateInput & {
  organizationId: string;
};

export async function persistIdentityCandidate(
  input: PersistCandidateInput,
): Promise<AuthorIdentityLink | null> {
  const decision = evaluateIdentityCandidate(input);
  if (decision.confidence_score < 0.3) return null; // ignore weak matches

  const ordered = orderIdentityPair({
    platformA: input.platformA,
    handleA: input.handleA,
    platformB: input.platformB,
    handleB: input.handleB,
  });

  const { data: existing } = await ownedDbTable('author_identity_links')
    .select('*')
    .eq('organization_id', input.organizationId)
    .eq('primary_platform', ordered.primary_platform)
    .eq('primary_handle', ordered.primary_handle)
    .eq('secondary_platform', ordered.secondary_platform)
    .eq('secondary_handle', ordered.secondary_handle)
    .maybeSingle();

  if (existing) {
    const row = existing as AuthorIdentityLink;
    // Reject-state is sticky; do not overwrite.
    if (row.link_status === 'rejected') return row;
    // Confidence can only INCREASE on observation. Evidence is union.
    const mergedEvidence = Array.from(new Set([...row.evidence_signals, ...decision.evidence_signals])) as IdentityEvidenceSignal[];
    const newConfidence = Math.max(row.confidence_score, decision.confidence_score);
    if (newConfidence === row.confidence_score && mergedEvidence.length === row.evidence_signals.length) {
      return row;
    }
    const { data, error } = await ownedDbTable('author_identity_links')
      .update({
        confidence_score: newConfidence,
        evidence_signals: mergedEvidence,
        metadata: { ...row.metadata, rationale: decision.rationale, last_seen_at: new Date().toISOString() },
      })
      .eq('id', row.id)
      .select('*')
      .single();
    if (error || !data) throw new Error(`identity_link_update_failed:${error?.message ?? 'unknown'}`);
    return data as AuthorIdentityLink;
  }

  const { data, error } = await ownedDbTable('author_identity_links')
    .insert({
      organization_id: input.organizationId,
      ...ordered,
      confidence_score: decision.confidence_score,
      evidence_signals: decision.evidence_signals,
      link_status: 'candidate' as IdentityLinkStatus,
      metadata: { rationale: decision.rationale },
    })
    .select('*')
    .single();
  if (error || !data) {
    if (error?.code === '23505') {
      const { data: raced } = await ownedDbTable('author_identity_links')
        .select('*')
        .eq('organization_id', input.organizationId)
        .eq('primary_platform', ordered.primary_platform)
        .eq('primary_handle', ordered.primary_handle)
        .eq('secondary_platform', ordered.secondary_platform)
        .eq('secondary_handle', ordered.secondary_handle)
        .maybeSingle();
      return (raced as AuthorIdentityLink | null) ?? null;
    }
    throw new Error(`identity_link_insert_failed:${error?.message ?? 'unknown'}`);
  }
  return data as AuthorIdentityLink;
}

export async function listIdentityLinks(
  organizationId: string,
  options?: { status?: IdentityLinkStatus; minConfidence?: number; limit?: number },
): Promise<AuthorIdentityLink[]> {
  let q = ownedDbTable('author_identity_links')
    .select('*')
    .eq('organization_id', organizationId)
    .order('confidence_score', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 200)));
  if (options?.status) q = q.eq('link_status', options.status);
  if (typeof options?.minConfidence === 'number') q = q.gte('confidence_score', options.minConfidence);
  const { data, error } = await q;
  if (error) throw new Error(`identity_link_list_failed:${error.message}`);
  return (data as AuthorIdentityLink[]) ?? [];
}

export async function confirmIdentityLink(
  organizationId: string,
  id: string,
  userId: string | null,
): Promise<AuthorIdentityLink | null> {
  const { data, error } = await ownedDbTable('author_identity_links')
    .update({
      link_status: 'confirmed' as IdentityLinkStatus,
      confirmed_by: userId,
      confirmed_at: new Date().toISOString(),
      rejected_at: null,
    })
    .eq('organization_id', organizationId)
    .eq('id', id)
    .neq('link_status', 'rejected')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`identity_link_confirm_failed:${error.message}`);
  return (data as AuthorIdentityLink | null) ?? null;
}

export async function rejectIdentityLink(
  organizationId: string,
  id: string,
  userId: string | null,
): Promise<AuthorIdentityLink | null> {
  const { data, error } = await ownedDbTable('author_identity_links')
    .update({
      link_status: 'rejected' as IdentityLinkStatus,
      confirmed_by: userId,
      rejected_at: new Date().toISOString(),
      confirmed_at: null,
    })
    .eq('organization_id', organizationId)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`identity_link_reject_failed:${error.message}`);
  return (data as AuthorIdentityLink | null) ?? null;
}

/**
 * Reversal: a confirmed link can be re-opened to candidate. Rejection is
 * also reversible by the same path. Phase 5 makes the entire relationship
 * graph fully reversible — no destructive merges.
 */
export async function reopenIdentityLink(
  organizationId: string,
  id: string,
): Promise<AuthorIdentityLink | null> {
  const { data, error } = await ownedDbTable('author_identity_links')
    .update({
      link_status: 'candidate' as IdentityLinkStatus,
      confirmed_at: null,
      rejected_at: null,
    })
    .eq('organization_id', organizationId)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`identity_link_reopen_failed:${error.message}`);
  return (data as AuthorIdentityLink | null) ?? null;
}

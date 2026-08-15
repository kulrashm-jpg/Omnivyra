/**
 * LI-4C — deterministic person duplicate detection and parking.
 *
 * The LI-4A audit found that a duplicate prospect silently disappears into an
 * existing `unified_persons` row. This module surfaces it instead: it detects
 * duplicates using ONLY exact identifier equality, parks them for the tenant to
 * review, and never acts on them.
 *
 * ─── IT DOES NOT MERGE ────────────────────────────────────────────────────
 * There is no merge executor here or anywhere else in this phase. ADR D-4
 * requires governance to survive a merge, which requires a governance lookup
 * that follows the merge chain, which does not exist yet. Until it does,
 * merging could silently reduce suppression coverage — so nothing merges. The
 * schema supports it; no code performs it.
 *
 * ─── DETERMINISTIC ONLY ───────────────────────────────────────────────────
 * Email, phone and provider identifiers, compared as exact normalised equality.
 * No fuzzy matching, no name similarity, no scoring, no threshold, no model.
 * A rule either matches exactly or it does not — anything else produces merge
 * decisions a tenant cannot defend, and makes silent merging tempting.
 *
 * ─── IT DOES NOT RESOLVE IDENTITY ─────────────────────────────────────────
 * `identityResolutionService.resolveUnifiedPerson` remains the sole
 * resolve-or-create path. This module reads people; it never creates, matches
 * for resolution purposes, or writes to `unified_persons`.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { normalizeEmail, normalizePhone } from '../identityResolutionService';

/** ADR §3. Deterministic classes; there is deliberately no score. */
export const DUPLICATE_CLASSIFICATIONS = ['definite', 'probable', 'possible'] as const;
export type DuplicateClassification = typeof DUPLICATE_CLASSIFICATIONS[number];

/** Which deterministic signal fired. Mirrors the DB CHECK vocabulary. */
export const MATCH_SIGNALS = ['email', 'phone', 'external_key', 'name_account', 'title_account'] as const;
export type MatchSignal = typeof MATCH_SIGNALS[number];

export const CANDIDATE_STATUSES = ['open', 'merged', 'retained', 'dismissed', 'deleted'] as const;
export type CandidateStatus = typeof CANDIDATE_STATUSES[number];

/** Person lifecycle — ADR §2, mirroring prospect_accounts. */
export const PERSON_STATUSES = ['active', 'merged', 'suppressed', 'archived'] as const;
export type PersonStatus = typeof PERSON_STATUSES[number];

export interface DuplicateSignals {
  organizationId: string;
  /** The person the arriving evidence was resolved onto. */
  personId: string;
  email?: string | null;
  phone?: string | null;
  /** Provider identifiers, shaped like `unified_persons.external_keys`. */
  externalKeys?: Record<string, unknown> | null;
  /** The LI-2 evidence that raised this, when it came from ingestion. */
  sourceRecordId?: string | null;
}

export interface DetectedDuplicate {
  candidatePersonId: string;
  classification: DuplicateClassification;
  matchedOn: MatchSignal;
}

export interface ParkResult {
  detected: DetectedDuplicate[];
  parked: number;
  alreadyOpen: number;
}

type Row = Record<string, unknown>;

const errCode = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;

/**
 * ADR §3 classification. Email and phone are DEFINITE because the tenant-scoped
 * unique indexes make a collision on them unambiguous. A shared provider
 * identifier is PROBABLE: two providers can key the same record differently, and
 * a provider id is an assertion rather than a contact fact.
 */
const CLASSIFICATION_BY_SIGNAL: Record<'email' | 'phone' | 'external_key', DuplicateClassification> = {
  email: 'definite',
  phone: 'definite',
  external_key: 'probable',
};

/**
 * Find OTHER live people in the same tenant that the arriving identifiers point
 * at. This is the disjoint-identifier split from ADR §4: evidence asserting both
 * an email and a phone can name two different existing persons, and neither the
 * resolver nor the unique indexes will notice.
 *
 * Reads only. Never writes to `unified_persons`.
 */
export async function detectPersonDuplicates(signals: DuplicateSignals): Promise<DetectedDuplicate[]> {
  const { organizationId, personId } = signals;
  if (!organizationId?.trim()) {
    throw new Error('detectPersonDuplicates: organizationId is required — identity is never resolved tenant-less');
  }
  if (!personId?.trim()) {
    throw new Error('detectPersonDuplicates: personId is required');
  }

  const email = normalizeEmail(signals.email);
  const phone = normalizePhone(signals.phone);

  const found = new Map<string, DetectedDuplicate>();

  const consider = (rows: Row[], matchedOn: 'email' | 'phone' | 'external_key') => {
    for (const r of rows) {
      const id = typeof r.id === 'string' ? r.id : null;
      if (!id || id === personId) continue;               // itself is not a duplicate
      // Defence in depth: the query already filters by tenant, but another
      // tenant's person must never become a candidate even if a future query
      // change slipped. D-1 is not negotiable.
      if (r.company_id !== organizationId) continue;
      // A stronger signal wins: definite must not be downgraded by a later
      // probable match on the same pair.
      const existing = found.get(id);
      const classification = CLASSIFICATION_BY_SIGNAL[matchedOn];
      if (existing && existing.classification === 'definite') continue;
      found.set(id, { candidatePersonId: id, classification, matchedOn });
    }
  };

  // Only LIVE people can be duplicates. A merged or archived person is already
  // resolved and must not be re-raised.
  const live = () => ownedDbTable('unified_persons')
    .select('id, company_id, primary_email, primary_phone, external_keys')
    .eq('company_id', organizationId)                     // TENANT FIRST, always
    .eq('status', 'active');

  if (email) {
    const res = await live().eq('primary_email', email);
    if (res.error) throw new Error(`detectPersonDuplicates: email probe failed: ${res.error.message}`);
    consider((res.data ?? []) as Row[], 'email');
  }

  if (phone) {
    const res = await live().eq('primary_phone', phone);
    if (res.error) throw new Error(`detectPersonDuplicates: phone probe failed: ${res.error.message}`);
    consider((res.data ?? []) as Row[], 'phone');
  }

  // Provider identifiers, compared as exact (provider, key) pairs. `contains`
  // is an equality test on the jsonb subtree, not a similarity test.
  const keys = signals.externalKeys && typeof signals.externalKeys === 'object' ? signals.externalKeys : null;
  if (keys) {
    for (const [provider, value] of Object.entries(keys)) {
      if (!value || typeof value !== 'object') continue;
      const res = await live().contains('external_keys', { [provider]: value });
      if (res.error) throw new Error(`detectPersonDuplicates: external key probe failed: ${res.error.message}`);
      consider((res.data ?? []) as Row[], 'external_key');
    }
  }

  return [...found.values()];
}

/**
 * Park a detected duplicate for tenant review.
 *
 * Idempotency is by DATABASE CONSTRAINT: the open-pair index is PARTIAL
 * (`WHERE status='open' AND candidate_person_id IS NOT NULL`), so PostgREST
 * cannot infer it and `ON CONFLICT` answers 42P10 — the trap W0.1, W0.2 and W3
 * each hit. Insert, catch 23505, treat it as already open. Never
 * SELECT-then-INSERT: that is a race, not an idempotency mechanism.
 */
export async function parkDuplicateCandidate(input: {
  organizationId: string;
  personId: string;
  candidatePersonId: string;
  classification: DuplicateClassification;
  matchedOn: MatchSignal;
  sourceRecordId?: string | null;
}): Promise<{ parked: boolean }> {
  if (!input.organizationId?.trim()) {
    throw new Error('parkDuplicateCandidate: organizationId is required');
  }
  if (input.personId === input.candidatePersonId) {
    throw new Error('parkDuplicateCandidate: a person cannot be its own duplicate');
  }

  const res = await ownedDbTable('person_duplicate_candidates').insert({
    organization_id: input.organizationId,
    person_id: input.personId,
    candidate_person_id: input.candidatePersonId,
    classification: input.classification,
    matched_on: input.matchedOn,
    source_record_id: input.sourceRecordId ?? null,
    status: 'open',
  }).select('id').single();

  if (!res.error) return { parked: true };

  // 23505 — this pair is already open. The duplicate is already surfaced, so
  // re-raising it would only add noise to the tenant's queue.
  if (errCode(res.error) === '23505') return { parked: false };

  // A cross-tenant reference is refused by the composite FK. Say so plainly
  // rather than surfacing a raw constraint message.
  if (errCode(res.error) === '23503') {
    throw new Error('parkDuplicateCandidate: person or source record does not belong to this tenant — cross-tenant candidates are refused by the database');
  }

  throw new Error(`parkDuplicateCandidate: insert failed (${errCode(res.error)}): ${res.error.message}`);
}

/**
 * Detect and park in one step — the shape an ingestion adapter will call.
 *
 * Detection failure is reported, not swallowed: a duplicate we failed to detect
 * is a duplicate that silently disappears, which is the exact defect LI-4C
 * exists to remove.
 */
export async function detectAndParkDuplicates(signals: DuplicateSignals): Promise<ParkResult> {
  const detected = await detectPersonDuplicates(signals);
  let parked = 0;
  let alreadyOpen = 0;

  for (const d of detected) {
    const res = await parkDuplicateCandidate({
      organizationId: signals.organizationId,
      personId: signals.personId,
      candidatePersonId: d.candidatePersonId,
      classification: d.classification,
      matchedOn: d.matchedOn,
      sourceRecordId: signals.sourceRecordId ?? null,
    });
    if (res.parked) parked += 1;
    else alreadyOpen += 1;
  }

  return { detected, parked, alreadyOpen };
}

/**
 * Resolve a candidate with the mandatory reason (ADR §6).
 *
 * DELIBERATELY CANNOT MERGE. `'merged'` is absent from the accepted statuses
 * because recording a merge without performing one would make the queue lie,
 * and performing one is forbidden until governance can follow a merge chain.
 * The tenant may retain, dismiss or delete today; merge arrives with the
 * governance work.
 */
export async function resolveDuplicateCandidate(input: {
  organizationId: string;
  candidateId: string;
  status: 'retained' | 'dismissed' | 'deleted';
  reason: string;
  resolvedBy?: string | null;
  resolvedAt?: string;
}): Promise<{ resolved: boolean }> {
  if (!input.organizationId?.trim()) {
    throw new Error('resolveDuplicateCandidate: organizationId is required');
  }
  if (!input.reason?.trim()) {
    throw new Error('resolveDuplicateCandidate: a resolution without a reason is an unusable audit record');
  }
  if (!['retained', 'dismissed', 'deleted'].includes(input.status)) {
    throw new Error(`resolveDuplicateCandidate: '${input.status}' is not resolvable here — merge is disabled until governance can follow a merge chain`);
  }

  const res = await ownedDbTable('person_duplicate_candidates')
    .update({
      status: input.status,
      resolution_reason: input.reason,
      resolved_by: input.resolvedBy ?? null,
      resolved_at: input.resolvedAt ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', input.organizationId)   // TENANT FIRST — never another tenant's queue
    .eq('id', input.candidateId)
    .eq('status', 'open')                          // an already-resolved decision is never rewritten
    .select('id');

  if (res.error) {
    throw new Error(`resolveDuplicateCandidate: update failed (${errCode(res.error)}): ${res.error.message}`);
  }
  return { resolved: ((res.data ?? []) as unknown[]).length > 0 };
}

/** The tenant's open review queue. Read-only, tenant-scoped. */
export async function listOpenDuplicateCandidates(
  organizationId: string,
  limit = 100,
): Promise<Row[]> {
  if (!organizationId?.trim()) {
    throw new Error('listOpenDuplicateCandidates: organizationId is required');
  }
  const res = await ownedDbTable('person_duplicate_candidates')
    .select('id, person_id, candidate_person_id, classification, matched_on, source_record_id, created_at')
    .eq('organization_id', organizationId)         // TENANT FIRST, always
    .eq('status', 'open')
    .limit(limit);

  if (res.error) {
    throw new Error(`listOpenDuplicateCandidates: read failed (${errCode(res.error)}): ${res.error.message}`);
  }
  return (res.data ?? []) as Row[];
}

/**
 * CPG-001 — user confirmation & correction state machine (§6, §7, §12).
 *
 * This is the ONLY code path that may move a field's effective value off the
 * user's own claim, and it runs exclusively in response to an explicit user
 * decision. There is no automatic transition, no "resolve on next crawl", and
 * no override flag.
 *
 * HISTORY IS APPEND-ONLY. Every transition pushes an entry and NOTHING is ever
 * removed: not the original user claim, not the public claim the user rejected,
 * not the source that was marked stale. `PUBLIC_SOURCE_STALE →
 * USER_CONFIRMED_CORRECTION` is a recorded state transition, not a deletion —
 * so a reviewer can always reconstruct what Omnivyra believed, when, and why.
 *
 * Pure and deterministic: `asOf` and `actor` are injected. No clock, no I/O.
 */

import type { EvidenceClaim, GroundedField, GroundingHistoryEntry } from './types';

export type UserDecision =
  | { kind: 'confirm_own' }
  | { kind: 'accept_public'; evidenceId: string }
  | { kind: 'correct'; newValue: string; normalizedValue: string }
  | { kind: 'mark_source_stale'; evidenceId: string; reason: string }
  | { kind: 'supply_source'; evidence: EvidenceClaim }
  | { kind: 'defer' };

export interface ApplyDecisionInput {
  grounded: GroundedField;
  decision: UserDecision;
  actor: string;
  asOf: string;
}

export class DecisionError extends Error {
  constructor(message: string) { super(message); this.name = 'DecisionError'; }
}

function append(g: GroundedField, entry: GroundingHistoryEntry): GroundingHistoryEntry[] {
  return [...g.history, entry];
}

/**
 * Apply a user decision. Returns a NEW GroundedField; the input is never
 * mutated, so a caller cannot lose the prior state by accident.
 */
/**
 * CPG-008 — after a decision that sets an effective value, the adjudication
 * must say so; otherwise a stored field would read "CONFLICTING / no winner"
 * next to a value the user chose. Deferral leaves the review pending.
 */
export function applyUserDecision(input: ApplyDecisionInput): GroundedField {
  const r = applyUserDecisionInner(input);
  if (!r.adjudication || input.decision.kind === 'defer' || r.effectiveValue === null) return r;
  return {
    ...r,
    adjudication: {
      ...r.adjudication,
      evidenceState: 'EFFECTIVE',
      outcome: 'USER_DECISION',
      requiresReview: false,
      reason: `effective value set by the user's decision (${input.decision.kind})`,
    },
  };
}

function applyUserDecisionInner(input: ApplyDecisionInput): GroundedField {
  const { grounded: g, decision, actor, asOf } = input;
  const base = { ...g, evidence: [...g.evidence], conflictingEvidence: [...g.conflictingEvidence] };

  switch (decision.kind) {
    case 'confirm_own': {
      return {
        ...base,
        // Effective value unchanged — it was already the user's.
        effectiveValue: g.userClaim?.value ?? g.effectiveValue,
        effectiveValueSource: 'user',
        status: 'CONFLICTING', // the disagreement is real and stays on record
        isMaterialConflict: false, // but it is resolved: no further prompting
        confirmationStatus: 'USER_CONFIRMED_OWN_VALUE',
        history: append(g, {
          at: asOf, actor, action: 'user_confirmed_own',
          fromValue: g.effectiveValue, toValue: g.userClaim?.value ?? null,
          note: 'User reviewed the public evidence and retained their own value. Public evidence retained for audit.',
          evidenceIds: g.conflictingEvidence.map((e) => e.claimId),
        }),
      };
    }

    case 'accept_public': {
      const chosen = g.conflictingEvidence.find((e) => e.claimId === decision.evidenceId)
        ?? g.evidence.find((e) => e.claimId === decision.evidenceId);
      if (!chosen) throw new DecisionError(`unknown evidence id: ${decision.evidenceId}`);
      return {
        ...base,
        effectiveValue: chosen.value,
        effectiveValueSource: 'public_evidence',
        status: 'PUBLICLY_REPORTED',
        isMaterialConflict: false,
        confirmationStatus: 'USER_ACCEPTED_PUBLIC_VALUE',
        // The user's original claim is PRESERVED on the record.
        history: append(g, {
          at: asOf, actor, action: 'user_accepted_public',
          fromValue: g.userClaim?.value ?? g.effectiveValue, toValue: chosen.value,
          note: `User accepted public evidence from ${chosen.sourceName}. Original user claim retained in userClaim.`,
          evidenceIds: [chosen.claimId],
        }),
      };
    }

    case 'correct': {
      if (!decision.newValue.trim()) throw new DecisionError('correction value must not be empty');
      return {
        ...base,
        effectiveValue: decision.newValue,
        effectiveValueSource: 'user_correction',
        status: 'USER_PROVIDED',
        isMaterialConflict: false,
        confirmationStatus: 'USER_CONFIRMED_CORRECTION',
        userClaim: {
          field: g.field, value: decision.newValue, normalizedValue: decision.normalizedValue,
          assertedAt: asOf, assertedBy: actor,
        },
        history: append(g, {
          at: asOf, actor, action: 'user_corrected',
          fromValue: g.effectiveValue, toValue: decision.newValue,
          note: 'User supplied a corrected value. Prior user claim and all public evidence retained.',
          evidenceIds: g.conflictingEvidence.map((e) => e.claimId),
        }),
      };
    }

    case 'mark_source_stale': {
      const target = g.conflictingEvidence.find((e) => e.claimId === decision.evidenceId)
        ?? g.evidence.find((e) => e.claimId === decision.evidenceId);
      if (!target) throw new DecisionError(`unknown evidence id: ${decision.evidenceId}`);
      return {
        ...base,
        // The stale source does NOT change the effective value, and is NOT deleted.
        effectiveValue: g.userClaim?.value ?? g.effectiveValue,
        effectiveValueSource: g.userClaim ? 'user' : g.effectiveValueSource,
        freshness: 'stale',
        isMaterialConflict: false,
        confirmationStatus: 'PUBLIC_SOURCE_MARKED_STALE',
        history: append(g, {
          at: asOf, actor, action: 'user_marked_source_stale',
          fromValue: target.value, toValue: g.userClaim?.value ?? g.effectiveValue,
          note: `User marked ${target.sourceName} as out of date: ${decision.reason}. Source retained for audit.`,
          evidenceIds: [target.claimId],
        }),
      };
    }

    case 'supply_source': {
      const e = decision.evidence;
      if (!e.sourceUrl) throw new DecisionError('a user-supplied source must include a source URL');
      return {
        ...base,
        evidence: [...base.evidence, e],
        isMaterialConflict: false,
        confirmationStatus: 'USER_SUPPLIED_ALTERNATIVE_SOURCE',
        history: append(g, {
          at: asOf, actor, action: 'user_supplied_source',
          fromValue: g.effectiveValue, toValue: e.value,
          note: `User supplied an alternative source: ${e.sourceUrl}`,
          evidenceIds: [e.claimId],
        }),
      };
    }

    case 'defer': {
      return {
        ...base,
        // Deferral changes NOTHING except that we stop asking for now.
        confirmationStatus: 'DEFERRED',
        history: append(g, {
          at: asOf, actor, action: 'user_deferred',
          fromValue: g.effectiveValue, toValue: g.effectiveValue,
          note: 'User deferred resolution. Conflict remains open and evidence retained.',
          evidenceIds: g.conflictingEvidence.map((e) => e.claimId),
        }),
      };
    }
  }
}

/**
 * §11 — the traceability chain for one field, as the UI would render it.
 * Every externally grounded value resolves to an inspectable source URL.
 */
export interface TraceabilityRow {
  field: string;
  currentValue: string | null;
  evidenceStatus: GroundedField['status'];
  confidence: number;
  confidenceBand: GroundedField['confidence']['band'];
  confidenceMeaning: string;
  sources: { name: string; url: string | null; accessedAt: string; publishedAt: string | null }[];
  conflictingSources: { name: string; url: string | null; value: string }[];
  entityMatch: string;
  freshness: string;
  confirmation: GroundedField['confirmationStatus'];
  action: 'Confirm' | 'Review' | '—';
  historyCount: number;
}

export function toTraceabilityRow(g: GroundedField): TraceabilityRow {
  const action: TraceabilityRow['action'] =
    g.isMaterialConflict ? 'Confirm'
    : (g.status === 'SYNTHESIZED' || g.confidence.band === 'NEEDS_REVIEW' || g.confidence.band === 'UNVERIFIED') ? 'Review'
    : '—';

  return {
    field: g.field,
    currentValue: g.effectiveValue,
    evidenceStatus: g.status,
    confidence: g.confidence.score,
    confidenceBand: g.confidence.band,
    confidenceMeaning: g.confidence.meaning,
    sources: g.evidence
      .filter((e) => e.sourceType !== 'omnivyra_synthesis')
      .map((e) => ({ name: e.sourceName, url: e.sourceUrl, accessedAt: e.sourceAccessedAt, publishedAt: e.sourcePublishedAt })),
    conflictingSources: g.conflictingEvidence.map((e) => ({ name: e.sourceName, url: e.sourceUrl, value: e.value })),
    entityMatch: g.entityMatch.status,
    freshness: g.freshness,
    confirmation: g.confirmationStatus,
    action,
    historyCount: g.history.length,
  };
}

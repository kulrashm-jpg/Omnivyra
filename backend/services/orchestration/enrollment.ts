/**
 * Individual enrollment eligibility — who may enter a workflow, under the version
 * they would be enrolled in.
 *
 * The enrollment route asks this BEFORE recording an Execution Instance. The
 * conditions are the CURRENT published version's `enrollment.conditions`; the
 * facts are the person's, from canonical sources (individualIntelligence.ts).
 * Unknown facts fail closed: a person we cannot assess is not enrolled.
 *
 * It decides eligibility only. It never creates the instance (the store does, and
 * its partial unique index stays the authority on duplicates), never contacts
 * anyone, and never weakens a gate: an eligible person still meets every
 * engine-side check at each step.
 */

import { getCurrentWorkflowVersion } from '../workflows/workflowStore';
import { evaluateConditions, isProspectClosedToJourneys } from './journeyPolicy';
import { loadIndividualFacts, PROSPECT_STATE_UNREADABLE_GAP, type IndividualIntelligencePort } from './individualIntelligence';
import type { SubjectRef } from '../executionSubject/subjectRef';

export interface EnrollmentVerdict {
  readonly eligible: boolean;
  /** The version the person was assessed against, or null when none is published. */
  readonly assessedVersionId: string | null;
  /** Codes and condition descriptions only — never a value about the person. */
  readonly reasons: readonly string[];
}

export async function checkEnrollmentEligibility(input: {
  organizationId: string;
  workflowId: string;
  subject: SubjectRef;
  now?: string;
  intelligence?: IndividualIntelligencePort;
}): Promise<EnrollmentVerdict> {
  const version = await getCurrentWorkflowVersion(input.organizationId, input.workflowId);
  if (version === null) {
    // The store refuses this too (`no_published_version`); answered here so the
    // caller gets one consistent reason rather than an eligibility claim.
    return { eligible: false, assessedVersionId: null, reasons: ['no_published_version'] };
  }
  const conditions = version.definition.enrollment?.conditions ?? [];
  // A prospect is always assessed: PI's lifecycle verdict applies with or without
  // authored conditions.
  if (conditions.length === 0 && input.subject.kind !== 'prospect') {
    return { eligible: true, assessedVersionId: version.id, reasons: [] };
  }

  const now = input.now ?? new Date().toISOString();
  const facts = await loadIndividualFacts(input.organizationId, input.subject, now, input.intelligence);
  if (isProspectClosedToJourneys(facts.facts)) {
    return { eligible: false, assessedVersionId: version.id, reasons: ['prospect_lifecycle_closed'] };
  }
  if (facts.gaps.includes(PROSPECT_STATE_UNREADABLE_GAP)) {
    return { eligible: false, assessedVersionId: version.id, reasons: [`gap: ${PROSPECT_STATE_UNREADABLE_GAP}`] };
  }
  const verdict = evaluateConditions(conditions, facts.facts);
  return {
    eligible: verdict.holds,
    assessedVersionId: version.id,
    reasons: verdict.holds ? [] : [...verdict.unmet, ...facts.gaps.map((g) => `gap: ${g}`)],
  };
}

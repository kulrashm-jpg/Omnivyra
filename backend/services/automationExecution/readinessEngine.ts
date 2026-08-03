/**
 * INT-001 Phase 5 — Automation Readiness. Deterministic status resolution
 * with explicit precedence: BLOCKED → INSUFFICIENT_DATA → MANUAL_REVIEW →
 * WAITING → READY. Reasons always explain the verdict.
 */

import type { AutomationInput, ReadinessAssessment, HumanReviewAssessment } from './types';
import { READINESS_THRESHOLDS } from './automationConfig';

export function assessReadiness(
  input: AutomationInput,
  review: HumanReviewAssessment,
): ReadinessAssessment {
  const { summary } = input;
  const context = input.context ?? {};

  // 1) Hard stops.
  if (context.doNotContact === true) {
    return { status: 'blocked', reasons: ['Contact is on a do-not-contact/suppression list.'] };
  }
  if (context.consentGranted === false) {
    return { status: 'blocked', reasons: ['Outreach consent was not granted at capture.'] };
  }

  // 2) Not enough signal to plan against.
  const insufficient: string[] = [];
  if (summary.confidence < READINESS_THRESHOLDS.insufficientConfidence) {
    insufficient.push(`Intelligence confidence ${summary.confidence} is below the ${READINESS_THRESHOLDS.insufficientConfidence} minimum.`);
  }
  if (summary.persona.persona === 'Unknown' && summary.intent.band === 'none') {
    insufficient.push('Neither persona nor intent could be established.');
  }
  if (context.hasEmail === false && context.hasPhone === false && context.linkedinProfileKnown === false) {
    insufficient.push('No contact medium is available.');
  }
  if (insufficient.length > 0) {
    return { status: 'insufficient_data', reasons: insufficient };
  }

  // 3) Human gate.
  if (review.reviewRequired) {
    return { status: 'manual_review', reasons: review.reasons };
  }

  // 4) Cold leads wait for more signal rather than being automated at.
  if (summary.qualification.band === 'cold') {
    return {
      status: 'waiting',
      reasons: [`Qualification band is cold (${summary.qualification.totalScore}/100) — hold for additional signals before outreach.`],
    };
  }

  return {
    status: 'ready',
    reasons: [`Qualification ${summary.qualification.band} (${summary.qualification.totalScore}/100) with confidence ${summary.confidence} — automation can proceed.`],
  };
}

/**
 * INT-001 Phase 5 — Human Review Engine. Decides when automation must NOT run
 * unattended, with explicit reasons and the exact missing information.
 */

import type { AutomationInput, HumanReviewAssessment } from './types';
import { READINESS_THRESHOLDS, RESTRICTED_REGIONS } from './automationConfig';

export function assessHumanReview(input: AutomationInput): HumanReviewAssessment {
  const { summary } = input;
  const context = input.context ?? {};
  const reasons: string[] = [];
  const missing: string[] = [];

  if (summary.confidence < READINESS_THRESHOLDS.reviewConfidence) {
    reasons.push(`Low intelligence confidence (${summary.confidence}) — below the ${READINESS_THRESHOLDS.reviewConfidence} automation floor.`);
  }
  if (context.hasEmail === false && context.hasPhone === false && context.linkedinProfileKnown === false) {
    reasons.push('No reachable contact medium.');
  }
  if (context.hasEmail === false) missing.push('email address');
  if (context.hasPhone === false) missing.push('phone number');
  if (context.linkedinProfileKnown === false) missing.push('linkedin profile');
  if (context.consentGranted === false) {
    reasons.push('Legal restriction: consent not granted for outreach.');
  }
  if (context.doNotContact === true) {
    reasons.push('Legal restriction: contact is suppressed (do-not-contact).');
  }
  if (context.region && RESTRICTED_REGIONS.has(String(context.region).toUpperCase())) {
    reasons.push(`Region ${String(context.region).toUpperCase()} has outbound-automation restrictions — human review required.`);
  }

  // Conflicting signals — deterministic contradiction checks.
  if (summary.intent.band === 'high' && summary.behavioralFit.score === 0) {
    reasons.push('Conflicting signals: high intent with zero captured behaviour.');
  }
  if ((summary.persona.persona === 'Student' || summary.persona.persona === 'Recruiter') && summary.qualification.band === 'hot') {
    reasons.push(`Conflicting signals: ${summary.persona.persona} persona scored hot — verify identity before outreach.`);
  }
  if (summary.urgency.score >= 60 && summary.intent.band === 'none') {
    reasons.push('Conflicting signals: strong urgency with no recorded intent.');
  }

  // Missing enrichment — thin firmographics on a commercially relevant lead.
  if (summary.companyFit.confidence < 0.3 && summary.qualification.band !== 'cold') {
    reasons.push('Missing enrichment: firmographic confidence too low to trust automated targeting.');
    missing.push('firmographic enrichment');
  }

  // Senior human-touch rule: hot executive leads always get human review.
  if (summary.qualification.band === 'hot' && (summary.persona.persona === 'Founder' || summary.persona.persona === 'CEO')) {
    reasons.push('Hot executive lead — human-led outreach outperforms automation; review before running.');
  }

  return { reviewRequired: reasons.length > 0, reasons, missingInformation: missing };
}

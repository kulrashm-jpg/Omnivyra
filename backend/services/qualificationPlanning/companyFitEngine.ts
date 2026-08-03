/**
 * INT-001 Phase 3 — Company Fit Engine. Uses available information only;
 * confidence degrades explicitly as inputs go missing.
 */

import type { LeadCaptureSnapshot, PlanningContext, CompanyFitAssessment, SignalContribution } from './types';
import { classifyEmail, clampScore, clampConfidence } from './signals';
import { ICP_COMPANY_SIZES, ICP_INDUSTRIES } from './planningConfig';

const BASE_SCORE = 40;

export function evaluateCompanyFit(
  snapshot: LeadCaptureSnapshot,
  context: PlanningContext = {},
): CompanyFitAssessment {
  const { lead } = snapshot;
  const contributions: SignalContribution[] = [];
  const add = (signal: string, points: number, evidence: string) => {
    contributions.push({ signal, points, evidence });
  };

  let knownInputs = 0;

  const emailClass = classifyEmail(lead.email);
  if (emailClass !== 'unknown') knownInputs += 1;
  if (emailClass === 'company') add('company_email_domain', 10, 'Company email domain');
  if (emailClass === 'student') add('student_email_domain', -15, 'Academic email domain');

  if (lead.companySize) {
    knownInputs += 1;
    if (ICP_COMPANY_SIZES.has(lead.companySize)) add('company_size', 15, `Company size ${lead.companySize} is inside ICP`);
    else add('company_size', -5, `Company size ${lead.companySize} is outside ICP`);
  }

  if (lead.industry) {
    knownInputs += 1;
    if (ICP_INDUSTRIES.has(lead.industry)) add('industry', 15, `Industry ${lead.industry} is a strong ICP match`);
    else add('industry', 3, `Industry ${lead.industry} recorded`);
  }

  if (lead.country) {
    knownInputs += 1;
    add('geography', 3, `Geography known (${lead.country})`);
  }

  if (lead.companyName) {
    knownInputs += 1;
    add('organization_named', 4, `Organization provided (${lead.companyName})`);
  }

  if (lead.primaryInterest) {
    knownInputs += 1;
    add('product_fit_interest', 5, `Declared interest: ${lead.primaryInterest}`);
  }

  if (context.organizationType) {
    knownInputs += 1;
    if (context.organizationType === 'company' || context.organizationType === 'agency') {
      add('organization_type', 5, `Organization type ${context.organizationType}`);
    } else {
      add('organization_type', -5, `Organization type ${context.organizationType} is outside the commercial ICP`);
    }
  }

  if (context.knownIcpMatch === true) { knownInputs += 1; add('known_icp', 20, 'Caller-confirmed ICP match'); }
  if (context.existingCustomer === true) { knownInputs += 1; add('existing_customer', 10, 'Existing customer organization'); }

  const raw = BASE_SCORE + contributions.reduce((sum, c) => sum + c.points, 0);
  const score = clampScore(raw);
  const confidence = clampConfidence(0.15 + knownInputs * 0.1);

  const explanation = contributions.length === 0
    ? 'No firmographic information available — neutral fit assumed.'
    : `Company fit from: ${contributions.slice(0, 4).map((c) => c.evidence).join('; ')}.`;

  return { score, confidence, explanation, signals: contributions };
}

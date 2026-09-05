/**
 * A1 — the prompt layer of the AI ICP Generator.
 *
 * PURE: builds strings. No database, no network, no clock, no model call.
 *
 * The prompt states the frozen contract to the model as a set of hard rules, so
 * that most contract violations never reach the translator. The translator
 * still refuses anything invalid — the prompt is a courtesy, never the
 * enforcement. Nothing here trusts the model.
 */

import {
  ICP_CONFIDENCE_LEVELS, ICP_ORG_STAGES, ICP_TARGET_DERIVATIONS, ICP_TARGET_ROLE_TYPES,
} from '../types';
import { attributesFor } from '../criteria';
import type { ProfileEvidence } from './evidence';

/** Bumped whenever the instructions change. Recorded on every proposal. */
export const ICP_PROMPT_TEMPLATE_NAME = 'pi.a1.icp_generator';
export const ICP_PROMPT_TEMPLATE_VERSION = '1';

/**
 * Person attributes the generator may propose.
 *
 * `seniority`, `authority`, `influence` and `buying_role` are ICP-nameable but
 * are NOT here: no operational source can populate them (they are absent from
 * `ManualLeadInput` and no enrichment provider exists), so a criterion naming
 * one would evaluate permanently `unknown`. Contract-freeze GAP-3.
 */
export const PROPOSABLE_PERSON_ATTRIBUTES = ['job_title', 'department', 'country_code', 'region', 'city'] as const;

/** Concepts the North Star wants and the frozen criterion surface cannot hold. */
export const UNREPRESENTABLE_CONCEPTS = ['problem_relevance', 'product_service_alignment'] as const;
export type UnrepresentableConcept = typeof UNREPRESENTABLE_CONCEPTS[number];

export function buildSystemPrompt(): string {
  const accountAttrs = attributesFor('account').join(', ');
  return [
    'You propose an Ideal Customer Profile for a B2B company from its own stored business profile.',
    'You are proposing, never deciding: a human reviews, edits and ratifies what you return.',
    '',
    'ABSOLUTE RULES',
    '1. Use ONLY the evidence provided. Invent no fact, no company, no market and no quotation.',
    '2. Every quote in evidenceQuotes must appear VERBATIM in the evidence you were given.',
    '3. Cite evidence by the field name it came from. Only the field names shown are valid.',
    '4. Prefer FEW high-confidence criteria over many speculative ones. Omitting is better than guessing.',
    '5. If the evidence supports only a range, give a range. Never sharpen a range into a point value.',
    '',
    'ACCOUNT CRITERIA — allowed attributes and nothing else:',
    `  ${accountAttrs}`,
    '  Predicates: one_of (exact text/vocabulary), between/at_least/at_most (numeric only),',
    '  includes_any/includes_all (technologies only). There is no contains, like or matches.',
    '',
    'PERSON TARGETS',
    '  Return a RANKED shortlist of job titles, normally 2-5. Do NOT return one criterion per title —',
    '  return the ranked list and the system will combine it into a single membership test.',
    `  roleTypes: ${ICP_TARGET_ROLE_TYPES.join(' | ')} (one or more per target).`,
    `  derivation: ${ICP_TARGET_DERIVATIONS.join(' | ')}.`,
    `  confidence: ${ICP_CONFIDENCE_LEVELS.join(' | ')}.`,
    '  factors: e,p,b,f,r each an integer 0-2 — e=evidence directness, p=problem ownership,',
    '  b=buying authority, f=organizational fit at the assumed stage, r=product relevance.',
    '  e must be at least 1: a role with no evidence is not a target, it is a rejection.',
    `  Do NOT propose these person attributes: seniority, authority, influence, buying_role.`,
    '  Nothing can populate them, so a criterion naming one would never match anything.',
    '',
    'UNREPRESENTABLE CONCEPTS',
    '  Two things matter for fit but have no place in this model: how relevant the buyer finds the',
    '  problem, and how well the product aligns to their needs. Use them to RANK your targets, then',
    `  report what you concluded under "unrepresentable" (concepts: ${UNREPRESENTABLE_CONCEPTS.join(', ')}).`,
    '  Never encode them as an account or person criterion.',
    '',
    `STAGE  Assume exactly one target-company stage: ${ICP_ORG_STAGES.join(' | ')}, and say what it rests on.`,
    '',
    'REJECTIONS  Record candidates you seriously considered and refused, each with a real reason.',
    '  Do not manufacture rejections to fill the field.',
    '',
    'Return JSON only. No markdown, no commentary.',
  ].join('\n');
}

/** The exact JSON shape the translator will accept. Anything else is refused. */
export function buildOutputSchemaBlock(): string {
  return JSON.stringify({
    account: [{
      attribute: 'industry',
      op: 'one_of',
      values: ['<string>'],
      kind: 'required | optional',
      confidence: 'high | medium | low',
      derivation: 'directly_evidenced | inferred',
      evidenceFields: ['<field name>'],
      evidenceQuotes: ['<verbatim>'],
      rationale: '<one sentence>',
    }],
    department: { values: ['<string>'], evidenceFields: ['<field name>'], confidence: 'high | medium | low' },
    targets: [{
      rank: 1,
      title: '<job title>',
      roleTypes: ['<role type>'],
      derivation: 'directly_evidenced | inferred',
      confidence: 'high | medium | low',
      evidenceFields: ['<field name>'],
      evidenceQuotes: ['<verbatim>'],
      orgAssumption: '<why this role exists at the assumed stage>',
      factors: { e: 2, p: 2, b: 1, f: 2, r: 2 },
    }],
    rejected: [{ title: '<candidate>', reason: '<why refused>' }],
    stageAssumption: { stage: 'micro | smb | structured', evidenceFields: ['<field name>'], rationale: '<one sentence>' },
    unrepresentable: [{ concept: 'problem_relevance', finding: '<what you concluded>', evidenceFields: ['<field name>'] }],
  }, null, 1);
}

export function buildUserPrompt(evidence: ProfileEvidence): string {
  const lines: string[] = ['COMPANY PROFILE EVIDENCE', ''];

  for (const [field, value] of Object.entries(evidence.present)) {
    const trust = evidence.fieldConfidence?.[field];
    const locked = evidence.userLocked.includes(field);
    // Trust is stated per field so the model can weight a user-locked,
    // high-confidence field above an AI-refined low-confidence one.
    const tag = [locked ? 'user-confirmed' : null, trust ? `confidence=${trust}` : null]
      .filter(Boolean).join(', ');
    lines.push(`[${field}]${tag ? ` (${tag})` : ''}`, value, '');
  }

  if (evidence.absent.length) {
    lines.push(
      'FIELDS WITH NO VALUE — treat as unknown, never as a negative finding:',
      evidence.absent.join(', '),
      '',
    );
  }
  if (evidence.overallConfidence !== null) {
    lines.push(`Profile overall confidence: ${evidence.overallConfidence}/100`, '');
  }

  lines.push(
    'VALID EVIDENCE FIELD NAMES — cite only these:',
    Object.keys(evidence.present).join(', '),
    '',
    'Return JSON matching exactly this shape:',
    buildOutputSchemaBlock(),
  );
  return lines.join('\n');
}

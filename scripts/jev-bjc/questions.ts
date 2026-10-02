/**
 * BJC question templates, version `bjcq/1` (spec §2.2).
 *
 * The provider primitive is: state text + typed questions → typed answers.
 * State is built ONLY from the request's acceptance criterion, invariants,
 * deterministic summary and evidence — never the repository, a transcript or
 * a prompt. Changing any template text requires bumping QUESTIONS_VERSION,
 * which changes every input hash.
 */
import { JEV_AC_ANSWERS, JEV_INVARIANT_ANSWERS, type BjcRequest } from './contract';

export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}
export interface NoulQuestion {
  type: 'noul';
  instructions: string;
  criteria: { true: string; false: string };
}
export type ProviderQuestion = ChoiceQuestion | NoulQuestion;

export const AC_QUESTION_KEY = 'ac';
export const BUNDLE_QUESTION_KEY = 'bundle_consistency';
export const invariantKey = (index: number): string => `inv_${index}`;

const AC_CRITERIA: Record<(typeof JEV_AC_ANSWERS)[number], string> = {
  SUPPORTS: 'The supplied evidence shows the acceptance criterion is met.',
  CONTRADICTS: 'The supplied evidence shows the acceptance criterion is not met.',
  CANNOT_DETERMINE: 'The supplied evidence is not enough to tell either way.',
};

const INVARIANT_CRITERIA: Record<(typeof JEV_INVARIANT_ANSWERS)[number], string> = {
  HOLDS: 'Nothing in the supplied evidence breaks the invariant.',
  VIOLATED: 'The supplied evidence shows the invariant is broken.',
  CANNOT_DETERMINE: 'The supplied evidence is not enough to tell either way.',
};

export function buildState(req: BjcRequest): string {
  const ac = req.acceptance_criterion;
  const lines: string[] = [
    'Judge ONLY from the material below. Nothing else is available.',
    '',
    `Acceptance criterion ${ac.id} (${ac.kind}): ${ac.statement}`,
    `Deterministic evidence summary: ${req.deterministic_summary || '(none supplied)'}`,
  ];
  if (req.invariants.length > 0) {
    lines.push('', 'Invariants:');
    for (const inv of req.invariants) lines.push(`- ${inv.id}: ${inv.statement}`);
  }
  lines.push('', 'Evidence:');
  if (req.evidence.length === 0) lines.push('- (none supplied)');
  for (const ev of req.evidence) {
    lines.push(`- ${ev.id} [${ev.kind}] result=${ev.result} by ${ev.produced_by} at ${ev.captured_at} ref=${ev.ref}`);
    if (ev.excerpt) lines.push(`  excerpt: ${ev.excerpt}`);
  }
  return lines.join('\n');
}

export function buildQuestions(req: BjcRequest): Record<string, ProviderQuestion> {
  const questions: Record<string, ProviderQuestion> = {
    [AC_QUESTION_KEY]: {
      type: 'choice',
      instructions: `Does the supplied evidence show that acceptance criterion ${req.acceptance_criterion.id} is met?`,
      criteria: { ...AC_CRITERIA },
    },
  };
  req.invariants.forEach((inv, i) => {
    questions[invariantKey(i)] = {
      type: 'choice',
      instructions: `Does the supplied evidence show invariant ${inv.id} still holds?`,
      criteria: { ...INVARIANT_CRITERIA },
    };
  });
  questions[BUNDLE_QUESTION_KEY] = {
    type: 'noul',
    instructions: 'Is the supplied evidence internally consistent (no item contradicts another)?',
    criteria: { true: 'The evidence items agree with each other.', false: 'At least two evidence items contradict each other.' },
  };
  return questions;
}

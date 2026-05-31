import type { OrganizationPerspective } from './organizationPerspectiveEngine';

export interface RebrandResistanceValidationResult {
  score: number;
  passed: boolean;
  interchangeableRisk: 'low' | 'medium' | 'high';
  missingSignals: string[];
  replacementTests: Array<{ replacement: string; remainsValid: boolean; reason: string }>;
}

function normalize(value: string | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function containsSignal(text: string, signal: string | undefined): boolean {
  const normalized = normalize(signal);
  if (!normalized || normalized.length < 8) return false;
  const terms = normalized
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 4)
    .slice(0, 8);
  if (terms.length === 0) return false;
  const matches = terms.filter((term) => text.includes(term)).length;
  return matches >= Math.min(3, terms.length);
}

export function validateRebrandResistance(input: {
  contentHtml: string;
  companyName?: string;
  uniqueValue?: string;
  competitiveAdvantages?: string;
  coreProblem?: string;
  perspective: OrganizationPerspective;
}): RebrandResistanceValidationResult {
  const text = stripHtml(input.contentHtml).toLowerCase();
  const companyName = normalize(input.companyName);
  const signals = [
    { label: 'company name', value: companyName },
    { label: 'unique value', value: input.uniqueValue },
    { label: 'competitive advantages', value: input.competitiveAdvantages },
    { label: 'core problem', value: input.coreProblem },
    { label: 'company viewpoint', value: input.perspective.companyViewpoint },
    { label: 'proprietary insight', value: input.perspective.proprietaryInsight },
    { label: 'tradeoff analysis', value: input.perspective.tradeoffAnalysis },
  ];
  const presentSignals = signals.filter((signal) => containsSignal(text, signal.value));
  const missingSignals = signals
    .filter((signal) => !containsSignal(text, signal.value))
    .map((signal) => signal.label);
  const companyMentions = companyName ? (text.match(new RegExp(companyName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length : 0;
  const signalScore = Math.min(70, presentSignals.length * 11);
  const nameScore = companyMentions >= 2 ? 15 : companyMentions === 1 ? 8 : 0;
  const tradeoffScore = /avoid|tradeoff|risk|failure|instead|rather than|stop/.test(text) ? 15 : 0;
  const score = Math.min(100, signalScore + nameScore + tradeoffScore);
  const remainsValid = score < 70;

  return {
    score,
    passed: score >= 70,
    interchangeableRisk: score >= 80 ? 'low' : score >= 60 ? 'medium' : 'high',
    missingSignals,
    replacementTests: [
      { replacement: 'competitor', remainsValid, reason: remainsValid ? 'Company-specific signals are too weak.' : 'Company-specific proof points materially affect the argument.' },
      { replacement: 'generic consultancy', remainsValid, reason: remainsValid ? 'The article still reads as generic advisory content.' : 'The article depends on organization-specific viewpoint and tradeoffs.' },
      { replacement: 'generic SaaS company', remainsValid, reason: remainsValid ? 'The article lacks enough proprietary operating context.' : 'The article contains enough non-transferable strategic context.' },
    ],
  };
}

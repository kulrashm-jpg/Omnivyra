/**
 * Company-profile wizard steps (UI step 6, approved field-merge plan
 * C:/tmp/ui-profile-field-merge-plan.md: "merge the screens, not the columns").
 *
 * Each concept is asked ONCE, in a logical order (owner: "start logically and progress
 * naturally"). Steps group existing fields; no DB column is merged or dropped. Every
 * existing column keeps being written by the same save path.
 */
export type WizardStepId =
  | 'basics'
  | 'sources'
  | 'offering'
  | 'audience'
  | 'voice'
  | 'problem'
  | 'goals'
  | 'advanced'
  | 'review';

export type WizardStep = { id: WizardStepId; title: string; hint: string };

export const WIZARD_STEPS: readonly WizardStep[] = Object.freeze([
  { id: 'basics', title: 'Basics', hint: 'Who you are: name, industry, where you operate, company facts.' },
  { id: 'sources', title: 'Sources & AI fill', hint: 'Your website and social links, then let AI fill in the rest.' },
  { id: 'offering', title: 'What you offer', hint: 'Products and services, what makes you different, pricing.' },
  { id: 'audience', title: 'Who you serve', hint: 'Target audience, segment, ideal customer, competitors.' },
  { id: 'voice', title: 'Voice & messaging', hint: 'Brand voice, positioning, key messages, themes, channels.' },
  { id: 'problem', title: 'Problem & transformation', hint: 'The problem you solve and the change you create.' },
  { id: 'goals', title: 'Goals', hint: 'What you want to achieve and how you will measure it.' },
  { id: 'advanced', title: 'Advanced (optional)', hint: 'Market Pulse defaults and intelligence settings.' },
  { id: 'review', title: 'Review & save', hint: 'Profile strength, recent AI refinements and history.' },
]);

export function stepIndex(id: WizardStepId): number {
  return WIZARD_STEPS.findIndex((s) => s.id === id);
}

export function nextStepId(id: WizardStepId): WizardStepId | null {
  const i = stepIndex(id);
  return i >= 0 && i < WIZARD_STEPS.length - 1 ? WIZARD_STEPS[i + 1].id : null;
}

export function previousStepId(id: WizardStepId): WizardStepId | null {
  const i = stepIndex(id);
  return i > 0 ? WIZARD_STEPS[i - 1].id : null;
}

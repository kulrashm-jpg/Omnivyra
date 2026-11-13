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

/**
 * Profile columns edited on each step (6.5), used for the "edited by you" notice.
 * Labels match the form.
 */
export const STEP_FIELDS: Readonly<Partial<Record<WizardStepId, ReadonlyArray<readonly [string, string]>>>> = Object.freeze({
  basics: [['name', 'Company name'], ['industry', 'Industry'], ['category', 'Category'], ['geography', 'Geography']],
  offering: [['products_services', 'What you offer'], ['unique_value', 'Unique value'], ['pricing_model', 'Pricing model']],
  audience: [
    ['target_audience', 'Target audience'], ['competitors', 'Competitors'], ['target_customer_segment', 'Target customer segment'],
    ['ideal_customer_profile', 'Ideal customer profile'], ['sales_motion', 'Sales motion'], ['avg_deal_size', 'Avg deal size'],
    ['sales_cycle', 'Sales cycle'],
  ],
  voice: [
    ['brand_voice', 'Brand voice'], ['content_themes', 'Content themes'], ['brand_positioning', 'Brand positioning'],
    ['competitive_advantages', 'Competitive advantages'], ['key_messages', 'Key messages'], ['marketing_channels', 'Marketing channels'],
    ['content_strategy', 'Content strategy'], ['campaign_focus', 'Campaign focus'],
  ],
  problem: [
    ['core_problem_statement', 'Core problem'], ['pain_symptoms', 'Pain symptoms'], ['awareness_gap', 'Awareness gap'],
    ['problem_impact', 'Problem impact'], ['desired_transformation', 'Desired transformation'],
  ],
  goals: [['goals', 'Goals'], ['key_metrics', 'Key metrics'], ['growth_priorities', 'Growth priorities']],
});

/**
 * Fields on this step the user edited (55's provenance: user_locked_fields, and
 * report_settings.field_edited_at for when). Read-only and optional: works before the
 * provenance branch lands (nothing listed).
 */
export function editedFieldsForStep(
  stepId: WizardStepId,
  profile: { user_locked_fields?: string[] | null; report_settings?: unknown } | null | undefined,
): Array<{ field: string; label: string; editedAt: string | null }> {
  const locked = new Set(Array.isArray(profile?.user_locked_fields) ? profile!.user_locked_fields! : []);
  const rs = (profile?.report_settings && typeof profile.report_settings === 'object' ? profile.report_settings : {}) as Record<string, unknown>;
  const editedAt = (rs.field_edited_at && typeof rs.field_edited_at === 'object' ? rs.field_edited_at : {}) as Record<string, unknown>;
  return (STEP_FIELDS[stepId] ?? [])
    .filter(([field]) => locked.has(field))
    .map(([field, label]) => ({ field, label, editedAt: typeof editedAt[field] === 'string' ? (editedAt[field] as string) : null }));
}

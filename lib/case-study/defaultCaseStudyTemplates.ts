export interface CaseStudyTemplateDefinition {
  name: string;
  description: string;
  content_type: 'case-study';
  format_type: 'case-study';
  recommended_for?: string[];
}

export const CASE_STUDY_DEFAULT_TEMPLATES: readonly CaseStudyTemplateDefinition[] = [
  {
    name: 'Results Story',
    description: 'A proof-led case study focused on measurable outcomes and what drove them.',
    content_type: 'case-study',
    format_type: 'case-study',
    recommended_for: ['conversion support', 'proof assets', 'sales enablement'],
  },
  {
    name: 'Transformation Story',
    description: 'A narrative case study showing the before, after, and the journey in between.',
    content_type: 'case-study',
    format_type: 'case-study',
    recommended_for: ['brand trust', 'customer storytelling', 'change narratives'],
  },
  {
    name: 'Proof Breakdown',
    description: 'A more analytical case study that explains the context, intervention, and result mechanics.',
    content_type: 'case-study',
    format_type: 'case-study',
    recommended_for: ['B2B proof', 'buyer education', 'objection handling'],
  },
] as const;

export function getDefaultCaseStudyTemplates(): readonly CaseStudyTemplateDefinition[] {
  return CASE_STUDY_DEFAULT_TEMPLATES;
}

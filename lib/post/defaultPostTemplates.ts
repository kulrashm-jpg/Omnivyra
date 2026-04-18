export interface PostTemplateDefinition {
  name: string;
  description: string;
  content_type: 'post';
  format_type: 'standard';
  recommended_for?: string[];
}

export const POST_DEFAULT_TEMPLATES: readonly PostTemplateDefinition[] = [
  {
    name: 'Authority Post',
    description: 'A point-of-view post built to establish expertise with a strong hook and a clear takeaway.',
    content_type: 'post',
    format_type: 'standard',
    recommended_for: ['thought leadership', 'authority building', 'professional social content'],
  },
  {
    name: 'Quick Insight',
    description: 'A concise, high-signal post that turns one observation into a shareable takeaway.',
    content_type: 'post',
    format_type: 'standard',
    recommended_for: ['fast publishing', 'audience engagement', 'lightweight consistency'],
  },
  {
    name: 'Launch Post',
    description: 'A momentum-driven post for announcements, launches, or new offers with clear positioning.',
    content_type: 'post',
    format_type: 'standard',
    recommended_for: ['product launches', 'campaign reveals', 'offer communication'],
  },
] as const;

export function getDefaultPostTemplates(): readonly PostTemplateDefinition[] {
  return POST_DEFAULT_TEMPLATES;
}

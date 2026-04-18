import type { GuideFormatType } from '../blog/blogStructureTemplates';

export interface GuideTemplateDefinition {
  name: string;
  description: string;
  content_type: 'guide';
  format_type: GuideFormatType;
  recommended_for?: string[];
}

export const GUIDE_DEFAULT_TEMPLATES: readonly GuideTemplateDefinition[] = [
  {
    name: 'Comprehensive Guide',
    description: 'Full pillar-style guide for search, authority, and deep practical coverage.',
    content_type: 'guide',
    format_type: 'comprehensive',
    recommended_for: ['pillar SEO', 'authority content', 'evergreen education'],
  },
  {
    name: 'Quickstart Guide',
    description: 'Action-first guide designed to get readers to a first win fast.',
    content_type: 'guide',
    format_type: 'quickstart',
    recommended_for: ['product onboarding', 'how-to content', 'activation'],
  },
  {
    name: 'Reference Handbook',
    description: 'Lookup-style guide organized by categories, definitions, and applied patterns.',
    content_type: 'guide',
    format_type: 'reference',
    recommended_for: ['documentation-style content', 'team enablement', 'repeat-use resources'],
  },
] as const;

export function getDefaultGuideTemplates(): readonly GuideTemplateDefinition[] {
  return GUIDE_DEFAULT_TEMPLATES;
}

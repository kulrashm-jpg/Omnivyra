import type { ArticleFormatType } from '../blog/blogStructureTemplates';

export interface ArticleTemplateDefinition {
  name: string;
  description: string;
  content_type: 'article';
  format_type: ArticleFormatType;
  recommended_for?: string[];
}

export const ARTICLE_DEFAULT_TEMPLATES: readonly ArticleTemplateDefinition[] = [
  {
    name: 'Narrative Feature',
    description: 'Story-driven feature article with scenes, expert perspective, and a clear editorial arc.',
    content_type: 'article',
    format_type: 'narrative',
    recommended_for: ['brand storytelling', 'thought leadership', 'audience engagement'],
  },
  {
    name: 'Investigative Brief',
    description: 'Evidence-first article format built around findings, context, and sourced analysis.',
    content_type: 'article',
    format_type: 'investigative',
    recommended_for: ['industry analysis', 'research-backed content', 'authority building'],
  },
  {
    name: 'Opinion Editorial',
    description: 'Strong thesis-led article with counterpoint handling and a decisive point of view.',
    content_type: 'article',
    format_type: 'opinion',
    recommended_for: ['executive perspective', 'contrarian takes', 'category positioning'],
  },
] as const;

export function getDefaultArticleTemplates(): readonly ArticleTemplateDefinition[] {
  return ARTICLE_DEFAULT_TEMPLATES;
}

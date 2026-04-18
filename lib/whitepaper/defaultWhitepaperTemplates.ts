import type { WhitepaperFormatType } from '../blog/blogStructureTemplates';

export interface WhitepaperTemplateDefinition {
  name: string;
  description: string;
  content_type: 'whitepaper';
  format_type: WhitepaperFormatType;
  recommended_for?: string[];
}

export const WHITEPAPER_DEFAULT_TEMPLATES: readonly WhitepaperTemplateDefinition[] = [
  {
    name: 'Research Report',
    description: 'Formal whitepaper format centered on findings, methodology, and cited conclusions.',
    content_type: 'whitepaper',
    format_type: 'research',
    recommended_for: ['research marketing', 'authority assets', 'evidence-led narratives'],
  },
  {
    name: 'Strategic Brief',
    description: 'Executive-facing whitepaper focused on market context, frameworks, and recommendations.',
    content_type: 'whitepaper',
    format_type: 'strategic',
    recommended_for: ['executive enablement', 'board-level communication', 'go-to-market strategy'],
  },
  {
    name: 'Technical Deep-Dive',
    description: 'Architecture and implementation-heavy whitepaper for technical buyers and operators.',
    content_type: 'whitepaper',
    format_type: 'technical',
    recommended_for: ['technical marketing', 'solution engineering', 'product architecture'],
  },
] as const;

export function getDefaultWhitepaperTemplates(): readonly WhitepaperTemplateDefinition[] {
  return WHITEPAPER_DEFAULT_TEMPLATES;
}

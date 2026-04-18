export interface ThreadTemplateDefinition {
  name: string;
  description: string;
  content_type: 'thread';
  format_type: 'thread';
  recommended_for?: string[];
}

export const THREAD_DEFAULT_TEMPLATES: readonly ThreadTemplateDefinition[] = [
  {
    name: 'Explainer Thread',
    description: 'A structured educational thread that breaks a concept into clear, progressive steps.',
    content_type: 'thread',
    format_type: 'thread',
    recommended_for: ['education', 'audience growth', 'complex topic simplification'],
  },
  {
    name: 'Breakdown Thread',
    description: 'A high-signal analytical thread that dissects a strategy, trend, or real example.',
    content_type: 'thread',
    format_type: 'thread',
    recommended_for: ['analysis', 'authority building', 'market commentary'],
  },
  {
    name: 'Narrative Thread',
    description: 'A story-driven thread designed to hold attention with pacing, tension, and a payoff.',
    content_type: 'thread',
    format_type: 'thread',
    recommended_for: ['storytelling', 'founder narrative', 'audience retention'],
  },
] as const;

export function getDefaultThreadTemplates(): readonly ThreadTemplateDefinition[] {
  return THREAD_DEFAULT_TEMPLATES;
}

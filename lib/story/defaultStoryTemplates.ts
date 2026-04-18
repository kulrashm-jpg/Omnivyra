import type { StoryFormatType } from '../blog/blogStructureTemplates';

export interface StoryTemplateDefinition {
  name: string;
  description: string;
  content_type: 'story';
  format_type: StoryFormatType;
  recommended_for?: string[];
}

export const STORY_DEFAULT_TEMPLATES: readonly StoryTemplateDefinition[] = [
  {
    name: 'Short Story',
    description: 'Compact narrative with a hook, tension, and a memorable turn.',
    content_type: 'story',
    format_type: 'short_story',
    recommended_for: ['social storytelling', 'brand moments', 'compact narrative content'],
  },
  {
    name: 'Long Narrative',
    description: 'Deep story with scene development, layered stakes, and stronger emotional payoff.',
    content_type: 'story',
    format_type: 'long_story',
    recommended_for: ['brand storytelling', 'founder stories', 'customer narratives'],
  },
  {
    name: 'Episodic Series',
    description: 'Serialized story format with continuity, recurring voice, and a cliffhanger structure.',
    content_type: 'story',
    format_type: 'episodic_story',
    recommended_for: ['campaign series', 'recurring narrative franchises', 'audience retention'],
  },
] as const;

export function getDefaultStoryTemplates(): readonly StoryTemplateDefinition[] {
  return STORY_DEFAULT_TEMPLATES;
}

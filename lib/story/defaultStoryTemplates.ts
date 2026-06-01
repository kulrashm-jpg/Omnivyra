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
    name: 'Scene Snapshot',
    description: 'A compact illustrated moment built around one vivid scene, one conflict, and one takeaway.',
    content_type: 'story',
    format_type: 'short_story',
    recommended_for: ['illustrated short story', 'single-scene brand moment', 'compact narrative content'],
  },
  {
    name: 'Dialogue Turn',
    description: 'A quote-led short story where one remembered line or decision changes the direction.',
    content_type: 'story',
    format_type: 'short_story',
    recommended_for: ['founder anecdotes', 'operator moments', 'voice-led storytelling'],
  },
  {
    name: 'Visual Micro-Story',
    description: 'A media-first short story with a strong image prompt, tight beats, and a visual payoff.',
    content_type: 'story',
    format_type: 'short_story',
    recommended_for: ['visual storytelling', 'campaign teasers', 'social repurposing'],
  },
  {
    name: 'Cinematic Journey',
    description: 'A scene-rich long story with act structure, visual transitions, and emotional payoff.',
    content_type: 'story',
    format_type: 'long_story',
    recommended_for: ['brand storytelling', 'illustrated longform', 'narrative essays'],
  },
  {
    name: 'Founder Reflection',
    description: 'A reflective long narrative built around memory, voice, lessons, and lived detail.',
    content_type: 'story',
    format_type: 'long_story',
    recommended_for: ['founder stories', 'leadership reflections', 'origin narratives'],
  },
  {
    name: 'Customer Journey',
    description: 'A long story structured around a customer or team transformation with proof moments.',
    content_type: 'story',
    format_type: 'long_story',
    recommended_for: ['customer narratives', 'team transformation', 'case-story hybrids'],
  },
  {
    name: 'Cliffhanger Episode',
    description: 'A serialized episode with recap, current conflict, reveal, and next-entry momentum.',
    content_type: 'story',
    format_type: 'episodic_story',
    recommended_for: ['campaign series', 'audience retention', 'serialized storytelling'],
  },
  {
    name: 'Series Recap',
    description: 'A continuity-friendly episode that reorients readers before advancing the story.',
    content_type: 'story',
    format_type: 'episodic_story',
    recommended_for: ['multi-part narratives', 'recurring newsletters', 'community updates'],
  },
  {
    name: 'Visual Episode Board',
    description: 'A storyboard-style episode with visual beats, motif tracking, and a clear cliffhanger.',
    content_type: 'story',
    format_type: 'episodic_story',
    recommended_for: ['illustrated episodes', 'carousel adaptation', 'campaign storyboards'],
  },
] as const;

export function getDefaultStoryTemplates(): readonly StoryTemplateDefinition[] {
  return STORY_DEFAULT_TEMPLATES;
}

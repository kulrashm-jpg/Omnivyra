/**
 * Content capacity options by creation mode.
 * Manual and AI-assisted: same full options (creator-dependent + text types).
 * Full AI: text-driven types (Blog, Article, Story, Post, Thread, etc.) - AI can generate.
 */

/** Text-driven types that Full AI can generate without human creation. "Text posts" = textual feed posts only. */
const TEXT_DRIVEN_PLANNING_LABELS = [
  'Text posts', 'Blogs', 'Articles', 'Stories', 'Threads', 'Newsletters',
] as const;

const CREATOR_DEPENDENT_PLANNING_LABELS = [
  'Videos', 'Long Videos', 'Carousels', 'Images', 'Shorts', 'Reels',
  'Songs', 'Audio', 'Podcasts', 'Slides', 'Slideware',
] as const;

export const PLATFORM_CREATOR_DEPENDENT_TYPES: Record<string, string[]> = {
  linkedin: ['Videos', 'Carousels'],
  facebook: ['Videos', 'Stories', 'Reels'],
  instagram: ['Stories', 'Reels', 'Long Videos', 'Carousels'],
  twitter: ['Videos', 'Spaces'],
  x: ['Videos', 'Spaces'],
  youtube: ['Videos', 'Shorts', 'Long Videos'],
  tiktok: ['Videos', 'Stories', 'Long Videos'],
};

export function getContentCapacityOptionsForMode(
  mode: 'manual' | 'ai-assisted' | 'full-ai' | '',
  allTypes: string[],
  platforms: string[]
): string[] {
  if (mode === 'full-ai') {
    return Array.from(TEXT_DRIVEN_PLANNING_LABELS).sort((a, b) => a.localeCompare(b));
  }
  return allTypes;
}

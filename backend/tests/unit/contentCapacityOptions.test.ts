/**
 * Content capacity options by creation mode.
 * Manual and AI-assisted: same full options (all types).
 * Full AI: text-driven types (Blog, Article, Story, Post, Thread, Newsletter).
 */
import {
  getContentCapacityOptionsForMode,
  PLATFORM_CREATOR_DEPENDENT_TYPES,
} from '../../../utils/contentCapacityOptions';

const ALL_TYPES = [
  'Posts', 'Videos', 'Long Videos', 'Blogs', 'Articles', 'White Papers',
  'Carousels', 'Images', 'Stories', 'Threads', 'Shorts', 'Reels', 'Spaces',
  'Songs', 'Audio', 'Podcasts', 'Newsletters', 'Webinars', 'Slides', 'Slideware',
];

describe('contentCapacityOptions', () => {
  describe('Manual mode', () => {
    it('returns all types (same as having content)', () => {
      const result = getContentCapacityOptionsForMode('manual', ALL_TYPES, []);
      expect(result).toEqual(ALL_TYPES);
    });
    it('returns all types even when platforms provided', () => {
      const result = getContentCapacityOptionsForMode('manual', ALL_TYPES, ['linkedin', 'youtube']);
      expect(result).toEqual(ALL_TYPES);
      expect(result).toContain('Posts');
      expect(result).toContain('Blogs');
      expect(result).toContain('Articles');
    });
  });

  describe('AI-assisted mode', () => {
    it('returns all types (same as Manual)', () => {
      const result = getContentCapacityOptionsForMode('ai-assisted', ALL_TYPES, []);
      expect(result).toEqual(ALL_TYPES);
    });
    it('returns all types even when platforms provided', () => {
      const result = getContentCapacityOptionsForMode('ai-assisted', ALL_TYPES, ['linkedin', 'youtube']);
      expect(result).toEqual(ALL_TYPES);
      expect(result).toContain('Posts');
      expect(result).toContain('Blogs');
    });
  });

  describe('Full AI mode', () => {
    it('returns text-driven types only (blog, article, story, text posts, thread, newsletter)', () => {
      const result = getContentCapacityOptionsForMode('full-ai', ALL_TYPES, []);
      expect(result).toEqual(['Articles', 'Blogs', 'Newsletters', 'Stories', 'Text posts', 'Threads']);
      expect(result).toContain('Text posts');
      expect(result).toContain('Blogs');
      expect(result).toContain('Articles');
      expect(result).toContain('Stories');
      expect(result).toContain('Threads');
      expect(result).toContain('Newsletters');
      expect(result).not.toContain('Videos');
      expect(result).not.toContain('Carousels');
    });
    it('returns same text-driven types regardless of platforms', () => {
      const result = getContentCapacityOptionsForMode('full-ai', ALL_TYPES, ['linkedin', 'youtube']);
      expect(result).toEqual(['Articles', 'Blogs', 'Newsletters', 'Stories', 'Text posts', 'Threads']);
    });
  });

  describe('PLATFORM_CREATOR_DEPENDENT_TYPES', () => {
    it('matches expected platform mappings', () => {
      expect(PLATFORM_CREATOR_DEPENDENT_TYPES.linkedin).toEqual(['Videos', 'Carousels']);
      expect(PLATFORM_CREATOR_DEPENDENT_TYPES.facebook).toEqual(['Videos', 'Stories', 'Reels']);
      expect(PLATFORM_CREATOR_DEPENDENT_TYPES.instagram).toEqual(['Stories', 'Reels', 'Long Videos', 'Carousels']);
      expect(PLATFORM_CREATOR_DEPENDENT_TYPES.twitter).toEqual(['Videos', 'Spaces']);
      expect(PLATFORM_CREATOR_DEPENDENT_TYPES.x).toEqual(['Videos', 'Spaces']);
      expect(PLATFORM_CREATOR_DEPENDENT_TYPES.youtube).toEqual(['Videos', 'Shorts', 'Long Videos']);
      expect(PLATFORM_CREATOR_DEPENDENT_TYPES.tiktok).toEqual(['Videos', 'Stories', 'Long Videos']);
    });
  });
});

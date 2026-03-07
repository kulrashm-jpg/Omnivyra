/**
 * Unit tests for Phase 8 — Prompt Context Cache
 */

import {
  getCachedPrompt,
  storePrompt,
  getOrBuildPromptBlock,
  clearPromptCache,
} from '../../services/promptContextCache';
import { generateCacheFingerprint } from '../../utils/promptFingerprint';

describe('promptContextCache', () => {
  beforeEach(() => {
    clearPromptCache();
  });

  describe('getCachedPrompt / storePrompt', () => {
    it('returns undefined when not cached', () => {
      const fp = generateCacheFingerprint('test');
      expect(getCachedPrompt(fp)).toBeUndefined();
    });

    it('returns cached content after store', () => {
      const content = 'Company profile: Acme Corp...';
      const fp = generateCacheFingerprint(content);
      storePrompt(fp, content);
      expect(getCachedPrompt(fp)).toBe(content);
    });
  });

  describe('getOrBuildPromptBlock', () => {
    it('stores and returns on first call (cache miss)', () => {
      const content = 'Strategic themes: AI, Cloud...';
      const result = getOrBuildPromptBlock('strategic_theme_context', content);
      expect(result.content).toBe(content);
      expect(result.cacheHit).toBe(false);
      expect(result.fingerprint).toHaveLength(64);
      expect(result.fingerprint).toMatch(/^[a-f0-9]+$/);
    });

    it('returns cached content on second call (cache hit)', () => {
      const content = 'Weekly plan context: Week 1...';
      const first = getOrBuildPromptBlock('weekly_plan_context', content);
      const second = getOrBuildPromptBlock('weekly_plan_context', content);

      expect(first.cacheHit).toBe(false);
      expect(second.cacheHit).toBe(true);
      expect(first.content).toBe(second.content);
      expect(first.fingerprint).toBe(second.fingerprint);
    });

    it('different content produces different fingerprints and no hit', () => {
      const a = getOrBuildPromptBlock('block', 'Content A');
      const b = getOrBuildPromptBlock('block', 'Content B');
      expect(a.fingerprint).not.toBe(b.fingerprint);
      expect(a.cacheHit).toBe(false);
      expect(b.cacheHit).toBe(false);
    });
  });

  describe('clearPromptCache', () => {
    it('clears all cached entries', () => {
      const content = 'Test content';
      getOrBuildPromptBlock('test', content);
      expect(getOrBuildPromptBlock('test', content).cacheHit).toBe(true);
      clearPromptCache();
      expect(getOrBuildPromptBlock('test', content).cacheHit).toBe(false);
    });
  });
});

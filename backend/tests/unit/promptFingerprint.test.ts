/**
 * Unit tests for Prompt Fingerprint utility
 */
import { generatePromptFingerprint, generateCacheFingerprint } from '../../utils/promptFingerprint';

describe('promptFingerprint', () => {
  describe('generatePromptFingerprint', () => {
    it('fingerprint is deterministic for same prompt', () => {
      const prompt = 'You are an expert strategist. Campaign: Launch.';
      const a = generatePromptFingerprint(prompt);
      const b = generatePromptFingerprint(prompt);
      expect(a).toBe(b);
      expect(a).toHaveLength(8);
      expect(a).toMatch(/^[a-f0-9]+$/);
    });

    it('different prompts produce different fingerprints', () => {
      const p1 = 'Prompt A';
      const p2 = 'Prompt B';
      const f1 = generatePromptFingerprint(p1);
      const f2 = generatePromptFingerprint(p2);
      expect(f1).not.toBe(f2);
    });

    it('small change in prompt produces different fingerprint', () => {
      const base = 'Campaign topic: Product launch';
      const modified = 'Campaign topic: Product launches';
      expect(generatePromptFingerprint(base)).not.toBe(generatePromptFingerprint(modified));
    });
  });

  describe('generateCacheFingerprint (Phase 8)', () => {
    it('uses SHA256 and returns full hex', () => {
      const prompt = 'Company profile context';
      const fp = generateCacheFingerprint(prompt);
      expect(fp).toHaveLength(64);
      expect(fp).toMatch(/^[a-f0-9]+$/);
      expect(generateCacheFingerprint(prompt)).toBe(fp);
    });
  });
});

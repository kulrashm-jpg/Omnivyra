/**
 * Unit tests for Content Amplification Service
 */
import {
  computeContentAmplificationScore,
  type AmplificationSignals,
} from '../../services/contentAmplificationService';

describe('contentAmplificationService', () => {
  describe('computeContentAmplificationScore', () => {
    it('returns 0.5 when no signals', () => {
      expect(computeContentAmplificationScore('blog', 'linkedin', undefined)).toBe(0.5);
      expect(computeContentAmplificationScore('post', undefined, undefined)).toBe(0.5);
    });

    it('adds 0.3 for high-performing content type', () => {
      const signals: AmplificationSignals = {
        high_performing_content_types: ['blog'],
      };
      expect(computeContentAmplificationScore('blog', undefined, signals)).toBe(0.8);
      expect(computeContentAmplificationScore('post', undefined, signals)).toBe(0.5);
    });

    it('adds 0.35 for platform+content combo (e.g. linkedin_carousel)', () => {
      const signals: AmplificationSignals = {
        high_performing_content_types: ['linkedin_carousel', 'instagram_reel'],
      };
      expect(computeContentAmplificationScore('carousel', 'linkedin', signals)).toBe(0.85);
      expect(computeContentAmplificationScore('reel', 'instagram', signals)).toBe(0.85);
      expect(computeContentAmplificationScore('carousel', 'instagram', signals)).toBe(0.5);
    });

    it('combo takes precedence over content-type-only match', () => {
      const signals: AmplificationSignals = {
        high_performing_content_types: ['thread', 'x_thread'],
      };
      expect(computeContentAmplificationScore('thread', 'x', signals)).toBe(0.85);
      expect(computeContentAmplificationScore('thread', undefined, signals)).toBe(0.8);
    });

    it('adds 0.2 for high-performing platform', () => {
      const signals: AmplificationSignals = {
        high_performing_platforms: ['linkedin'],
      };
      expect(computeContentAmplificationScore('post', 'linkedin', signals)).toBe(0.7);
      expect(computeContentAmplificationScore('post', undefined, signals)).toBe(0.5);
      expect(computeContentAmplificationScore('post', 'instagram', signals)).toBe(0.5);
    });

    it('subtracts 0.3 for low-performing content type', () => {
      const signals: AmplificationSignals = {
        low_performing_patterns: ['carousel'],
      };
      expect(computeContentAmplificationScore('carousel', undefined, signals)).toBe(0.2);
      expect(computeContentAmplificationScore('blog', undefined, signals)).toBe(0.5);
    });

    it('combines signals correctly and clamps to 0–1', () => {
      const signals: AmplificationSignals = {
        high_performing_content_types: ['blog'],
        high_performing_platforms: ['linkedin'],
      };
      expect(computeContentAmplificationScore('blog', 'linkedin', signals)).toBe(1);
    });

    it('clamps minimum to 0', () => {
      const signals: AmplificationSignals = {
        low_performing_patterns: ['carousel', 'blog'],
      };
      expect(computeContentAmplificationScore('blog', undefined, signals)).toBe(0.2);
      expect(computeContentAmplificationScore('carousel', undefined, signals)).toBe(0.2);
    });

    it('adds 0.15 for strategic_importance high and clamps to 1', () => {
      const signals: AmplificationSignals = {
        high_performing_content_types: ['blog'],
      };
      expect(
        computeContentAmplificationScore('blog', undefined, signals, {
          strategic_importance: 'high',
        })
      ).toBeCloseTo(0.95);
      const signals2: AmplificationSignals = {
        high_performing_content_types: ['blog'],
        high_performing_platforms: ['linkedin'],
      };
      expect(
        computeContentAmplificationScore('blog', 'linkedin', signals2, {
          strategic_importance: 'high',
        })
      ).toBe(1);
    });
  });
});

/**
 * Unit tests for Post Density Engine
 */
import {
  determinePostsPerWeek,
  momentumScoreToLevel,
  pressureConfigToLevel,
} from '../../services/postDensityEngine';

describe('postDensityEngine', () => {
  describe('determinePostsPerWeek', () => {
    it('low momentum → 2 posts/week (base)', () => {
      expect(
        determinePostsPerWeek({
          campaignDurationWeeks: 6,
          momentumLevel: 'low',
          pressureLevel: 'normal',
        })
      ).toBe(2);
    });

    it('normal momentum → 3 posts/week (base)', () => {
      expect(
        determinePostsPerWeek({
          campaignDurationWeeks: 6,
          momentumLevel: 'normal',
          pressureLevel: 'normal',
        })
      ).toBe(3);
    });

    it('high momentum → 5 posts/week (base)', () => {
      expect(
        determinePostsPerWeek({
          campaignDurationWeeks: 6,
          momentumLevel: 'high',
          pressureLevel: 'normal',
        })
      ).toBe(5);
    });

    it('pressure modifier: low pressure → -1 post', () => {
      expect(
        determinePostsPerWeek({
          campaignDurationWeeks: 6,
          momentumLevel: 'normal',
          pressureLevel: 'low',
        })
      ).toBe(2);
      expect(
        determinePostsPerWeek({
          campaignDurationWeeks: 6,
          momentumLevel: 'high',
          pressureLevel: 'low',
        })
      ).toBe(4);
    });

    it('pressure modifier: high pressure → +1 post', () => {
      expect(
        determinePostsPerWeek({
          campaignDurationWeeks: 6,
          momentumLevel: 'normal',
          pressureLevel: 'high',
        })
      ).toBe(4);
      expect(
        determinePostsPerWeek({
          campaignDurationWeeks: 6,
          momentumLevel: 'high',
          pressureLevel: 'high',
        })
      ).toBe(6);
    });

    it('values clamp between 2 and 7', () => {
      expect(
        determinePostsPerWeek({
          campaignDurationWeeks: 6,
          momentumLevel: 'low',
          pressureLevel: 'low',
        })
      ).toBe(2);
      expect(
        determinePostsPerWeek({
          campaignDurationWeeks: 6,
          momentumLevel: 'high',
          pressureLevel: 'high',
        })
      ).toBe(6);
      expect(
        determinePostsPerWeek({
          campaignDurationWeeks: 6,
          momentumLevel: 'high',
          pressureLevel: 'high',
        })
      ).toBeLessThanOrEqual(7);
    });

    it('example: high momentum + normal pressure → 5 posts/week', () => {
      const result = determinePostsPerWeek({
        campaignDurationWeeks: 6,
        momentumLevel: 'high',
        pressureLevel: 'normal',
      });
      expect(result).toBe(5);
    });
  });

  describe('momentumScoreToLevel', () => {
    it('0–0.4 → low', () => {
      expect(momentumScoreToLevel(0)).toBe('low');
      expect(momentumScoreToLevel(0.3)).toBe('low');
    });
    it('0.4–0.7 → normal', () => {
      expect(momentumScoreToLevel(0.5)).toBe('normal');
    });
    it('0.7–1 → high', () => {
      expect(momentumScoreToLevel(0.7)).toBe('high');
      expect(momentumScoreToLevel(1)).toBe('high');
    });
    it('null/undefined → normal', () => {
      expect(momentumScoreToLevel(null)).toBe('normal');
      expect(momentumScoreToLevel(undefined)).toBe('normal');
    });
  });

  describe('pressureConfigToLevel', () => {
    it('high/urgent → high', () => {
      expect(pressureConfigToLevel('high')).toBe('high');
      expect(pressureConfigToLevel('urgent')).toBe('high');
    });
    it('low/relaxed → low', () => {
      expect(pressureConfigToLevel('low')).toBe('low');
      expect(pressureConfigToLevel('relaxed')).toBe('low');
    });
    it('default → normal', () => {
      expect(pressureConfigToLevel(undefined)).toBe('normal');
      expect(pressureConfigToLevel('')).toBe('normal');
    });
  });
});

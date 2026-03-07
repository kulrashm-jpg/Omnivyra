/**
 * Unit tests for Weekly Slot Normalization
 */
import {
  allocatePostingDays,
  normalizeSlotsToCount,
  buildPlaceholderTopicTexts,
  type SlotLike,
} from '../../services/weeklySlotNormalization';

describe('weeklySlotNormalization', () => {
  describe('allocatePostingDays', () => {
    it('2 posts → Tue, Thu', () => {
      expect(allocatePostingDays(2)).toEqual([2, 4]);
    });

    it('3 posts → Mon, Wed, Fri', () => {
      expect(allocatePostingDays(3)).toEqual([1, 3, 5]);
    });

    it('4 posts → Mon, Tue, Thu, Fri', () => {
      expect(allocatePostingDays(4)).toEqual([1, 2, 4, 5]);
    });

    it('5 posts → Mon–Fri', () => {
      expect(allocatePostingDays(5)).toEqual([1, 2, 3, 4, 5]);
    });

    it('6 posts → Mon–Fri + Sat', () => {
      expect(allocatePostingDays(6)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('7 posts → Mon–Sun', () => {
      expect(allocatePostingDays(7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('clamps invalid values to valid range', () => {
      expect(allocatePostingDays(0)).toEqual([2, 4]); // clamped to 2 posts
      expect(allocatePostingDays(1)).toEqual([2, 4]); // clamped to 2 posts
      expect(allocatePostingDays(8)).toEqual([1, 2, 3, 4, 5, 6, 7]); // clamped to 7
    });
  });

  describe('normalizeSlotsToCount', () => {
    const createPlaceholder = (dayIndex: number, dayName: string, index: number): SlotLike => ({
      day_index: dayIndex,
      day_name: dayName,
      short_topic: 'Content topic',
      full_topic: 'Content topic description',
    });

    it('ensures exact slot count when already correct', () => {
      const slots: SlotLike[] = [
        { day_index: 1, short_topic: 'A', full_topic: 'A desc' },
        { day_index: 3, short_topic: 'B', full_topic: 'B desc' },
        { day_index: 5, short_topic: 'C', full_topic: 'C desc' },
      ];
      const result = normalizeSlotsToCount(slots, 3, createPlaceholder);
      expect(result).toHaveLength(3);
      expect(result[0]?.short_topic).toBe('A');
      expect(result[1]?.short_topic).toBe('B');
      expect(result[2]?.short_topic).toBe('C');
    });

    it('assigns correct posting days to slots', () => {
      const slots: SlotLike[] = [
        { day_index: 1, short_topic: 'A', full_topic: 'A desc' },
        { day_index: 1, short_topic: 'B', full_topic: 'B desc' },
        { day_index: 1, short_topic: 'C', full_topic: 'C desc' },
      ];
      const result = normalizeSlotsToCount(slots, 3, createPlaceholder);
      expect(result).toHaveLength(3);
      expect(result[0]?.day_index).toBe(1);
      expect(result[0]?.day_name).toBe('Monday');
      expect(result[1]?.day_index).toBe(3);
      expect(result[1]?.day_name).toBe('Wednesday');
      expect(result[2]?.day_index).toBe(5);
      expect(result[2]?.day_name).toBe('Friday');
    });

    it('trims excess slots', () => {
      const slots: SlotLike[] = [
        { day_index: 1, short_topic: 'A', full_topic: 'A desc' },
        { day_index: 2, short_topic: 'B', full_topic: 'B desc' },
        { day_index: 3, short_topic: 'C', full_topic: 'C desc' },
        { day_index: 4, short_topic: 'D', full_topic: 'D desc' },
        { day_index: 5, short_topic: 'E', full_topic: 'E desc' },
      ];
      const result = normalizeSlotsToCount(slots, 3, createPlaceholder);
      expect(result).toHaveLength(3);
      expect(result[0]?.short_topic).toBe('A');
      expect(result[1]?.short_topic).toBe('B');
      expect(result[2]?.short_topic).toBe('C');
    });

    it('fills missing slots with placeholders', () => {
      const slots: SlotLike[] = [
        { day_index: 1, short_topic: 'A', full_topic: 'A desc' },
      ];
      const result = normalizeSlotsToCount(slots, 3, createPlaceholder);
      expect(result).toHaveLength(3);
      expect(result[0]?.short_topic).toBe('A');
      expect(result[1]?.short_topic).toBe('Content topic');
      expect(result[2]?.short_topic).toBe('Content topic');
    });

    it('placeholders have correct day assignments', () => {
      const slots: SlotLike[] = [
        { day_index: 1, short_topic: 'A', full_topic: 'A desc' },
      ];
      const result = normalizeSlotsToCount(slots, 3, createPlaceholder);
      expect(result[0]?.day_index).toBe(1);
      expect(result[0]?.day_name).toBe('Monday');
      expect(result[1]?.day_index).toBe(3);
      expect(result[1]?.day_name).toBe('Wednesday');
      expect(result[2]?.day_index).toBe(5);
      expect(result[2]?.day_name).toBe('Friday');
    });

    it('fills entirely empty slots to target count', () => {
      const slots: SlotLike[] = [];
      const result = normalizeSlotsToCount(slots, 5, createPlaceholder);
      expect(result).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        expect(result[i]?.short_topic).toBe('Content topic');
        expect(result[i]?.full_topic).toBe('Content topic description');
      }
      expect(result.map((s) => s.day_index)).toEqual([1, 2, 3, 4, 5]);
    });

    it('clamps target count to 2–7', () => {
      const slots: SlotLike[] = [
        { day_index: 1, short_topic: 'A', full_topic: 'A desc' },
      ];
      const result1 = normalizeSlotsToCount(slots, 1, createPlaceholder);
      expect(result1).toHaveLength(2);

      const manySlots = Array.from({ length: 10 }, (_, i) => ({
        day_index: (i % 7) + 1,
        short_topic: `Topic ${i}`,
        full_topic: `Desc ${i}`,
      }));
      const result2 = normalizeSlotsToCount(manySlots, 10, createPlaceholder);
      expect(result2).toHaveLength(7);
    });

    it('placeholders include campaign theme when provided', () => {
      const themeCreatePlaceholder = (dayIndex: number, dayName: string, index: number, theme?: string): SlotLike => {
        const { short_topic, full_topic } = buildPlaceholderTopicTexts(theme);
        return { day_index: dayIndex, day_name: dayName, short_topic, full_topic };
      };
      const slots: SlotLike[] = [{ day_index: 1, short_topic: 'A', full_topic: 'A desc' }];
      const result = normalizeSlotsToCount(slots, 3, themeCreatePlaceholder, 'AI Marketing');
      expect(result).toHaveLength(3);
      expect(result[0]?.short_topic).toBe('A');
      expect(result[1]?.short_topic).toBe('AI Marketing insight');
      expect(result[1]?.full_topic).toBe('A key insight related to AI Marketing');
      expect(result[2]?.short_topic).toBe('AI Marketing insight');
      expect(result[2]?.full_topic).toBe('A key insight related to AI Marketing');
    });

    it('fallback works when theme missing', () => {
      const themeCreatePlaceholder = (dayIndex: number, dayName: string, index: number, theme?: string): SlotLike => {
        const { short_topic, full_topic } = buildPlaceholderTopicTexts(theme);
        return { day_index: dayIndex, day_name: dayName, short_topic, full_topic };
      };
      const slots: SlotLike[] = [];
      const result = normalizeSlotsToCount(slots, 2, themeCreatePlaceholder);
      expect(result).toHaveLength(2);
      expect(result[0]?.short_topic).toBe('Campaign insight');
      expect(result[0]?.full_topic).toBe('Insight related to the campaign theme');
      expect(result[1]?.short_topic).toBe('Campaign insight');
      expect(result[1]?.full_topic).toBe('Insight related to the campaign theme');
    });
  });

  describe('buildPlaceholderTopicTexts', () => {
    it('returns theme-aligned texts when theme provided', () => {
      const { short_topic, full_topic } = buildPlaceholderTopicTexts('Content Strategy');
      expect(short_topic).toBe('Content Strategy insight');
      expect(full_topic).toBe('A key insight related to Content Strategy');
    });

    it('returns fallback when theme is undefined', () => {
      const { short_topic, full_topic } = buildPlaceholderTopicTexts(undefined);
      expect(short_topic).toBe('Campaign insight');
      expect(full_topic).toBe('Insight related to the campaign theme');
    });

    it('returns fallback when theme is empty string', () => {
      const { short_topic, full_topic } = buildPlaceholderTopicTexts('');
      expect(short_topic).toBe('Campaign insight');
      expect(full_topic).toBe('Insight related to the campaign theme');
    });
  });
});

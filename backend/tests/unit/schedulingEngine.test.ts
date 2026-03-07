/**
 * Unit tests for Scheduling Intelligence Engine
 */
import {
  assignPostingTimes,
  type SlotInput,
  type SchedulingOptions,
} from '../../services/schedulingEngine';

describe('schedulingEngine', () => {
  describe('assignPostingTimes', () => {
    it('assigns correct platform time', () => {
      const slots: SlotInput[] = [
        { day: 'Wed', day_index: 3, platform: 'linkedin' },
      ];
      const result = assignPostingTimes(slots);
      expect(result).toHaveLength(1);
      expect(result[0]?.time).toBe('09:30');
      expect(result[0]?.day).toBe('Wed');
      expect(result[0]?.platform).toBe('linkedin');
    });

    it('respects existing time', () => {
      const slots: SlotInput[] = [
        { day: 'Wed', day_index: 3, platform: 'linkedin', time: '14:00' },
      ];
      const result = assignPostingTimes(slots);
      expect(result[0]?.time).toBe('14:00');
    });

    it('prevents same-day collisions', () => {
      const slots: SlotInput[] = [
        { day: 'Wed', day_index: 3, platform: 'linkedin' },
        { day: 'Wed', day_index: 3, platform: 'linkedin' },
        { day: 'Wed', day_index: 3, platform: 'linkedin' },
      ];
      const result = assignPostingTimes(slots);
      expect(result[0]?.time).toBe('09:30');
      expect(result[1]?.time).toBe('10:30');
      expect(result[2]?.time).toBe('11:30');
    });

    it('fallback works for unknown platform', () => {
      const slots: SlotInput[] = [
        { day: 'Mon', day_index: 1, platform: 'unknown_platform' },
      ];
      const result = assignPostingTimes(slots);
      expect(result[0]?.time).toBe('10:00');
    });

    it('uses platform times for linkedin, x, blog, youtube', () => {
      const slots: SlotInput[] = [
        { day: 'Mon', day_index: 1, platform: 'linkedin' },
        { day: 'Tue', day_index: 2, platform: 'x' },
        { day: 'Wed', day_index: 3, platform: 'blog' },
        { day: 'Thu', day_index: 4, platform: 'youtube' },
      ];
      const result = assignPostingTimes(slots);
      expect(result[0]?.time).toBe('09:30');
      expect(result[1]?.time).toBe('13:00');
      expect(result[2]?.time).toBe('08:00');
      expect(result[3]?.time).toBe('18:00');
    });

    it('example: single slot output', () => {
      const input = { day: 'Wed', platform: 'linkedin' };
      const result = assignPostingTimes([input]);
      expect(result[0]).toEqual({
        day: 'Wed',
        platform: 'linkedin',
        time: '09:30',
      });
    });

    it('example: two same-day slots staggered', () => {
      const slots: SlotInput[] = [
        { day: 'Wed', day_index: 3, platform: 'linkedin' },
        { day: 'Wed', day_index: 3, platform: 'linkedin' },
      ];
      const result = assignPostingTimes(slots);
      expect(result[0]).toMatchObject({
        day: 'Wed',
        platform: 'linkedin',
        time: '09:30',
      });
      expect(result[1]).toMatchObject({
        day: 'Wed',
        platform: 'linkedin',
        time: '10:30',
      });
    });

    it('preserves slot order across multiple days', () => {
      const slots: SlotInput[] = [
        { day: 'Wed', day_index: 3, platform: 'linkedin' },
        { day: 'Thu', day_index: 4, platform: 'x' },
        { day: 'Wed', day_index: 3, platform: 'blog' },
      ];
      const result = assignPostingTimes(slots);
      expect(result[0]?.day_index).toBe(3);
      expect(result[0]?.platform).toBe('linkedin');
      expect(result[0]?.time).toBe('09:30');
      expect(result[1]?.day_index).toBe(4);
      expect(result[1]?.platform).toBe('x');
      expect(result[1]?.time).toBe('13:00');
      expect(result[2]?.day_index).toBe(3);
      expect(result[2]?.platform).toBe('blog');
      expect(result[2]?.time).toBe('10:30');
    });

    it('twitter normalizes to x and gets x platform time', () => {
      const slots: SlotInput[] = [
        { day: 'Mon', day_index: 1, platform: 'twitter' },
      ];
      const result = assignPostingTimes(slots);
      expect(result[0]?.time).toBe('13:00');
    });

    it('override replaces default platform time', () => {
      const slots: SlotInput[] = [
        { day: 'Wed', day_index: 3, platform: 'linkedin' },
      ];
      const options: SchedulingOptions = {
        platformTimeOverrides: { linkedin: '11:00' },
      };
      const result = assignPostingTimes(slots, options);
      expect(result[0]?.time).toBe('11:00');
      expect(result[0]?.platform).toBe('linkedin');
    });

    it('fallback still works for unknown platform', () => {
      const slots: SlotInput[] = [
        { day: 'Mon', day_index: 1, platform: 'unknown_platform' },
      ];
      const options: SchedulingOptions = {
        platformTimeOverrides: { linkedin: '11:00' },
      };
      const result = assignPostingTimes(slots, options);
      expect(result[0]?.time).toBe('10:00');
    });

    it('collision staggering still applies with overrides', () => {
      const slots: SlotInput[] = [
        { day: 'Wed', day_index: 3, platform: 'linkedin' },
        { day: 'Wed', day_index: 3, platform: 'linkedin' },
        { day: 'Wed', day_index: 3, platform: 'linkedin' },
      ];
      const options: SchedulingOptions = {
        platformTimeOverrides: { linkedin: '11:00' },
      };
      const result = assignPostingTimes(slots, options);
      expect(result[0]?.time).toBe('11:00');
      expect(result[1]?.time).toBe('12:00');
      expect(result[2]?.time).toBe('13:00');
    });

    it('deterministic behavior maintained with overrides', () => {
      const slots: SlotInput[] = [
        { day: 'Wed', day_index: 3, platform: 'x' },
      ];
      const options: SchedulingOptions = {
        platformTimeOverrides: { x: '14:30' },
      };
      const r1 = assignPostingTimes(slots, options);
      const r2 = assignPostingTimes(slots, options);
      expect(r1).toEqual(r2);
      expect(r1[0]?.time).toBe('14:30');
    });
  });
});

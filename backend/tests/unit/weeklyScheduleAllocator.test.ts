/**
 * Unit tests for weeklyScheduleAllocator — single source of truth for scheduling.
 */

import { assignWeeklySchedule, applyScheduleDefaults, SCHEDULE_DEFAULTS } from '../../services/weeklyScheduleAllocator';

describe('weeklyScheduleAllocator', () => {
  describe('assignWeeklySchedule', () => {
    it('assigns topic_code, content_code, scheduled_day, scheduled_time to slots', () => {
      const week = {
        week_number: 1,
        execution_items: [
          {
            content_type: 'post',
            selected_platforms: ['linkedin'],
            topic_slots: [
              { topic: 'AI adoption barriers', intent: { objective: 'x', cta_type: 'y', target_audience: 'z' } },
              { topic: 'AI adoption barriers', intent: { objective: 'x', cta_type: 'y', target_audience: 'z' } },
              { topic: 'Remote work trends', intent: { objective: 'x', cta_type: 'y', target_audience: 'z' } },
            ],
          },
        ],
      };
      assignWeeklySchedule({ weeklyActivities: week });
      const slots = week.execution_items![0]!.topic_slots!;
      expect(slots[0]!.topic_code).toBe('A');
      expect(slots[0]!.content_code).toBe('A1');
      expect(slots[0]!.repurpose_index).toBe(1);
      expect(slots[0]!.repurpose_total).toBe(2);
      expect(slots[1]!.topic_code).toBe('A');
      expect(slots[1]!.content_code).toBe('A2');
      expect(slots[2]!.topic_code).toBe('B');
      expect(slots[2]!.content_code).toBe('B1');
      expect(slots[0]!.scheduled_day).toBeGreaterThanOrEqual(1);
      expect(slots[0]!.scheduled_day).toBeLessThanOrEqual(7);
      expect(['08:00', '09:00']).toContain(slots[0]!.scheduled_time);
      expect(slots[0]!.timezone_mode).toBe('regional');
    });

    it('avoids same topic on same day', () => {
      const week = {
        week_number: 1,
        execution_items: [
          {
            content_type: 'post',
            selected_platforms: ['linkedin'],
            topic_slots: [
              { topic: 'Topic A', intent: { objective: 'x', cta_type: 'y', target_audience: 'z' } },
              { topic: 'Topic A', intent: { objective: 'x', cta_type: 'y', target_audience: 'z' } },
            ],
          },
        ],
      };
      assignWeeklySchedule({ weeklyActivities: week });
      const slots = week.execution_items![0]!.topic_slots!;
      const dayA1 = slots[0]!.scheduled_day;
      const dayA2 = slots[1]!.scheduled_day;
      expect(dayA1).not.toBe(dayA2);
    });

    it('applies target_regions from input', () => {
      const week = {
        week_number: 1,
        execution_items: [
          {
            content_type: 'post',
            selected_platforms: ['linkedin'],
            topic_slots: [
              { topic: 'Test', intent: { objective: 'x', cta_type: 'y', target_audience: 'z' } },
            ],
          },
        ],
      };
      assignWeeklySchedule({ weeklyActivities: week, region: ['india', 'usa'] });
      const slot = week.execution_items![0]!.topic_slots![0]!;
      expect(slot.target_regions).toEqual(['india', 'usa']);
    });
  });

  describe('applyScheduleDefaults', () => {
    it('fills missing fields with defaults', () => {
      const slot = { topic: 'x', intent: {} };
      const out = applyScheduleDefaults(slot);
      expect(out.scheduled_day).toBeNull();
      expect(out.scheduled_time).toBeNull();
      expect(out.target_regions).toEqual([]);
      expect(out.timezone_mode).toBe('regional');
      expect(out.repurpose_index).toBe(1);
      expect(out.repurpose_total).toBe(1);
    });

    it('uses day_index as scheduled_day fallback', () => {
      const slot = { topic: 'x', day_index: 3 };
      const out = applyScheduleDefaults(slot);
      expect(out.scheduled_day).toBe(3);
    });
  });
});

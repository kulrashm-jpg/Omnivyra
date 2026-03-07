/**
 * Unit tests for weeklyPlanEditEngine
 */

import { applyWeeklyPlanEdits } from '../../services/weeklyPlanEditEngine';

function makeWeek(execItems: { topic_slots: any[] }[]) {
  return {
    week: 1,
    theme: 'Test Week',
    execution_items: execItems,
  };
}

function makeSlot(
  contentCode: string,
  topicCode: string,
  day: number,
  time = '09:00'
) {
  return {
    content_code: contentCode,
    topic_code: topicCode,
    topic: `Topic ${topicCode}`,
    scheduled_day: day,
    scheduled_time: time,
    repurpose_index: 1,
    repurpose_total: 1,
  };
}

describe('weeklyPlanEditEngine', () => {
  describe('move', () => {
    it('updates scheduled_day and scheduled_time', () => {
      const week = makeWeek([
        {
          topic_slots: [makeSlot('A1', 'A', 1), makeSlot('A2', 'A', 3)],
        },
      ]);
      const result = applyWeeklyPlanEdits(week, [
        { type: 'move', content_code: 'A1', day: 5, time: '14:00' },
      ]);
      expect(result.success).toBe(true);
      expect(result.applied).toBe(1);
      const slot = (week as any).execution_items[0].topic_slots[0];
      expect(slot.scheduled_day).toBe(5);
      expect(slot.scheduled_time).toBe('14:00');
    });
  });

  describe('swap', () => {
    it('exchanges day and time between two slots', () => {
      const week = makeWeek([
        {
          topic_slots: [
            makeSlot('A1', 'A', 1, '09:00'),
            makeSlot('B1', 'B', 5, '14:00'),
          ],
        },
      ]);
      const result = applyWeeklyPlanEdits(week, [
        { type: 'swap', content_code_a: 'A1', content_code_b: 'B1' },
      ]);
      expect(result.success).toBe(true);
      expect(result.applied).toBe(1);
      expect((week as any).execution_items[0].topic_slots[0].scheduled_day).toBe(5);
      expect((week as any).execution_items[0].topic_slots[0].scheduled_time).toBe('14:00');
      expect((week as any).execution_items[0].topic_slots[1].scheduled_day).toBe(1);
      expect((week as any).execution_items[0].topic_slots[1].scheduled_time).toBe('09:00');
    });
  });

  describe('delay', () => {
    it('increments scheduled_day', () => {
      const week = makeWeek([
        { topic_slots: [makeSlot('A1', 'A', 2)] },
      ]);
      const result = applyWeeklyPlanEdits(week, [
        { type: 'delay', content_code: 'A1', days: 1 },
      ]);
      expect(result.success).toBe(true);
      expect((week as any).execution_items[0].topic_slots[0].scheduled_day).toBe(3);
    });

    it('clamps day to 7', () => {
      const week = makeWeek([
        { topic_slots: [makeSlot('A1', 'A', 6)] },
      ]);
      applyWeeklyPlanEdits(week, [
        { type: 'delay', content_code: 'A1', days: 5 },
      ]);
      expect((week as any).execution_items[0].topic_slots[0].scheduled_day).toBe(7);
    });
  });

  describe('advance', () => {
    it('decrements scheduled_day', () => {
      const week = makeWeek([
        { topic_slots: [makeSlot('A1', 'A', 4)] },
      ]);
      const result = applyWeeklyPlanEdits(week, [
        { type: 'advance', content_code: 'A1', days: 1 },
      ]);
      expect(result.success).toBe(true);
      expect((week as any).execution_items[0].topic_slots[0].scheduled_day).toBe(3);
    });
  });

  describe('delete', () => {
    it('removes slot and recomputes repurpose', () => {
      const week = makeWeek([
        {
          topic_slots: [
            makeSlot('A1', 'A', 1),
            makeSlot('A2', 'A', 3),
            makeSlot('A3', 'A', 5),
          ],
        },
      ]);
      (week as any).execution_items[0].topic_slots[1].repurpose_index = 2;
      (week as any).execution_items[0].topic_slots[1].repurpose_total = 3;
      (week as any).execution_items[0].topic_slots[2].repurpose_index = 3;
      (week as any).execution_items[0].topic_slots[2].repurpose_total = 3;

      const result = applyWeeklyPlanEdits(week, [
        { type: 'delete', content_code: 'A2' },
      ]);
      expect(result.success).toBe(true);
      expect((week as any).execution_items[0].topic_slots).toHaveLength(2);
      expect((week as any).execution_items[0].topic_slots[0].content_code).toBe('A1');
      expect((week as any).execution_items[0].topic_slots[1].content_code).toBe('A3');
      expect((week as any).execution_items[0].topic_slots[0].repurpose_total).toBe(2);
      expect((week as any).execution_items[0].topic_slots[1].repurpose_total).toBe(2);
    });
  });

  describe('add', () => {
    it('adds new slot under topic B', () => {
      const week = makeWeek([
        { topic_slots: [makeSlot('A1', 'A', 1)] },
        { topic_slots: [makeSlot('B1', 'B', 2), makeSlot('B2', 'B', 4)] },
      ]);
      const result = applyWeeklyPlanEdits(week, [
        { type: 'add', topic_code: 'B', content_type: 'post' },
      ]);
      expect(result.success).toBe(true);
      const bSlots = (week as any).execution_items[1].topic_slots;
      expect(bSlots).toHaveLength(3);
      expect(bSlots[2].content_code).toBe('B3');
      expect(bSlots[2].scheduled_day).toBeGreaterThanOrEqual(1);
      expect(bSlots[2].scheduled_day).toBeLessThanOrEqual(7);
    });
  });

  describe('not found', () => {
    it('returns error when content_code not found', () => {
      const week = makeWeek([
        { topic_slots: [makeSlot('A1', 'A', 1)] },
      ]);
      const result = applyWeeklyPlanEdits(week, [
        { type: 'move', content_code: 'Z99', day: 5, time: '09:00' },
      ]);
      expect(result.applied).toBe(0);
      expect(result.errors).toContain('Activity Z99 not found');
    });
  });
});

/**
 * Unit tests for weeklyPlanCommandParser
 */

import { parseWeeklyPlanCommands } from '../../services/weeklyPlanCommandParser';

describe('weeklyPlanCommandParser', () => {
  describe('move', () => {
    it('parses "Move A3 to Friday morning"', () => {
      const ops = parseWeeklyPlanCommands('Move A3 to Friday morning');
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({
        type: 'move',
        content_code: 'A3',
        day: 5,
        time: '09:00',
      });
    });

    it('parses "move a2 to wed 14:00"', () => {
      const ops = parseWeeklyPlanCommands('move a2 to wed 14:00');
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({
        type: 'move',
        content_code: 'A2',
        day: 3,
        time: '14:00',
      });
    });
  });

  describe('swap', () => {
    it('parses "Swap A2 and B1"', () => {
      const ops = parseWeeklyPlanCommands('Swap A2 and B1');
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({
        type: 'swap',
        content_code_a: 'A2',
        content_code_b: 'B1',
      });
    });
  });

  describe('delay', () => {
    it('parses "Delay A1 by 1 day"', () => {
      const ops = parseWeeklyPlanCommands('Delay A1 by 1 day');
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({
        type: 'delay',
        content_code: 'A1',
        days: 1,
      });
    });

    it('parses "delay B2 by 2 days"', () => {
      const ops = parseWeeklyPlanCommands('delay B2 by 2 days');
      expect(ops[0]).toMatchObject({ type: 'delay', content_code: 'B2', days: 2 });
    });
  });

  describe('advance', () => {
    it('parses "Advance A1 by 1 day"', () => {
      const ops = parseWeeklyPlanCommands('Advance A1 by 1 day');
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({
        type: 'advance',
        content_code: 'A1',
        days: 1,
      });
    });
  });

  describe('delete', () => {
    it('parses "Delete B2"', () => {
      const ops = parseWeeklyPlanCommands('Delete B2');
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({
        type: 'delete',
        content_code: 'B2',
      });
    });

    it('parses "remove A3"', () => {
      const ops = parseWeeklyPlanCommands('remove A3');
      expect(ops[0]).toMatchObject({ type: 'delete', content_code: 'A3' });
    });
  });

  describe('add', () => {
    it('parses "Add Instagram post under topic B"', () => {
      const ops = parseWeeklyPlanCommands('Add Instagram post under topic B');
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({
        type: 'add',
        topic_code: 'B',
        platform: 'instagram',
      });
    });

    it('parses "add post under B"', () => {
      const ops = parseWeeklyPlanCommands('add post under B');
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({
        type: 'add',
        topic_code: 'B',
      });
    });
  });

  describe('empty/invalid', () => {
    it('returns empty array for empty string', () => {
      expect(parseWeeklyPlanCommands('')).toEqual([]);
    });

    it('returns empty array for unparseable text', () => {
      expect(parseWeeklyPlanCommands('hello world')).toEqual([]);
    });
  });
});

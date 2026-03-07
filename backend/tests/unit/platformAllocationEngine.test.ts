/**
 * Unit tests for Platform Allocation Engine
 */
import { allocatePlatforms, type SlotInput, type AllocationContext } from '../../services/platformAllocationEngine';

describe('platformAllocationEngine', () => {
  describe('allocatePlatforms', () => {
    it('assigns platform based on content_type', () => {
      const slots: SlotInput[] = [
        { day: 'Mon', content_type: 'carousel' },
        { day: 'Wed', content_type: 'video' },
        { day: 'Fri', content_type: 'thread' },
      ];
      const result = allocatePlatforms(slots, {});
      expect(result[0]?.platform).toBe('linkedin');
      expect(result[1]?.platform).toBe('youtube');
      expect(result[2]?.platform).toBe('x');
    });

    it('respects existing platform', () => {
      const slots: SlotInput[] = [
        { day: 'Mon', content_type: 'video', platform: 'instagram' },
      ];
      const result = allocatePlatforms(slots, {});
      expect(result[0]?.platform).toBe('instagram');
    });

    it('defaults to linkedin when content_type unknown', () => {
      const slots: SlotInput[] = [
        { day: 'Tue', content_type: 'unknown_type' },
        { day: 'Thu', content_type: '' },
      ];
      const result = allocatePlatforms(slots, {});
      expect(result[0]?.platform).toBe('linkedin');
      expect(result[1]?.platform).toBe('linkedin');
    });

    it('maps thought_leadership to linkedin', () => {
      const slots: SlotInput[] = [{ day: 'Mon', content_type: 'thought_leadership' }];
      const result = allocatePlatforms(slots, {});
      expect(result[0]?.platform).toBe('linkedin');
    });

    it('maps short_insight and thread to x (twitter)', () => {
      const slots: SlotInput[] = [
        { day: 'Mon', content_type: 'short_insight' },
        { day: 'Wed', content_type: 'thread' },
      ];
      const result = allocatePlatforms(slots, {});
      expect(result[0]?.platform).toBe('x');
      expect(result[1]?.platform).toBe('x');
    });

    it('maps long_form to blog', () => {
      const slots: SlotInput[] = [{ day: 'Mon', content_type: 'long_form' }];
      const result = allocatePlatforms(slots, {});
      expect(result[0]?.platform).toBe('blog');
    });

    it('example: carousel slot gets linkedin', () => {
      const slots: SlotInput[] = [{ day: 'Wed', content_type: 'carousel' }];
      const result = allocatePlatforms(slots, {});
      expect(result[0]).toMatchObject({
        day: 'Wed',
        content_type: 'carousel',
        platform: 'linkedin',
      });
    });

    it('uses companyPreferredPlatforms when mapping not in preferred list', () => {
      const slots: SlotInput[] = [{ day: 'Mon', content_type: 'post' }];
      const context: AllocationContext = {
        companyPreferredPlatforms: ['instagram', 'x'],
      };
      const result = allocatePlatforms(slots, context);
      expect(result[0]?.platform).toBe('instagram');
    });

    it('normalizes twitter to x', () => {
      const slots: SlotInput[] = [{ day: 'Mon', content_type: 'post', platform: 'twitter' }];
      const result = allocatePlatforms(slots, {});
      expect(result[0]?.platform).toBe('x');
    });
  });
});

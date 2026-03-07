/**
 * Unit tests for Repurpose Graph Engine
 */
import {
  expandRepurposeGraph,
  shiftDay,
  type RepurposeSlotInput,
} from '../../services/repurposeGraphEngine';

describe('repurposeGraphEngine', () => {
  describe('shiftDay', () => {
    it('Mon +1 → Tue', () => {
      expect(shiftDay('Mon', 1).day).toBe('Tue');
      expect(shiftDay('Monday', 1).day).toBe('Tue');
    });
    it('Mon +2 → Wed', () => {
      expect(shiftDay('Mon', 2).day).toBe('Wed');
    });
    it('Fri +1 → Mon', () => {
      expect(shiftDay('Fri', 1).day).toBe('Mon');
      expect(shiftDay('Friday', 1).day).toBe('Mon');
    });
    it('Fri +2 → Tue', () => {
      expect(shiftDay('Fri', 2).day).toBe('Tue');
    });
    it('weekend input normalizes to Mon', () => {
      expect(shiftDay('Sat', 0).day).toBe('Mon');
      expect(shiftDay('Sun', 0).day).toBe('Mon');
      expect(shiftDay('Saturday', 0).day).toBe('Mon');
      expect(shiftDay('Sunday', 0).day).toBe('Mon');
    });
    it('Sun +1 → Tue (weekend treated as Mon, then +1 business day)', () => {
      expect(shiftDay('Sun', 1).day).toBe('Tue');
    });
  });

  describe('expandRepurposeGraph', () => {
    it('blog expands into linkedin_post + thread', () => {
      const slots: RepurposeSlotInput[] = [
        { content_type: 'blog', short_topic: 'Core idea', platform: 'tiktok' },
      ];
      const result = expandRepurposeGraph(slots, {
        densityLevel: 'normal',
        signals: { high_performing_platforms: ['tiktok'] },
      });
      expect(result).toHaveLength(3);
      expect(result[0]?.content_type).toBe('blog');
      expect(result[1]?.content_type).toBe('linkedin_post');
      expect(result[2]?.content_type).toBe('thread');
    });

    it('repurposed slots shift to next day', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'blog', day: 'Mon', day_index: 1, day_name: 'Monday' }];
      const result = expandRepurposeGraph(slots, {
        signals: { high_performing_content_types: ['blog'] },
      });
      expect(result[0]?.day).toBe('Mon');
      expect(result[0]?.day_index).toBe(1);
      expect(result[1]?.day).toBe('Tue');
      expect(result[1]?.day_index).toBe(2);
      expect(result[2]?.day).toBe('Wed');
      expect(result[2]?.day_index).toBe(3);
    });

    it('multiple repurposes shift sequentially (skips weekends)', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'blog', day: 'Wed' }];
      const result = expandRepurposeGraph(slots, {
        signals: { high_performing_content_types: ['blog'] },
      });
      expect(result[0]?.day).toBe('Wed');
      expect(result[1]?.day).toBe('Thu');
      expect(result[2]?.day).toBe('Fri');
      expect(result[3]?.day).toBe('Mon');
    });

    it('repurposed slots never fall on Sat or Sun', () => {
      const slots: RepurposeSlotInput[] = [
        { content_type: 'blog', day: 'Mon' },
        { content_type: 'blog', day: 'Fri' },
      ];
      const result = expandRepurposeGraph(slots, {
        signals: { high_performing_content_types: ['blog'] },
      });
      const days = result.map((s) => s.day);
      expect(days).not.toContain('Sat');
      expect(days).not.toContain('Sun');
    });

    it('densityLevel=low limits expansion to 1', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'blog' }];
      const result = expandRepurposeGraph(slots, { densityLevel: 'low' });
      expect(result).toHaveLength(2);
      expect(result[0]?.content_type).toBe('blog');
      expect(result[1]?.content_type).toBe('linkedin_post');
    });

    it('densityLevel=normal limits to 2', () => {
      const slots: RepurposeSlotInput[] = [
        { content_type: 'blog', platform: 'tiktok' },
      ];
      const result = expandRepurposeGraph(slots, {
        densityLevel: 'normal',
        signals: { high_performing_platforms: ['tiktok'] },
      });
      expect(result).toHaveLength(3);
      expect(result.map((s) => s.content_type)).toEqual(['blog', 'linkedin_post', 'thread']);
    });

    it('amplification allows 3 repurpose variants when density guard not applied', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'blog', day: 'Mon' }];
      const result = expandRepurposeGraph(slots, {
        signals: { high_performing_content_types: ['blog'] },
      });
      expect(result).toHaveLength(4);
      expect(result.map((s) => s.content_type)).toEqual(['blog', 'linkedin_post', 'thread', 'carousel']);
      expect(result.map((s) => s.day)).toEqual(['Mon', 'Tue', 'Wed', 'Thu']);
    });

    it('density guard: high density caps repurpose at 1', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'blog', day: 'Mon' }];
      const result = expandRepurposeGraph(slots, {
        densityLevel: 'high',
        signals: { high_performing_content_types: ['blog'] },
      });
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.content_type)).toEqual(['blog', 'linkedin_post']);
    });

    it('repurpose_of preserved on derived slots', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'blog', id: 'orig-1' }];
      const result = expandRepurposeGraph(slots, {
        densityLevel: 'normal',
        signals: { high_performing_content_types: ['blog'] },
      });
      expect(result[0]).not.toHaveProperty('repurpose_of');
      expect(result[1]?.repurpose_of).toBe('orig-1');
      expect(result[2]?.repurpose_of).toBe('orig-1');
    });

    it('thread expands into carousel', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'thread', short_topic: 'Thread idea' }];
      const result = expandRepurposeGraph(slots, {
        signals: { high_performing_content_types: ['thread'] },
      });
      expect(result).toHaveLength(2);
      expect(result[0]?.content_type).toBe('thread');
      expect(result[1]?.content_type).toBe('carousel');
    });

    it('carousel expands into short_video', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'carousel', short_topic: 'Carousel idea' }];
      const result = expandRepurposeGraph(slots, {
        signals: { high_performing_content_types: ['carousel'] },
      });
      expect(result).toHaveLength(2);
      expect(result[0]?.content_type).toBe('carousel');
      expect(result[1]?.content_type).toBe('short_video');
    });

    it('generates id for original when missing', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'blog' }];
      const result = expandRepurposeGraph(slots, {
        signals: { high_performing_content_types: ['blog'] },
      });
      expect(result[0]?.id).toBeDefined();
      expect(result[0]?.id).toMatch(/^slot_\d+$/);
      expect(result[1]?.repurpose_of).toBe(result[0]?.id);
    });

    it('unknown content_type does not expand', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'unknown_type' }];
      const result = expandRepurposeGraph(slots);
      expect(result).toHaveLength(1);
      expect(result[0]?.content_type).toBe('unknown_type');
    });

    it('linkedin_post expands into carousel', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'linkedin_post' }];
      const result = expandRepurposeGraph(slots, {
        signals: { high_performing_content_types: ['linkedin_post'] },
      });
      expect(result).toHaveLength(2);
      expect(result[0]?.content_type).toBe('linkedin_post');
      expect(result[1]?.content_type).toBe('carousel');
    });

    it('example: blog slot expanded with normal density', () => {
      const slots: RepurposeSlotInput[] = [
        { content_type: 'blog', day: 'Mon', platform: 'tiktok' },
      ];
      const result = expandRepurposeGraph(slots, {
        densityLevel: 'normal',
        signals: { high_performing_platforms: ['tiktok'] },
      });
      expect(result.map((s) => ({ day: s.day, content_type: s.content_type }))).toEqual([
        { day: 'Mon', content_type: 'blog' },
        { day: 'Tue', content_type: 'linkedin_post' },
        { day: 'Wed', content_type: 'thread' },
      ]);
    });

    it('example: blog slot expanded with low density', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'blog', day: 'Mon' }];
      const result = expandRepurposeGraph(slots, { densityLevel: 'low' });
      expect(result.map((s) => ({ day: s.day, content_type: s.content_type }))).toEqual([
        { day: 'Mon', content_type: 'blog' },
        { day: 'Tue', content_type: 'linkedin_post' },
      ]);
    });

    it('example: Mon blog expanded with high density (Mon→Tue→Wed→Thu)', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'blog', day: 'Mon' }];
      const result = expandRepurposeGraph(slots, {
        signals: { high_performing_content_types: ['blog'] },
      });
      expect(result.map((s) => ({ day: s.day, content_type: s.content_type }))).toEqual([
        { day: 'Mon', content_type: 'blog' },
        { day: 'Tue', content_type: 'linkedin_post' },
        { day: 'Wed', content_type: 'thread' },
        { day: 'Thu', content_type: 'carousel' },
      ]);
    });

    it('example: Fri blog expanded (Fri→Mon→Tue→Wed)', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'blog', day: 'Fri' }];
      const result = expandRepurposeGraph(slots, {
        signals: { high_performing_content_types: ['blog'] },
      });
      expect(result.map((s) => ({ day: s.day, content_type: s.content_type }))).toEqual([
        { day: 'Fri', content_type: 'blog' },
        { day: 'Mon', content_type: 'linkedin_post' },
        { day: 'Tue', content_type: 'thread' },
        { day: 'Wed', content_type: 'carousel' },
      ]);
    });

    it('high-performing type expands deeper', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'blog', day: 'Mon' }];
      const result = expandRepurposeGraph(slots, {
        highPerformingTypes: ['blog'],
        signals: { high_performing_content_types: ['blog', 'linkedin_post', 'thread', 'carousel'] },
      });
      expect(result).toHaveLength(4);
      expect(result.map((s) => s.content_type)).toEqual(['blog', 'linkedin_post', 'thread', 'carousel']);
    });

    it('low-performing type expands less', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'blog', day: 'Mon' }];
      const result = expandRepurposeGraph(slots, {
        densityLevel: 'normal',
        lowPerformingTypes: ['blog'],
      });
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.content_type)).toEqual(['blog', 'linkedin_post']);
    });

    it('clamping between 1–3', () => {
      const lowSlot: RepurposeSlotInput[] = [{ content_type: 'blog', day: 'Mon' }];
      const lowResult = expandRepurposeGraph(lowSlot, {
        densityLevel: 'low',
        lowPerformingTypes: ['blog'],
      });
      expect(lowResult).toHaveLength(2);
      expect(lowResult.map((s) => s.content_type)).toEqual(['blog', 'linkedin_post']);

      const highSlot: RepurposeSlotInput[] = [{ content_type: 'blog', day: 'Mon' }];
      const highResult = expandRepurposeGraph(highSlot, {
        highPerformingTypes: ['blog'],
        signals: { high_performing_content_types: ['blog'] },
      });
      expect(highResult).toHaveLength(4);
      expect(highResult.map((s) => s.content_type)).toEqual(['blog', 'linkedin_post', 'thread', 'carousel']);
    });

    it('deterministic behavior maintained', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'blog', day: 'Mon' }];
      const opts = {
        densityLevel: 'normal' as const,
        highPerformingTypes: ['blog'],
        signals: { high_performing_content_types: ['blog'] },
      };
      const r1 = expandRepurposeGraph(slots, opts);
      const r2 = expandRepurposeGraph(slots, opts);
      expect(r1).toEqual(r2);
    });

    it('companyPerformanceInsights reorders cascade so high-performing platforms appear earlier', () => {
      // linkedin cascade default: [x, instagram, youtube]. With x as high-performer → [x, instagram, youtube] (same)
      // With youtube as high-performer → [youtube, x, instagram]
      const slots: RepurposeSlotInput[] = [
        { content_type: 'linkedin_post', platform: 'linkedin', day: 'Mon' },
      ];
      const result = expandRepurposeGraph(slots, {
        companyPerformanceInsights: { high_performing_platforms: ['youtube'] },
        signals: {
          high_performing_content_types: ['linkedin_post'],
          high_performing_platforms: ['youtube'],
        },
      });
      expect(result).toHaveLength(4);
      expect(result[0]?.platform).toBe('linkedin');
      expect(result[1]?.platform).toBe('youtube');
      expect(result[2]?.platform).toBe('x');
      expect(result[3]?.platform).toBe('instagram');
    });

    it('without companyPerformanceInsights uses default cascade order', () => {
      const slots: RepurposeSlotInput[] = [
        { content_type: 'linkedin_post', platform: 'linkedin', day: 'Mon' },
      ];
      const result = expandRepurposeGraph(slots, {
        signals: { high_performing_content_types: ['linkedin_post'] },
      });
      expect(result).toHaveLength(4);
      expect(result[1]?.platform).toBe('x');
      expect(result[2]?.platform).toBe('instagram');
      expect(result[3]?.platform).toBe('youtube');
    });

    it('companyPerformanceInsights works with eligiblePlatforms filter', () => {
      const slots: RepurposeSlotInput[] = [
        { content_type: 'linkedin_post', platform: 'linkedin', day: 'Mon' },
      ];
      const result = expandRepurposeGraph(slots, {
        companyPerformanceInsights: { high_performing_platforms: ['youtube'] },
        eligiblePlatforms: ['instagram', 'youtube', 'x'],
        signals: {
          high_performing_content_types: ['linkedin_post'],
          high_performing_platforms: ['youtube'],
        },
      });
      expect(result).toHaveLength(4);
      expect(result[1]?.platform).toBe('youtube');
      expect(result[2]?.platform).toBe('x');
      expect(result[3]?.platform).toBe('instagram');
    });

    it('signals.high_performing_content_types prioritizes repurpose targets', () => {
      // blog normally expands to [linkedin_post, thread, carousel]. When carousel is high-performing, prioritize it.
      const slots: RepurposeSlotInput[] = [{ content_type: 'blog', day: 'Mon' }];
      const result = expandRepurposeGraph(slots, {
        densityLevel: 'normal',
        signals: { high_performing_content_types: ['carousel'] },
      });
      expect(result).toHaveLength(2);
      expect(result[0]?.content_type).toBe('blog');
      expect(result[1]?.content_type).toBe('carousel');
    });

    it('signals.high_performing_content_types with no match falls back to default order', () => {
      const slots: RepurposeSlotInput[] = [
        { content_type: 'blog', day: 'Mon', platform: 'tiktok' },
      ];
      const result = expandRepurposeGraph(slots, {
        densityLevel: 'normal',
        signals: { high_performing_platforms: ['tiktok'] },
      });
      expect(result.map((s) => s.content_type)).toEqual([
        'blog',
        'linkedin_post',
        'thread',
      ]);
    });

    it('amplification score: no signals caps at 1, high-performing slot allows 3', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'blog', day: 'Mon' }];
      const withoutSignals = expandRepurposeGraph(slots, { densityLevel: 'high' });
      expect(withoutSignals).toHaveLength(2);
      expect(withoutSignals.map((s) => s.content_type)).toEqual([
        'blog',
        'linkedin_post',
      ]);

      const withSignals = expandRepurposeGraph(slots, {
        signals: { high_performing_content_types: ['blog'] },
      });
      expect(withSignals).toHaveLength(4);
      expect(withSignals.map((s) => s.content_type)).toEqual([
        'blog',
        'linkedin_post',
        'thread',
        'carousel',
      ]);
    });

    it('signals.low_performing_patterns skips transformation (target-only)', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'blog', day: 'Mon' }];
      const result = expandRepurposeGraph(slots, {
        densityLevel: 'normal',
        signals: {
          high_performing_content_types: ['blog'],
          low_performing_patterns: ['carousel'],
        },
      });
      expect(result.map((s) => s.content_type)).toEqual([
        'blog',
        'linkedin_post',
        'thread',
      ]);
      expect(result).not.toContainEqual(
        expect.objectContaining({ content_type: 'carousel' })
      );
    });

    it('signals.low_performing_patterns skips transformation (full key)', () => {
      const slots: RepurposeSlotInput[] = [{ content_type: 'blog', day: 'Mon' }];
      const result = expandRepurposeGraph(slots, {
        densityLevel: 'normal',
        signals: {
          high_performing_content_types: ['blog'],
          low_performing_patterns: ['blog->thread'],
        },
      });
      expect(result.map((s) => s.content_type)).toEqual([
        'blog',
        'linkedin_post',
        'carousel',
      ]);
      expect(result).not.toContainEqual(
        expect.objectContaining({ content_type: 'thread' })
      );
    });
  });
});

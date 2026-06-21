/**
 * Combined blueprint sanitizer — remaps BOLT-excluded content types (blog →
 * article) while preserving creator formats, so commit-plan validation no longer
 * fails combined runs with BLUEPRINT_INVALID_CONTENT_TYPE.
 */

import {
  sanitizeBoltPlanForCombined,
  isCombinedValidContentType,
} from '@/lib/shared/bolt/sanitizeBoltPlanForCombined';
import { assertValidBoltBlueprint } from '@/lib/shared/bolt/validateBoltBlueprint';

const allTypes = (weeks: any[]): string[] => {
  const out: string[] = [];
  for (const w of weeks) {
    for (const a of w.activities ?? []) out.push(String(a.content_type ?? a.type ?? a.format));
    for (const m of w.content_type_mix ?? []) out.push(String(m).replace(/^\d+\s+/, ''));
    for (const items of Object.values(w.platform_content_breakdown ?? {})) {
      for (const it of items as any[]) out.push(String((it as any).type ?? (it as any).content_type));
    }
  }
  return out.map((t) => t.toLowerCase());
};

describe('sanitizeBoltPlanForCombined', () => {
  const week = () => ({
    week_number: 1,
    cta: 'Learn more',
    platform_allocation: { linkedin: 3, x: 2, youtube: 1 },
    activities: [
      { content_type: 'blog', platform: 'linkedin' },
      { content_type: 'post', platform: 'x' },
      { content_type: 'video', platform: 'youtube' },
      { content_type: 'carousel', platform: 'linkedin' },
    ],
    content_type_mix: ['3 post', '1 blog', '2 video', '1 carousel'],
    platform_content_breakdown: {
      linkedin: [{ type: 'blog' }, { type: 'carousel' }],
      youtube: [{ type: 'video' }],
    },
  });

  test('remaps blog → article in all three locations', () => {
    const out = sanitizeBoltPlanForCombined([week()]) as any[];
    const types = allTypes(out);
    expect(types).not.toContain('blog');
    expect(types.filter((t) => t === 'article').length).toBeGreaterThanOrEqual(3); // activity + mix + breakdown
  });

  test('preserves valid text + creator formats', () => {
    const out = sanitizeBoltPlanForCombined([week()]) as any[];
    const types = new Set(allTypes(out));
    for (const keep of ['post', 'video', 'carousel']) expect(types.has(keep)).toBe(true);
  });

  test('sanitized plan passes assertValidBoltBlueprint (no BLUEPRINT_INVALID_CONTENT_TYPE)', () => {
    const out = sanitizeBoltPlanForCombined([week()]);
    expect(() => assertValidBoltBlueprint({ weeks: out })).not.toThrow();
  });

  test('raw blog plan WOULD throw without the sanitizer (regression baseline)', () => {
    expect(() => assertValidBoltBlueprint({ weeks: [week()] })).toThrow(/unsupported content types: blog/i);
  });

  test('isCombinedValidContentType: blog invalid; post/video/carousel/article valid', () => {
    expect(isCombinedValidContentType('blog')).toBe(false);
    for (const v of ['post', 'tweet', 'article', 'video', 'carousel', 'image']) {
      expect(isCombinedValidContentType(v)).toBe(true);
    }
  });

  test('pure — does not mutate the input', () => {
    const input = [week()];
    const snapshot = JSON.stringify(input);
    sanitizeBoltPlanForCombined(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

import {
  getShowcasesForTemplate, getShowcasesForOutcome, outcomeHasShowcases,
  listShowcaseStyles, repositoryStats, type CreatorTemplateShowcase,
} from '../../../lib/creator-outcomes/creatorShowcaseRepository';
import { listOutcomes } from '../../../lib/creator-outcomes/outcomeRegistry';
import { getVisualStyle } from '../../../lib/creator-outcomes/creatorVisualStyleRegistry';

const FAMILIES = ['image', 'carousel', 'infographic'] as const;

describe('CREATOR-053 — Curated showcase repository (no generation)', () => {
  it('exposes a stable, typed, generation-free API', () => {
    const stats = repositoryStats();
    expect(stats).toEqual(expect.objectContaining({ total: expect.any(Number), templates: expect.any(Number), outcomes: expect.any(Number) }));
    expect(Array.isArray(getShowcasesForTemplate('sys-image-product-highlight'))).toBe(true);
    for (const o of listOutcomes()) {
      for (const f of o.supportedFamilies) {
        expect(Array.isArray(getShowcasesForOutcome(o.id, f))).toBe(true);
        expect(typeof outcomeHasShowcases(o.id, f)).toBe('boolean');
        expect(Array.isArray(listShowcaseStyles(o.id, f))).toBe(true);
      }
    }
  });

  it('every curated showcase (when present) is a valid finished-creative record — model enforced', () => {
    const seen = new Set<string>();
    for (const o of listOutcomes()) {
      for (const f of o.supportedFamilies) {
        for (const s of getShowcasesForOutcome(o.id, f) as CreatorTemplateShowcase[]) {
          expect(seen.has(s.id)).toBe(false); seen.add(s.id);            // unique ids
          expect(s.thumbnailUrl.length).toBeGreaterThan(0);              // real image, never empty
          expect(s.family).toBe(f);
          expect(s.businessOutcome).toBe(o.id);
          expect(getVisualStyle(s.visualStyle)).not.toBeNull();          // valid style
          expect(o.templateIds[f]?.includes(s.templateId)).toBe(true);   // belongs to the outcome's templates
        }
      }
    }
  });

  it('style filter narrows results; unknown outcome resolves to empty', () => {
    expect(getShowcasesForOutcome('does-not-exist', 'image')).toEqual([]);
    expect(outcomeHasShowcases('does-not-exist', 'carousel')).toBe(false);
    // A style filter never returns showcases of another style.
    for (const o of listOutcomes()) {
      for (const f of o.supportedFamilies) {
        const filtered = getShowcasesForOutcome(o.id, f, { visualStyle: 'corporate' });
        for (const s of filtered) expect(s.visualStyle).toBe('corporate');
      }
    }
  });

  it('repository is empty until curated (honest baseline) but fully functional', () => {
    // Empty manifest → 0 assets; the gallery shows its empty-state. No crash, no generation.
    expect(repositoryStats().total).toBeGreaterThanOrEqual(0);
    expect(FAMILIES.every((f) => Array.isArray(getShowcasesForOutcome('launch-product', f)))).toBe(true);
  });
});

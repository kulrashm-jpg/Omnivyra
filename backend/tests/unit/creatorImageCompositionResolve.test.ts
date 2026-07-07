/**
 * resolveImageComposition maps BOTH the goal-named blueprint image templates AND their curated
 * style variants to the same composition (by blueprint id), so a curated "before/after" image
 * renders the split composition (and its density counts only the rendered fields) — not the
 * generic overlay that failed closed with text_density_exceeds_profile.
 */
import { resolveImageComposition } from '../../services/creatorAssetRenderer';

describe('resolveImageComposition — blueprint + curated map to the same composition', () => {
  it('resolves the explicit blueprint-template composition', () => {
    expect(resolveImageComposition({ template_id: 'sys-image-before-after' })).toBe('split');
    expect(resolveImageComposition({ template_id: 'sys-image-comparison' })).toBe('two-column');
    expect(resolveImageComposition({ template_id: 'sys-image-statistic' })).toBe('stat');
  });

  it('resolves the CURATED variant via its blueprint id (the reported case)', () => {
    expect(resolveImageComposition({ template_id: 'sys-curated-before-after-image' })).toBe('split');
    expect(resolveImageComposition({ template_id: 'sys-curated-comparison-image' })).toBe('two-column');
    expect(resolveImageComposition({ template_id: 'sys-curated-checklist-image' })).toBe('list');
    expect(resolveImageComposition({ template_id: 'sys-curated-quote-image' })).toBe('quote');
  });

  it('resolves via metadata.blueprint_id when no template composition is set', () => {
    expect(resolveImageComposition({ blueprint_id: 'before-after' })).toBe('split');
    expect(resolveImageComposition({ creator_card: { blueprint_id: 'statistic' } })).toBe('stat');
  });

  it('returns null for templates with no composition (default overlay unchanged)', () => {
    expect(resolveImageComposition({ template_id: 'sys-image-headline' })).toBeNull();
    expect(resolveImageComposition({ template_id: 'sys-curated-corporate-image' })).toBeNull();
    expect(resolveImageComposition({})).toBeNull();
  });
});

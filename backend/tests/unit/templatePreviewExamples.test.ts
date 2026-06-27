import { listTemplatesForFamily, buildPreviewExamples } from '../../../lib/creator-templates';
import { cloneTemplate } from '../../../lib/creator-templates/userTemplate';

const byId = (fam: 'image'|'carousel'|'infographic', id: string) => listTemplatesForFamily(fam).find((t) => t.id === id)!;
const img = byId('image', 'sys-image-headline-sub-cta'); // headline + subheadline + cta
const car = byId('carousel', 'sys-carousel-educational-5'); // slides[5]
const info = byId('infographic', 'sys-infographic-statistics'); // sections[3]
const logo = byId('image', 'sys-image-logo-only'); // empty sample

describe('CREATOR-004 multi-outcome preview examples (deterministic)', () => {
  it('system templates yield 3–5 examples that preserve structure', () => {
    const ex = buildPreviewExamples(img);
    expect(ex.length).toBeGreaterThanOrEqual(3);
    expect(ex.length).toBeLessThanOrEqual(5);
    for (const e of ex) {
      expect(e.label).toBeTruthy();
      expect(typeof e.sample.headline).toBe('string'); // same field set
      expect(typeof e.sample.cta).toBe('string');
      expect(e.sample.slides).toBeUndefined();
      expect(e.sample.sections).toBeUndefined();
    }
    expect(ex[0].sample.headline).toBe(img.preview.sample.headline); // first = canonical
  });

  it('preserves carousel slide count + infographic section count across examples', () => {
    for (const e of buildPreviewExamples(car)) expect(e.sample.slides?.length).toBe(car.preview.sample.slides!.length);
    for (const e of buildPreviewExamples(info)) expect(e.sample.sections?.length).toBe(info.preview.sample.sections!.length);
  });

  it('is deterministic (same input → same examples)', () => {
    expect(buildPreviewExamples(info)).toEqual(buildPreviewExamples(info));
  });

  it('empty samples and user templates keep a single existing preview', () => {
    expect(buildPreviewExamples(logo).length).toBe(1);
    const user = cloneTemplate(img, 'image', { id: 'ut-prev', ownerUserId: 'u' });
    const ue = buildPreviewExamples(user);
    expect(ue.length).toBe(1);
    expect(ue[0].sample.headline).toBe(img.preview.sample.headline); // its own preview
  });

  it('authored examples (preview.sample.examples) win verbatim', () => {
    const t = cloneTemplate(img, 'image', { id: 'ut-auth', ownerUserId: 'u' });
    (t.preview.sample as any).examples = [
      { label: 'Custom A', headline: 'Alpha' },
      { label: 'Custom B', headline: 'Beta' },
    ];
    const ex = buildPreviewExamples(t);
    expect(ex.map((e) => e.label)).toEqual(['Custom A', 'Custom B']);
    expect(ex[0].sample.headline).toBe('Alpha');
  });
});

import { unionExampleLabels, pickSyncedExample, type PreviewExample } from '../../../lib/creator-templates';

describe('CREATOR-005 example synchronization (deterministic)', () => {
  const A: PreviewExample[] = [{ label: 'Featured', sample: { headline: 'A0' } }, { label: 'Marketing', sample: { headline: 'A1' } }, { label: 'Sales', sample: { headline: 'A2' } }];
  const B: PreviewExample[] = [{ label: 'Featured', sample: { headline: 'B0' } }, { label: 'Finance', sample: { headline: 'B1' } }, { label: 'Marketing', sample: { headline: 'B2' } }];

  it('builds an ordered, de-duplicated union of labels', () => {
    expect(unionExampleLabels([A, B])).toEqual(['Featured', 'Marketing', 'Sales', 'Finance']);
  });

  it('shows the same labelled example in every column when supported', () => {
    expect(pickSyncedExample(A, 'Marketing', 1).sample.headline).toBe('A1');
    expect(pickSyncedExample(B, 'Marketing', 1).sample.headline).toBe('B2'); // B has Marketing at index 2
  });

  it('falls back to the closest example by index when the label is missing', () => {
    // 'Sales' exists in A but not B → B uses closest by idx (2).
    expect(pickSyncedExample(A, 'Sales', 2).sample.headline).toBe('A2');
    expect(pickSyncedExample(B, 'Sales', 2).sample.headline).toBe('B2'); // closest by index
    // out-of-range idx clamps.
    expect(pickSyncedExample(B, 'Nope', 9).sample.headline).toBe('B2');
  });
});

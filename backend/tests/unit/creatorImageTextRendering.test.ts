import { getTemplateById, resolveTemplateCreatorCardPatch } from '../../../lib/creator-templates';
import { initTemplateValues, projectImageOverlayText } from '../../../lib/creator-templates/values';

/**
 * "Text Inside Image" contract — image templates that embed text must route to
 * the text-capable renderer lane (banner) with embedded_copy, while logo/no-text
 * templates route to the clean supporting_image lane. The user's template
 * fields are the authoritative overlay source.
 */
describe('Text Inside Image — renderer-lane routing', () => {
  it('headline template routes to the text-capable banner lane in embedded_copy', () => {
    const patch = resolveTemplateCreatorCardPatch(getTemplateById('sys-image-headline')!);
    expect(patch.writer_asset_type).toBe('banner');
    expect(patch.attachment_mode).toBe('embedded_copy');
  });

  it('headline + subheadline + CTA template → banner lane, embedded_copy', () => {
    const patch = resolveTemplateCreatorCardPatch(getTemplateById('sys-image-headline-sub-cta')!);
    expect(patch.writer_asset_type).toBe('banner');
    expect(patch.attachment_mode).toBe('embedded_copy');
  });

  it('quote + author template → banner lane (renders quote + attribution), embedded_copy', () => {
    const patch = resolveTemplateCreatorCardPatch(getTemplateById('sys-image-quote-author')!);
    expect(patch.writer_asset_type).toBe('banner');
    expect(patch.attachment_mode).toBe('embedded_copy');
    expect(patch.subtype).toBe('quote-image');
  });

  it('logo-only / no-text template → clean supporting_image lane, supporting_visual', () => {
    const patch = resolveTemplateCreatorCardPatch(getTemplateById('sys-image-logo-only')!);
    expect(patch.writer_asset_type).toBe('supporting_image');
    expect(patch.attachment_mode).toBe('supporting_visual');
  });
});

describe('Text Inside Image — overlay projection uses ONLY declared fields', () => {
  it('headline + subheadline + CTA maps onto overlay headline / supportingText / cta', () => {
    const tpl = getTemplateById('sys-image-headline-sub-cta')!;
    const overlay = projectImageOverlayText(tpl, { fields: { headline: 'Automate it', subheadline: 'Save 8 hrs', cta: 'Start free' } });
    expect(overlay).toMatchObject({ headline: 'Automate it', supportingText: 'Save 8 hrs', cta: 'Start free' });
    expect(overlay.hook).toBe(''); // no undeclared hook injected
  });

  it('quote + author maps onto overlay headline (quote) + keyInsight (author)', () => {
    const tpl = getTemplateById('sys-image-quote-author')!;
    const overlay = projectImageOverlayText(tpl, { fields: { quote: 'Keep it simple', author: '— Jane Doe' } });
    expect(overlay.headline).toBe('Keep it simple');
    expect(overlay.keyInsight).toBe('— Jane Doe');
    expect(overlay.cta).toBe('');
  });

  it('OPTIONAL field collapse: a blank optional field projects to an empty overlay slot (no placeholder)', () => {
    const tpl = getTemplateById('sys-image-headline-sub-cta')!;
    const overlay = projectImageOverlayText(tpl, { fields: { headline: 'Only a headline', subheadline: '', cta: '' } });
    expect(overlay.headline).toBe('Only a headline');
    expect(overlay.supportingText).toBe('');
    expect(overlay.cta).toBe('');
  });

  it('headline-only template initialises a single headline field', () => {
    const tpl = getTemplateById('sys-image-headline')!;
    const values = initTemplateValues(tpl);
    expect(Object.keys(values.fields)).toEqual(['headline']);
  });
});

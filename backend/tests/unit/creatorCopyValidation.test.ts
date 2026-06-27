import { validateCreatorCopyValue, validateCreatorOutputCopy, hasBrandConstraints } from '../../services/creator/creatorCopyValidation';
import { buildCreatorGroundingBlock } from '../../services/creator/creatorCopyContextResolver';

describe('Canonical copy validation — forbidden words + claims', () => {
  it('removes forbidden words/phrases (brand vocabulary) and flags the violation', () => {
    const r = validateCreatorCopyValue('We deliver synergy and real value', 'headline', { prohibitedPhrases: ['synergy'] });
    expect(r.value.toLowerCase()).not.toContain('synergy');
    expect(r.repaired).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.violations.map((v) => v.type)).toContain('forbidden_phrase');
  });

  it('removes prohibited compliance claims', () => {
    const r = validateCreatorCopyValue('This product cures cancer fast', 'subheadline', { prohibitedClaims: ['cures cancer'] });
    expect(r.value.toLowerCase()).not.toContain('cures cancer');
    expect(r.violations.map((v) => v.type)).toContain('prohibited_claim');
  });

  it('replaces banned generic CTAs with the brand CTA style on a CTA field', () => {
    const r = validateCreatorCopyValue('Click here', 'cta', { ctaStyle: 'Get started' });
    expect(r.value).toBe('Get started');
    expect(r.violations.map((v) => v.type)).toContain('banned_cta');
  });

  it('strips fabricated/unsupported superlatives (#1, world-class, guaranteed)', () => {
    const r = validateCreatorCopyValue('The #1 world-class guaranteed tool', 'headline', {});
    expect(r.value).not.toMatch(/#1|world-class|guaranteed/i);
    expect(r.violations.filter((v) => v.type === 'fabricated_claim').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps a superlative when the brand explicitly lists it as a required term', () => {
    const r = validateCreatorCopyValue('world-class support', 'headline', { requiredTerms: ['world-class'] });
    expect(r.value.toLowerCase()).toContain('world-class');
    expect(r.violations.find((v) => v.type === 'fabricated_claim')).toBeUndefined();
  });

  it('flags missing required terminology (advisory, value unchanged)', () => {
    const r = validateCreatorCopyValue('A clean headline', 'headline', { requiredTerms: ['Acme'] });
    expect(r.value).toBe('A clean headline');
    expect(r.violations.map((v) => v.type)).toContain('missing_required_term');
  });

  it('marks not-ok when repair empties the value (caller falls back)', () => {
    const r = validateCreatorCopyValue('synergy', 'headline', { prohibitedPhrases: ['synergy'] });
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.type)).toContain('emptied_by_repair');
  });

  it('no brand voice → no changes', () => {
    const r = validateCreatorCopyValue('A perfectly fine headline', 'headline', undefined);
    expect(r.value).toBe('A perfectly fine headline');
    expect(r.repaired).toBe(false);
    expect(r.violations).toHaveLength(0);
  });
});

describe('Master-generation output validation — same layer applied before render', () => {
  const brandVoice = { prohibitedPhrases: ['synergy'], prohibitedClaims: ['cures everything'] };

  it('repairs overlay copy on the generated asset payload', () => {
    const payload = { overlay_text: { headline: 'Unlock synergy now', cta: 'Click here', supportingText: 'It cures everything' } };
    const r = validateCreatorOutputCopy(payload, { ...brandVoice, ctaStyle: 'Get started' });
    expect(r.repaired).toBe(true);
    const ov = (r.assetPayload.overlay_text as Record<string, string>);
    expect(ov.headline.toLowerCase()).not.toContain('synergy');
    expect(ov.cta).toBe('Get started');
    expect(ov.supportingText.toLowerCase()).not.toContain('cures everything');
  });

  it('repairs carousel slides and infographic transform items', () => {
    const payload = {
      slides: [{ slide_number: 1, headline: 'Pure synergy', body_text: 'world-class results' }],
      media_bundle: { metadata: { thread_visual_transform: { items: ['92%: synergy gains'] } } },
    };
    const r = validateCreatorOutputCopy(payload, brandVoice);
    expect(r.repaired).toBe(true);
    const slide = (r.assetPayload.slides as Array<Record<string, string>>)[0];
    expect(slide.headline.toLowerCase()).not.toContain('synergy');
    const items = ((r.assetPayload.media_bundle as any).metadata.thread_visual_transform.items as string[]);
    expect(items[0].toLowerCase()).not.toContain('synergy');
  });

  it('is a strict no-op (same ref) when the brand defines no constraints', () => {
    const payload = { overlay_text: { headline: 'The #1 world-class tool' } };
    const r = validateCreatorOutputCopy(payload, {});
    expect(r.repaired).toBe(false);
    expect(r.assetPayload).toBe(payload); // existing no-brand flows unchanged
    expect(hasBrandConstraints({})).toBe(false);
  });
});

describe('Shared canonical grounding block — one framework for all AI prompts', () => {
  it('produces identical brand-voice + company grounding lines', () => {
    const { brandVoiceLines, companyLines } = buildCreatorGroundingBlock({
      company: { description: 'A RevOps platform', products: ['Router'], positioning: 'Fastest routing' },
      brandVoice: { tone: 'confident', prohibitedPhrases: ['synergy'] },
    });
    expect(brandVoiceLines).toContain('Brand tone: confident.');
    expect(brandVoiceLines).toContain('NEVER use these forbidden words/phrases: synergy.');
    expect(companyLines).toContain('Business: A RevOps platform');
    expect(companyLines).toContain('Positioning: Fastest routing');
  });
});

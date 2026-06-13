/**
 * Phase 1 gate coverage on the newsletter path — the last user-visible scorer.
 * The shared `evaluatePhase1QualityGates` runs inside `calculateContentQualityScore`
 * (which the newsletter scorer wraps); these tests verify the newsletter scorer
 * PROPAGATES the cap + gate failures into its own total / issues / publish blockers.
 */
import { calculateNewsletterQualityScore, getNewsletterPublishBlockers } from '../../../../lib/newsletter/newsletterValidation';
import type { ContentFormMeta } from '../../../../lib/content/qualityScoringCore';

const body = 'This week brought a clear signal: disciplined teams that measure outcomes weekly keep compounding their advantage while rivals chase volume and noise without judgement. ';
const para = (id: string, copies = 6) => ({ id, type: 'paragraph', html: `<p>${body.repeat(copies)}</p>` });

const cleanBlocks = (): any[] => [
  { id: 'h1', type: 'heading', level: 2, text: 'Week Summary' },
  para('p1'),
  { id: 'h2', type: 'heading', level: 2, text: 'Top Signals' },
  para('p2'),
  { id: 'h3', type: 'heading', level: 2, text: 'Pattern' },
  para('p3'),
  { id: 'h4', type: 'heading', level: 2, text: 'Quick Takes' },
  para('p4'),
  { id: 'h5', type: 'heading', level: 2, text: 'Closing' },
  para('p5', 3),
  { id: 'ki', type: 'key_insights', items: ['Measurement compounds.', 'Ownership beats volume.', 'Cadence wins.'] },
  { id: 'sm', type: 'summary', body: 'Disciplined weekly measurement compounds advantage; volume without judgement is noise.' },
  { id: 'q', type: 'quote', text: 'Cadence, not heroics, is what compounds over a quarter.' },
  { id: 'c', type: 'callout', body: 'The practical shift: instrument the handoffs nobody currently owns.' },
  { id: 'il1', type: 'internal_link', slug: 'related-one' },
  { id: 'il2', type: 'internal_link', slug: 'related-two' },
  { id: 'rf', type: 'references', items: [
    { title: 'Source A', url: 'https://example.com/a' },
    { title: 'Source B', url: 'https://example.com/b' },
  ] },
];

const form: ContentFormMeta = {
  title: 'The Weekly Growth Brief',
  excerpt: 'A weekly read on how disciplined measurement and ownership beat raw content volume for growth teams.',
  seo_meta_title: 'Weekly Growth Brief',
  seo_meta_description: 'Disciplined measurement beats volume.',
  tags: ['growth'],
  target_word_count: 300,
  format_type: 'weekly-brief',
  content_type: 'newsletter',
};

describe('Phase 1 gate coverage — newsletter scorer', () => {
  const cleanTotal = calculateNewsletterQualityScore(cleanBlocks(), form).total;

  it('clean newsletter: no gates, no publishing blockers, score intact', () => {
    const score = calculateNewsletterQualityScore(cleanBlocks(), form);
    expect(score.gates ?? []).toEqual([]);
    expect(score.scoreCap ?? null).toBeNull();
    expect(getNewsletterPublishBlockers(score).some((i) => i.category === 'publishing')).toBe(false);
    expect(cleanTotal).toBeGreaterThan(60); // baseline high enough to make caps visible
  });

  it('1. placeholder → caps at 60 + newsletter publish blocker', () => {
    const blocks = cleanBlocks();
    blocks.push({ id: 'x', type: 'paragraph', html: '<p>Open rate was {{open_rate}} this week.</p>' });
    const score = calculateNewsletterQualityScore(blocks, form);
    expect(score.gates?.some((g) => g.gate === 'placeholder')).toBe(true);
    expect(score.total).toBeLessThanOrEqual(60);
    expect(score.total).toBeLessThan(cleanTotal);
    expect(getNewsletterPublishBlockers(score).some((i) => /Placeholder Gate/.test(i.message))).toBe(true);
  });

  it('2. planner artifact → caps at 70 + newsletter publish blocker', () => {
    const blocks = cleanBlocks();
    blocks.push({ id: 'x', type: 'paragraph', html: '<p>The purpose of this section is to set up the week ahead.</p>' });
    const score = calculateNewsletterQualityScore(blocks, form);
    expect(score.gates?.some((g) => g.gate === 'publishing_readiness')).toBe(true);
    expect(score.total).toBeLessThanOrEqual(70);
    expect(getNewsletterPublishBlockers(score).some((i) => /Publishing Readiness Gate/.test(i.message))).toBe(true);
  });

  it('3. undelivered framework → framework gate fires + publish blocker', () => {
    const blocks = cleanBlocks();
    blocks.push({ id: 'x', type: 'paragraph', html: '<p>We use a proprietary framework to run the weekly review for every team.</p>' });
    const score = calculateNewsletterQualityScore(blocks, form);
    expect(score.gates?.some((g) => g.gate === 'framework_delivery')).toBe(true);
    expect(getNewsletterPublishBlockers(score).some((i) => /Framework Delivery Gate/.test(i.message))).toBe(true);
  });

  it('4. broken title promise (checklist) → promise gate + publish blocker', () => {
    const score = calculateNewsletterQualityScore(cleanBlocks(), { ...form, title: 'The Weekly Growth Checklist' });
    expect(score.gates?.some((g) => g.gate === 'promise_fulfillment')).toBe(true);
    expect(score.total).toBeLessThanOrEqual(65);
    expect(getNewsletterPublishBlockers(score).some((i) => /Promise Fulfillment Gate/.test(i.message))).toBe(true);
  });

  it('5. clean newsletter is unaffected by gate wiring', () => {
    const score = calculateNewsletterQualityScore(cleanBlocks(), form);
    expect(score.total).toBe(cleanTotal);
    expect(score.issues.some((i) => i.category === 'publishing')).toBe(false);
  });
});

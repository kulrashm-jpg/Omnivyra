/**
 * Phase 1 gate coverage in System #2 (the user-visible block-based score).
 * Verifies the SAME shared `evaluatePhase1QualityGates` now caps
 * `calculateQualityScore.total` and feeds `getPublishBlockers`, while leaving
 * a clean draft's category scoring untouched.
 */
import { calculateQualityScore, getPublishBlockers, type FormMeta } from '../../../../lib/blog/blogValidation';

const sentence = 'Growth leaders should prioritize measurable outcomes and disciplined execution across every channel they own. ';
const para = (id: string, copies = 8) => ({ id, type: 'paragraph', html: `<p>${sentence.repeat(copies)}</p>` });

// A clean, structurally-complete blog that scores high on its own merits.
const cleanBlocks = (): any[] => [
  { id: 'h1', type: 'heading', level: 2, text: 'The Strategic Case' },
  para('p1'),
  { id: 'h2', type: 'heading', level: 2, text: 'The Operating Reality' },
  para('p2'),
  { id: 'h3', type: 'heading', level: 2, text: 'Execution Cadence' },
  para('p3'),
  { id: 'ki', type: 'key_insights', items: ['Disciplined sequencing compounds.', 'Ownership beats volume.'] },
  { id: 'sm', type: 'summary', body: 'Modern growth rewards judgement and measurable execution over raw output volume.' },
  { id: 'rf', type: 'references', items: [
    { title: 'Source A', url: 'https://example.com/a' },
    { title: 'Source B', url: 'https://example.com/b' },
    { title: 'Source C', url: 'https://example.com/c' },
  ] },
  { id: 'il1', type: 'internal_link', slug: 'related-one' },
  { id: 'il2', type: 'internal_link', slug: 'related-two' },
];

const form: FormMeta = {
  title: 'The Strategic Case for Modern Growth Leaders',
  excerpt: 'A practical look at how disciplined execution and measurable outcomes beat raw content volume for growth teams.',
  seo_meta_title: 'Strategic Growth for Leaders',
  seo_meta_description: 'How disciplined execution beats volume.',
  tags: ['growth'],
  target_word_count: 300,
  format_type: 'standard',
  content_type: 'blog',
};

describe('Phase 1 gate coverage — System #2 (calculateQualityScore)', () => {
  it('clean draft: no gates, category scoring intact, high score, no publish blockers', () => {
    const score = calculateQualityScore(cleanBlocks(), form);
    expect(score.gates).toEqual([]);
    expect(score.scoreCap).toBeNull();
    expect(score.total).toBeGreaterThan(75);
    // category breakdown unchanged shape
    expect(score.breakdown.structure).toBeGreaterThan(0);
    expect(getPublishBlockers(score).some((i) => i.category === 'publishing')).toBe(false);
  });

  it('placeholder leak: caps total at 60 and creates a publish blocker', () => {
    const blocks = cleanBlocks();
    blocks.push({ id: 'ph', type: 'paragraph', html: '<p>Revenue grew {{revenue_growth}} last year.</p>' });
    const score = calculateQualityScore(blocks, form);
    expect(score.gates?.some((g) => g.gate === 'placeholder')).toBe(true);
    expect(score.total).toBeLessThanOrEqual(60);
    const blockers = getPublishBlockers(score);
    expect(blockers.some((i) => i.category === 'publishing' && /Placeholder Gate/.test(i.message))).toBe(true);
  });

  it('leaked planner artifact: caps total at 70 and creates a publish blocker', () => {
    const blocks = cleanBlocks();
    blocks.push({ id: 'art', type: 'paragraph', html: '<p>The purpose of this section is to orient the reader before the deep dive.</p>' });
    const score = calculateQualityScore(blocks, form);
    expect(score.gates?.some((g) => g.gate === 'publishing_readiness')).toBe(true);
    expect(score.total).toBeLessThanOrEqual(70);
    expect(getPublishBlockers(score).some((i) => /Publishing Readiness Gate/.test(i.message))).toBe(true);
  });

  it('takes the strictest cap when multiple gates fire', () => {
    const blocks = cleanBlocks();
    blocks.push({ id: 'art', type: 'paragraph', html: '<p>The purpose of this section is to explain. Pricing is TBD.</p>' });
    const score = calculateQualityScore(blocks, form);
    expect(score.total).toBeLessThanOrEqual(60); // placeholder(60) < publishing(70)
  });

  it('hardening parity: framework claim with only key_insights/references blocks → framework gate fires', () => {
    const blocks: any[] = [
      { id: 'h', type: 'heading', level: 2, text: 'Our Method' },
      { id: 'p', type: 'paragraph', html: '<p>We use a proprietary framework to drive durable growth across every team and channel we operate.</p>' },
      { id: 'ki', type: 'key_insights', items: ['Discipline compounds.', 'Ownership beats volume.'] },
      { id: 'rf', type: 'references', items: [
        { title: 'Source A', url: 'https://example.com/a' },
        { title: 'Source B', url: 'https://example.com/b' },
        { title: 'Source C', url: 'https://example.com/c' },
      ] },
    ];
    const score = calculateQualityScore(blocks, { ...form, title: 'Our Growth Method' });
    expect(score.gates?.some((g) => g.gate === 'framework_delivery')).toBe(true);
    expect(score.total).toBeLessThanOrEqual(70);
    expect(getPublishBlockers(score).some((i) => /Framework Delivery Gate/.test(i.message))).toBe(true);
  });

  it('the triggering excerpt is surfaced in gate metadata for UI explainability', () => {
    const blocks = cleanBlocks();
    blocks.push({ id: 'ph', type: 'paragraph', html: '<p>Contact {{company_name}} today.</p>' });
    const score = calculateQualityScore(blocks, form);
    const gate = score.gates?.find((g) => g.gate === 'placeholder');
    expect(gate?.triggeringText).toContain('{{company_name}}');
    expect(gate?.scoreCap).toBe(60);
  });
});

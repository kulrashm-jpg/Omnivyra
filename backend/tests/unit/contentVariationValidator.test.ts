import { validateContentVariation } from '../../../lib/content/contentVariationValidator';
import { scoreCompanyContext } from '../../../lib/content/companyContextBlock';

describe('contentVariationValidator', () => {
  it('flags near-duplicate sections above the hard similarity threshold', () => {
    const result = validateContentVariation([
      {
        id: 'section_1',
        text: 'Revenue teams lose hours every week copying lead notes across tools, cleaning CRM records, and chasing context before follow-up.',
      },
      {
        id: 'section_2',
        text: 'Revenue teams lose hours every week copying lead notes across tools, cleaning CRM records, and chasing context before follow-up.',
      },
      {
        id: 'section_3',
        text: 'A better workflow starts when enrichment, routing, and follow-up context stay connected instead of being recreated by hand.',
      },
    ], { contentType: 'blog' });

    expect(result.duplicateContentDetected).toBe(true);
    expect(result.duplicateSectionPairs.length).toBeGreaterThan(0);
  });

  it('flags sections that do not introduce a new concept', () => {
    const result = validateContentVariation([
      {
        id: 'section_1',
        text: 'Manual pipeline updates create lag between buyer activity and sales action, which slows response times and hides deal risk.',
      },
      {
        id: 'section_2',
        text: 'Manual pipeline updates create lag between buyer activity and sales action, which slows response times and hides deal risk for operators.',
      },
    ], { contentType: 'blog' });

    expect(result.lowVariationDetected).toBe(true);
    expect(result.lowVariationSections).toHaveLength(1);
  });

  it('relaxes duplicate detection for mid-form content', () => {
    const result = validateContentVariation([
      {
        id: 'section_1',
        text: 'Operators revisit the same customer moment to build a narrative about why onboarding friction quietly erodes expansion.',
      },
      {
        id: 'section_2',
        text: 'Operators revisit the same customer moment to build a narrative about why onboarding friction quietly erodes expansion while adding a few extra words.',
      },
    ], { contentType: 'newsletter' });

    expect(result.validationMode).toBe('mid_form');
    expect(result.duplicateContentDetected).toBe(false);
    expect(result.lowVariationDetected).toBe(false);
  });

  it('skips duplicate penalties for short-form validation', () => {
    const result = validateContentVariation([
      {
        id: 'hook',
        text: 'Stop scrolling. This changes how you think about onboarding.',
      },
      {
        id: 'cta',
        text: 'Stop scrolling. This changes how you think about onboarding.',
      },
    ], { contentType: 'post' });

    expect(result.validationMode).toBe('short_form');
    expect(result.duplicateContentDetected).toBe(false);
    expect(result.lowVariationDetected).toBe(false);
  });

  it('applies duplicate and low-variation penalties inside scoreCompanyContext', () => {
    const content = [
      'Acme Cloud helps revenue teams fix handoff delays between marketing and sales.',
      'Acme Cloud helps revenue teams fix handoff delays between marketing and sales.',
      'Acme Cloud helps revenue teams fix handoff delays between marketing and sales.',
    ].join('\n\n');

    const result = scoreCompanyContext(content, {
      companyName: 'Acme Cloud',
      targetAudience: 'Revenue operations leaders',
      painPoints: ['handoff delays', 'manual CRM updates'],
      productsServices: 'Revenue workflow automation',
    }, { contentType: 'blog' });

    expect(result.duplicateContentDetected).toBe(true);
    expect(result.lowVariationDetected).toBe(true);
    expect(result.score).toBeLessThan(70);
  });

  it('does not penalize short-form repetition inside scoreCompanyContext', () => {
    const content = [
      'Acme Cloud helps revenue teams fix handoff delays.',
      'Acme Cloud helps revenue teams fix handoff delays.',
    ].join('\n\n');

    const result = scoreCompanyContext(content, {
      companyName: 'Acme Cloud',
      targetAudience: 'Revenue operations leaders',
    }, { contentType: 'post' });

    expect(result.duplicateContentDetected).toBe(false);
    expect(result.lowVariationDetected).toBe(false);
  });
});

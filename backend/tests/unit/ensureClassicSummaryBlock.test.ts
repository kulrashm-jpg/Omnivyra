/**
 * ensureClassicSummaryBlock — trailing-duplication fix (shared long-form helper).
 *
 * The previous behaviour copied the blog's LAST paragraph verbatim into a
 * "summary" block when no excerpt was present, rendering the conclusion twice.
 * The fix: only the excerpt may seed the summary, and it is omitted when it
 * would echo existing body text. This helper is shared by all long-form types
 * (blog/article/guide/newsletter/story/whitepaper), so the fix is global.
 */

import { ensureClassicSummaryBlock } from '../../../lib/blog/runBlogGenerationPureHelpers';

const para = (text: string) => ({ id: Math.random().toString(36).slice(2), type: 'paragraph', html: `<p>${text}</p>` }) as any;
const summaries = (blocks: any[]) => blocks.filter((b) => b.type === 'summary');

describe('ensureClassicSummaryBlock', () => {
  it('returns unchanged when a summary block already exists', () => {
    const blocks = [para('Intro'), { id: 's', type: 'summary', body: 'An existing distinct summary.' }] as any;
    expect(ensureClassicSummaryBlock(blocks, 'some excerpt')).toBe(blocks);
  });

  it('does NOT copy the last paragraph verbatim when the excerpt is empty (the bug)', () => {
    const blocks = [para('Intro paragraph'), para('In conclusion, this is the final closing thought of the article.')] as any;
    const out = ensureClassicSummaryBlock(blocks, '');
    expect(summaries(out)).toHaveLength(0); // no duplicate summary appended
  });

  it('omits the summary when the excerpt echoes an existing block (no end duplication)', () => {
    const conclusion = 'In conclusion this is the final closing thought of the article that wraps everything up neatly';
    const blocks = [para('Intro paragraph'), para(conclusion)] as any;
    const out = ensureClassicSummaryBlock(blocks, conclusion);
    expect(summaries(out)).toHaveLength(0);
  });

  it('omits the summary when the excerpt is a substring of a body paragraph', () => {
    const blocks = [para('A long intro that contains the phrase the unique takeaway readers remember and then continues on further.')] as any;
    const out = ensureClassicSummaryBlock(blocks, 'the unique takeaway readers remember');
    expect(summaries(out)).toHaveLength(0);
  });

  it('inserts a distinct summary BEFORE references', () => {
    const blocks = [para('Intro about apples'), para('Body about oranges and bananas'), { id: 'r', type: 'references' }] as any;
    const out = ensureClassicSummaryBlock(blocks, 'A concise distinct synthesis of the key takeaways for the reader.');
    expect(out.map((b: any) => b.type)).toEqual(['paragraph', 'paragraph', 'summary', 'references']);
    expect(summaries(out)[0].body).toMatch(/concise distinct synthesis/);
  });

  it('appends a distinct summary at the END when there are no references', () => {
    const blocks = [para('Intro about apples'), para('Body about oranges')] as any;
    const out = ensureClassicSummaryBlock(blocks, 'A wholly different concluding synthesis for readers to remember.');
    expect(out[out.length - 1].type).toBe('summary');
    expect(summaries(out)).toHaveLength(1);
  });
});

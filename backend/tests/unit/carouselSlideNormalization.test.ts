/**
 * CAMPAIGN-AUDIT-004 renderer fixes.
 *
 * RC-2: a carousel slide whose body is a leaked design-directive sentence gets
 *   stripped to '' by stripPromptDirectives; the old `|| fallbackLabel` inside
 *   the String() was already bypassed, so the slide rendered a BLANK body. The
 *   fix re-falls back to real campaign copy after stripping.
 * RC-3: the deck path had no cross-slide dedupe, so duplicate upstream titles
 *   rendered identical slides. The fix differentiates (never drops) a slide
 *   whose headline repeats an earlier one.
 */
import { normalizeStructuredItems, stripPromptDirectives } from '../../services/creatorAssetRendererCarousel';

describe('AUDIT-004 RC-2 — no carousel slide renders a blank body', () => {
  it('re-falls back to campaign copy when the body strips to empty', () => {
    // sanity: this body IS wiped by the directive stripper
    expect(stripPromptDirectives('Use a clean, modern illustration style with a bold palette.')).toBe('');

    const out = normalizeStructuredItems(
      [{ headline: 'Why It Matters Now', body: 'Use a clean, modern illustration style with a bold palette.' }],
      'Creator carousel asset',
      'carousel',
      { summary: 'Inconsistent lead flow quietly caps your growth.', topic: 'Lead flow' },
    );
    expect(out).toHaveLength(1);
    expect(out[0].body.trim().length).toBeGreaterThan(0);
    // falls back to the real summary, NOT a blank and NOT the generic label
    expect(out[0].body).toBe('Inconsistent lead flow quietly caps your growth.');
    expect(out[0].body).not.toBe('Creator carousel asset');
  });

  it('uses the generic label only as a last resort (no summary/objective/topic)', () => {
    const out = normalizeStructuredItems(
      [{ headline: 'Slide A', body: 'Ensure the layout uses a clean typography hierarchy.' }],
      'Creator carousel asset',
      'carousel',
      {},
    );
    expect(out[0].body).toBe('Creator carousel asset');
  });
});

describe('AUDIT-004 RC-3 — duplicate slide headlines are differentiated, never dropped', () => {
  it('differentiates a repeated headline while keeping every slide', () => {
    const out = normalizeStructuredItems(
      [
        { headline: 'Unlock Thought Leadership', body: 'Point one about the topic.' },
        { headline: 'Unlock Thought Leadership', body: 'A different second point.' },
      ],
      'Creator carousel asset',
      'carousel',
      { topic: 'Thought Leadership' },
    );
    expect(out).toHaveLength(2); // never dropped
    expect(out[0].headline).toBe('Unlock Thought Leadership');
    expect(out[1].headline).not.toBe(out[0].headline); // differentiated
    expect(out[1].headline.trim().length).toBeGreaterThan(0);
    // bodies preserved
    expect(out[0].body).toBe('Point one about the topic.');
    expect(out[1].body).toBe('A different second point.');
  });

  it('leaves genuinely distinct headlines untouched', () => {
    const out = normalizeStructuredItems(
      [
        { headline: 'The problem', body: 'Body one.' },
        { headline: 'The solution', body: 'Body two.' },
      ],
      'Creator carousel asset',
      'carousel',
      { topic: 'Growth' },
    );
    expect(out.map((s) => s.headline)).toEqual(['The problem', 'The solution']);
  });
});

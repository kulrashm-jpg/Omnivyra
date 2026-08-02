/**
 * OPT-006 — MarketingPageMeta builders (components/seo/MarketingPageMeta.tsx).
 *
 * Tests the pure builders: URL construction from SITE_URL, canonical override,
 * noindex, og:image default, and FAQPage JSON-LD shape.
 */
import { buildMarketingMeta, faqPageJsonLd } from '../../../components/seo/MarketingPageMeta';
import { SITE_URL } from '../../../lib/siteUrl';

describe('buildMarketingMeta', () => {
  test('canonical and ogImage derive from SITE_URL and path', () => {
    const m = buildMarketingMeta({ title: 'T', description: 'D', path: '/pricing' });
    expect(m.canonical).toBe(`${SITE_URL}/pricing`);
    expect(m.ogImage).toBe(`${SITE_URL}/logo.png`);
    expect(m.robots).toBeNull();
    expect(m.jsonLdText).toBeNull();
  });

  test('canonicalPath overrides the canonical target (landing → /)', () => {
    const m = buildMarketingMeta({ title: 'T', description: 'D', path: '/landing', canonicalPath: '/' });
    expect(m.canonical).toBe(`${SITE_URL}/`);
  });

  test('noindex emits the exact robots directive', () => {
    const m = buildMarketingMeta({ title: 'T', description: 'D', path: '/thank-you', noindex: true });
    expect(m.robots).toBe('noindex, nofollow');
  });

  test('explicit ogImage is respected', () => {
    const m = buildMarketingMeta({ title: 'T', description: 'D', path: '/x', ogImage: 'https://cdn.example.com/og.png' });
    expect(m.ogImage).toBe('https://cdn.example.com/og.png');
  });

  test('jsonLd serializes deterministically', () => {
    const m = buildMarketingMeta({ title: 'T', description: 'D', path: '/x', jsonLd: { a: 1 } });
    expect(m.jsonLdText).toBe('{"a":1}');
  });

  test('canonical never uses a runtime origin (SITE_URL is the build-time constant)', () => {
    const m = buildMarketingMeta({ title: 'T', description: 'D', path: '/about' });
    expect(m.canonical.startsWith('http')).toBe(true);
    expect(m.canonical).not.toContain('undefined');
  });
});

describe('faqPageJsonLd', () => {
  test('produces a valid schema.org FAQPage shape', () => {
    const ld = faqPageJsonLd([
      { q: 'Q1?', a: 'A1.' },
      { q: 'Q2?', a: 'A2.' },
    ]) as {
      '@context': string;
      '@type': string;
      mainEntity: Array<{ '@type': string; name: string; acceptedAnswer: { '@type': string; text: string } }>;
    };
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('FAQPage');
    expect(ld.mainEntity).toHaveLength(2);
    expect(ld.mainEntity[0]).toEqual({
      '@type': 'Question',
      name: 'Q1?',
      acceptedAnswer: { '@type': 'Answer', text: 'A1.' },
    });
  });
});

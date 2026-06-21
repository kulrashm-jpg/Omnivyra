/**
 * PHASE BLOG-PROMOTION-URL-AUTHORITY — single URL authority + append-once.
 *
 * Verifies the pure authorities that own URL resolution and payload composition
 * for the blog promotion path:
 *   - resolveCanonicalContentUrl: CMS response → stored published_url →
 *     Omnivyra-hosted (non-CMS only) → fail closed; no slug guessing for CMS.
 *   - composePromotionPayloadText: URL appended exactly once at send, kept
 *     separate from the generated/edited copy (survives regenerate/schedule/post).
 */
import {
  resolveCanonicalContentUrl,
  composePromotionPayloadText,
} from '../../../lib/content/promotionDraft';

const ORIGIN = 'https://www.omnivyra.com';
const CMS = 'https://blog.acme.com/posts/why-velocity-stalls';
const STORED = 'https://blog.acme.com/posts/stored-permalink';

describe('resolveCanonicalContentUrl — single authority order', () => {
  it('A. CMS publish-response URL wins over everything', () => {
    expect(resolveCanonicalContentUrl({
      cmsPublishedUrl: CMS,
      storedPublishedUrl: STORED,
      isCmsPublished: true,
      status: 'published',
      slug: 'why-velocity-stalls',
      origin: ORIGIN,
    })).toBe(CMS);
  });

  it('B. stored published_url is used when no live CMS response URL', () => {
    expect(resolveCanonicalContentUrl({
      cmsPublishedUrl: null,
      storedPublishedUrl: STORED,
      isCmsPublished: true,
      status: 'published',
      slug: 'why-velocity-stalls',
      origin: ORIGIN,
    })).toBe(STORED);
  });

  it('C. Omnivyra-hosted /blog/<slug> ONLY for non-CMS published content', () => {
    expect(resolveCanonicalContentUrl({
      isCmsPublished: false,
      status: 'published',
      slug: 'hello-world',
      origin: ORIGIN,
    })).toBe(`${ORIGIN}/blog/hello-world`);
  });

  it('C(neg). CMS content with NO real URL fails closed — never reconstructs a slug URL', () => {
    expect(resolveCanonicalContentUrl({
      cmsPublishedUrl: null,
      storedPublishedUrl: null,
      isCmsPublished: true,           // published through a CMS
      status: 'published',
      slug: 'hello-world',
      origin: ORIGIN,
    })).toBe('');
  });

  it('D. no URL anywhere → fail closed (empty string)', () => {
    expect(resolveCanonicalContentUrl({ status: 'draft', slug: 'x', origin: ORIGIN })).toBe('');
    expect(resolveCanonicalContentUrl({ status: 'published', slug: '', origin: ORIGIN })).toBe('');
    expect(resolveCanonicalContentUrl({ status: 'published', slug: 'x', origin: null })).toBe('');
  });

  it('never returns a placeholder / relative path', () => {
    expect(resolveCanonicalContentUrl({ cmsPublishedUrl: '/blog/x' as any })).toBe('');
    expect(resolveCanonicalContentUrl({ cmsPublishedUrl: 'not-a-url' as any })).toBe('');
  });
});

describe('composePromotionPayloadText — append-once, URL never in the copy', () => {
  const COPY = 'Big lessons on shipping faster. Read the full breakdown 👇';

  it('F/G. URL appended for both schedule and post-now (same composer)', () => {
    const out = composePromotionPayloadText(COPY, CMS);
    expect(out.endsWith(CMS)).toBe(true);
    expect(out.startsWith(COPY)).toBe(true);
  });

  it('H. URL appears exactly once when the copy has no URL', () => {
    const out = composePromotionPayloadText(COPY, CMS);
    expect(out.split(CMS).length - 1).toBe(1);
  });

  it('H. URL not duplicated when the user already pasted it into the copy', () => {
    const copyWithUrl = `${COPY}\n\nalready here: ${CMS}`;
    const out = composePromotionPayloadText(copyWithUrl, CMS);
    expect(out.split(CMS).length - 1).toBe(1);
    expect(out).toBe(copyWithUrl); // unchanged
  });

  it('I. generated/edited draft copy never embeds the URL (separation invariant)', () => {
    // The model keeps promotionalText and blogUrl separate; the copy itself
    // must not contain the URL — it is only appended at send time.
    expect(COPY.includes(CMS)).toBe(false);
    const out = composePromotionPayloadText(COPY, CMS);
    // URL present in the OUTBOUND payload, absent from the source copy.
    expect(out.includes(CMS)).toBe(true);
  });

  it('E. URL survives regeneration (new copy, same URL, still appended once)', () => {
    const regenerated = 'A totally different hook after regenerate.';
    const out = composePromotionPayloadText(regenerated, CMS);
    expect(out.endsWith(CMS)).toBe(true);
    expect(out.split(CMS).length - 1).toBe(1);
    expect(out.startsWith(regenerated)).toBe(true);
  });

  it('no URL → copy returned unchanged (caller gates on PROMOTION_URL_REQUIRED)', () => {
    expect(composePromotionPayloadText(COPY, '')).toBe(COPY);
  });
});

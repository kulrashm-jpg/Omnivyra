/**
 * Carousel slide integrity — CTA survival, CTA validation, no duplicate slide.
 *
 * Three defects, each proven on main @ 9a786aab:
 *   C-a  validateCarousel demanded a top-level `cta_slide` the prompt forbids,
 *        so every correctly-shaped carousel recorded "Missing call-to-action".
 *   C-b  platform adaptation cut decks with a plain `.slice(0, n)` BEFORE
 *        render, and the CTA is always the last slide — so it was the one lost.
 *   C-c  `[url, ...files]` with `url = files[0]` persisted slide 1 twice, and the
 *        reload reader showed it twice.
 *
 * These modules are shared with the BOLT/campaign path; the behaviour pinned
 * here is the shared behaviour (see the BOLT-impact note in the PR).
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
// creatorOrchestrator's import graph reaches the BullMQ client, which parses
// REDIS_URL at module load; extractMediaUrls itself never touches a queue.
jest.mock('../../queue/bullmqClient', () => ({}));

import { trimSlidesPreservingCta, repurposeCarouselForPlatforms } from '../../services/creatorContentRepurposingEngine';
import { validateCreatorContentQuality } from '../../services/creatorContentValidation';
import { resolveSavedAssetMedia } from '../../../lib/creator-content/creatorWorkflowModel';
import { PLATFORM_RULES } from '../../services/executionEngines/creatorExecutionEnginePrep';
import { extractMediaUrls } from '../../services/creator/creatorOrchestrator';

type Slide = { role: string; headline: string; body_text: string; visual_description: string };
const slide = (role: string, n: number): Slide => ({
  role,
  headline: `Headline number ${n}`,
  body_text: `This is a full sentence of body text for slide ${n} that is long enough.`,
  visual_description: `A clear visual description for slide ${n}.`,
});
const deck = (contentCount: number, withCta = true): Slide[] => [
  ...Array.from({ length: contentCount }, (_, i) => slide(i === 0 ? 'hook' : 'insight', i + 1)),
  ...(withCta ? [slide('cta', contentCount + 1)] : []),
];

describe('C-b — trimming a deck never drops its CTA', () => {
  it('a deck within the limit is returned whole and in order', () => {
    const d = deck(3);
    expect(trimSlidesPreservingCta(d, 5)).toEqual(d);
  });

  it('a deck over the limit keeps the first (limit-1) content slides plus the CTA', () => {
    const d = deck(5); // 6 slides, CTA last
    const out = trimSlidesPreservingCta(d, 5);
    expect(out).toHaveLength(5);
    expect(out[4].role).toBe('cta');
    expect(out.slice(0, 4)).toEqual(d.slice(0, 4));
  });

  it('role matching is case-insensitive', () => {
    const d = deck(5);
    d[5] = { ...d[5], role: ' CTA ' };
    expect(trimSlidesPreservingCta(d, 3).map((s) => s.role)).toEqual(['hook', 'insight', ' CTA ']);
  });

  it('a deck with no CTA is cut exactly like a plain slice (unchanged behaviour)', () => {
    const d = deck(6, false);
    expect(trimSlidesPreservingCta(d, 4)).toEqual(d.slice(0, 4));
  });

  it('an unusable limit returns the deck whole', () => {
    const d = deck(4);
    expect(trimSlidesPreservingCta(d, 0)).toEqual(d);
    expect(trimSlidesPreservingCta(d, Number.NaN)).toEqual(d);
  });

  it.each(
    Object.entries(PLATFORM_RULES).filter(([, r]) => typeof r.slideLimit === 'number'),
  )('the %s platform slide limit keeps order and the CTA of an over-long deck', (_platform, rule) => {
    const limit = rule.slideLimit!;
    const d = deck(limit + 3); // limit + 4 slides, CTA last
    const out = trimSlidesPreservingCta(d, limit);
    expect(out).toHaveLength(limit);
    expect(out.slice(0, limit - 1)).toEqual(d.slice(0, limit - 1));
    expect(out[limit - 1]).toBe(d[d.length - 1]);
    expect(out.filter((s) => s.role === 'cta')).toHaveLength(1);
  });

  it('a CTA already inside the limit is not moved', () => {
    const d = [slide('hook', 1), slide('cta', 2), slide('insight', 3), slide('insight', 4)];
    expect(trimSlidesPreservingCta(d, 3)).toEqual(d.slice(0, 3));
  });

  it('Pinterest: repurposing (7) then the platform rule (6) still ends on the CTA', async () => {
    const variants = await repurposeCarouselForPlatforms({ slides: deck(9) }, ['pinterest']);
    const repurposed = variants.pinterest.slides as Slide[];
    expect(repurposed).toHaveLength(7);
    const final = trimSlidesPreservingCta(repurposed, PLATFORM_RULES.pinterest.slideLimit!);
    expect(final).toHaveLength(6);
    expect(final[5].role).toBe('cta');
    expect(final.slice(0, 5).map((s) => s.headline)).toEqual(deck(9).slice(0, 5).map((s) => s.headline));
  });

  it('repurposing for LinkedIn (optimal 5) keeps the CTA of a 6-slide deck', async () => {
    const variants = await repurposeCarouselForPlatforms({ slides: deck(5) }, ['linkedin']);
    const slides = variants.linkedin.slides as Slide[];
    expect(slides).toHaveLength(5);
    expect(slides[slides.length - 1].role).toBe('cta');
    expect(variants.linkedin.total_slides).toBe(5);
  });
});

describe('C-a — the validator accepts the CTA where the prompt puts it', () => {
  const issuesFor = async (blueprint: Record<string, unknown>) =>
    (await validateCreatorContentQuality(blueprint, 'carousel')).issues ?? [];

  it('an in-deck CTA (role "cta") is not reported missing', async () => {
    const issues = await issuesFor({ slides: deck(4) });
    expect(issues).not.toContain('Missing call-to-action slide');
    expect(issues).not.toContain('CTA slide missing action text');
  });

  it('a legacy top-level cta_slide with text is still accepted', async () => {
    const issues = await issuesFor({ slides: deck(4, false), cta_slide: { cta_text: 'Book a demo today' } });
    expect(issues).not.toContain('Missing call-to-action slide');
  });

  it('a deck with no CTA at all is still reported missing', async () => {
    expect(await issuesFor({ slides: deck(4, false) })).toContain('Missing call-to-action slide');
  });

  it('an empty cta_text does not hide the CTA body text', async () => {
    const d = deck(4);
    d[4] = { ...d[4], cta_text: '' } as Slide;
    expect(await issuesFor({ slides: d })).not.toContain('CTA slide missing action text');
  });

  it('a legacy cta_slide with no text at all is reported as missing action text', async () => {
    expect(await issuesFor({ slides: deck(4, false), cta_slide: { cta_text: '' } }))
      .toContain('CTA slide missing action text');
  });

  it('a CTA with no text at all is reported as missing action text', async () => {
    const d = deck(4);
    d[4] = { ...d[4], headline: '', body_text: '' };
    expect(await issuesFor({ slides: d })).toContain('CTA slide missing action text');
  });
});

describe('C-c — extractMediaUrls lists each rendered slide once', () => {
  const output = (media_bundle: Record<string, unknown>) =>
    ({ asset_payload: { media_bundle } } as unknown as Parameters<typeof extractMediaUrls>[0]);

  it('a deck whose url is files[0] is listed once per slide, in order', () => {
    const files = ['https://cdn/s-1.png', 'https://cdn/s-2.png', 'https://cdn/s-3.png'];
    expect(extractMediaUrls(output({ url: files[0], files }))).toEqual(files);
  });

  it('whitespace variants of the same url collapse, first occurrence kept', () => {
    expect(extractMediaUrls(output({ url: ' https://cdn/a.png ', files: ['https://cdn/b.png', 'https://cdn/a.png'] })))
      .toEqual(['https://cdn/a.png', 'https://cdn/b.png']);
  });

  it('a single image (url only) and a distinct url + files are unchanged', () => {
    expect(extractMediaUrls(output({ url: 'https://cdn/one.png' }))).toEqual(['https://cdn/one.png']);
    expect(extractMediaUrls(output({ url: 'https://cdn/cover.png', files: ['https://cdn/x.png'] })))
      .toEqual(['https://cdn/cover.png', 'https://cdn/x.png']);
  });
});

describe('C-c — slide 1 is never listed twice on reload', () => {
  it('the reload reader de-duplicates rows persisted with [url, ...files]', () => {
    const files = ['https://cdn/c-1.png', 'https://cdn/c-2.png', 'https://cdn/c-3.png'];
    expect(resolveSavedAssetMedia({ files: [files[0], ...files] })).toEqual(files);
    expect(resolveSavedAssetMedia({ metadata: { files: [files[0], ...files] } })).toEqual(files);
  });

  it('distinct files keep their order', () => {
    const files = ['https://cdn/a.png', 'https://cdn/b.png'];
    expect(resolveSavedAssetMedia({ files })).toEqual(files);
  });
});

/**
 * Creator text: the words come from the user's source text, and they FIT the design.
 *
 * Owner decision (2026-10-24): whichever way an asset starts — the user writes the brief,
 * "Create with AI", "Suggest with AI", or Writer content (post/blog) → add image /
 * carousel / infographic — that source text drives the copy. The company profile only
 * shapes tone and angle; it is never pasted in as the message. And the copy must fit:
 * a single image within its word budget, every slide/section within its block, never
 * cut mid-word.
 *
 * Production failure pinned here (2026-10-24, banner profile, 30 words): headline 77 +
 * keyInsight 190 + supporting 90 + cta 10 chars → ~58 words → render_manifest_rejected:
 * text_density_exceeds_profile, while the real cause (image model unavailable) was hidden.
 *
 * SECRETS: none. Pure functions, synthetic copy.
 */
import { clipWords, deriveMainMessage } from '../../../lib/creator-content/creatorBrief';
import { describeCreatorGenerationError } from '../../../lib/creator-content/creatorErrorMessages';
import { mapBriefToEditorAnswers } from '../../../lib/creator-content/creatorWorkflowModel';
import { deterministicTransform, profileClause } from '../../services/creator/creatorFieldAssistService';
import { mapCreatorCompanyContext } from '../../services/context/canonicalContentContextResolver';
import {
  clipCopyToChars,
  fitOverlayToTotalBudget,
  fitSlideCopy,
  governImageOverlayText,
  validateVisualGovernance,
} from '../../services/creatorAssetGovernance';
import { balanceTextLines, classifyProviderImageError, BLOCKING_PROVIDER_FAILURES } from '../../services/creatorAssetRendererContracts';
import { normalizeStructuredItems, CAROUSEL_BODY_MAX_CHARS } from '../../services/creatorAssetRendererCarousel';
import { resolveInfographicSections } from '../../services/creatorAssetRendererCompose';

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
/** True when `clipped` ends on a whole word of `original`. */
const endsOnWord = (original: string, clipped: string) => {
  const o = original.replace(/\s+/g, ' ').trim();
  const c = clipped.replace(/\s+/g, ' ').trim();
  if (!c || c === o) return true;
  const next = o.charAt(o.indexOf(c) + c.length);
  return next === '' || /[\s.,;:!?—–-]/.test(next);
};

// The run-on profile analysis text that became the production main message.
const PROFILE_RUN_ON = 'Differentiate through trust model: recurring audience trust through publishing cadence; audience distinction: Marketing teams, Small to medium businesses, Content creators, Marketing agencies; evidence-based decision making';
const USER_MESSAGE = 'Plan a month of on-brand posts in under an hour.';

/* ── 1. The source text becomes the main message (all four entry paths) ───────── */

describe('main message — from the source text, one clean sentence', () => {
  it('a run-on "a; b; c" paragraph is not one message: the first clause is', () => {
    const m = deriveMainMessage(PROFILE_RUN_ON);
    expect(m).toBe('Differentiate through trust model: recurring audience trust through publishing cadence');
  });

  it('long text is shortened on a word boundary, never "…Marketi"', () => {
    const long = 'Marketing teams, Small to medium businesses, Content creators, Marketing agencies and consultants worldwide';
    const clipped = clipWords(long, 70);
    expect(clipped.length).toBeLessThanOrEqual(70);
    expect(endsOnWord(long, clipped)).toBe(true);
    expect(clipped).not.toMatch(/Marketi$/);
  });

  it('"Write it yourself" / "Create with AI" / "Suggest with AI": the brief seeds the main message, not the whole paragraph', () => {
    const brief = { freeText: `${USER_MESSAGE} Our planner drafts, schedules and checks every post against your brand voice.` } as never;
    const config = { fields: [{ id: 'keyMessage' }, { id: 'headline' }, { id: 'topic' }] } as never;
    const answers = mapBriefToEditorAnswers(brief, config);
    expect(answers.keyMessage).toBe(USER_MESSAGE);
    expect(answers.headline).toBe(USER_MESSAGE);
  });
});

/* ── 2. The profile shapes tone, it is never pasted in as copy ────────────────── */

describe('company profile — informs the angle, never becomes the message', () => {
  const field = (key: string, maxLength = 160) => ({ key, label: key, control: 'text', required: false, maxLength }) as never;
  const company = { positioning: PROFILE_RUN_ON, differentiators: PROFILE_RUN_ON, products: ['Omnivyra Planner'] } as never;

  it.each(['freeText', 'hook', 'keyInsight', 'headline'])('fallback for %s uses the user\'s main message first', (key) => {
    const out = deterministicTransform('generate', field(key), '', { mainMessage: USER_MESSAGE, company, topic: 'Promote an Event' });
    expect(out.toLowerCase()).toContain('plan a month of on-brand posts');
    expect(out).not.toMatch(/trust model|audience distinction|differentiate through/i);
  });

  it('with no user text, a profile fact is ONE clause without analysis labels', () => {
    const out = deterministicTransform('generate', field('freeText', 320), '', { company: { positioning: PROFILE_RUN_ON } as never });
    expect(out).not.toMatch(/trust model|audience distinction|differentiate through|;/i);
    expect(out.length).toBeLessThanOrEqual(140);
  });

  it('profileClause strips labels and keeps one clause', () => {
    expect(profileClause(PROFILE_RUN_ON)).toBe('Recurring audience trust through publishing cadence'.replace(/^R/, 'r'));
  });

  it('Creator company context arrives without the strategy engine\'s analysis labels', () => {
    const ctx = mapCreatorCompanyContext({ biggest_advantage: PROFILE_RUN_ON } as never);
    expect(ctx.differentiators).toBeDefined();
    expect(ctx.differentiators).not.toMatch(/trust model|audience distinction|differentiate through/i);
  });
});

/* ── 3. Text inside the image: the total fits the budget ─────────────────────── */

describe('single image (text inside) — the copy fits the profile, headline and CTA survive', () => {
  const PROD_OVERLAY = {
    hook: '',
    headline: 'A unified AI-driven platform that addresses the chaos of disjointed marketing',
    keyInsight: 'Differentiate through trust model recurring audience trust through publishing cadence and evidence-based decision making for marketing teams small to medium businesses content creators and agencies everywhere today',
    supportingText: 'Transform your marketing chaos into clarity with real-time insights and smarter decisions.',
    cta: 'Learn more',
  };

  it('the production overlay no longer exceeds the 30-word banner budget', () => {
    const { governedOverlay, safeTextBlocks } = governImageOverlayText({ assetType: 'banner', overlay: PROD_OVERLAY, allowCTA: true });
    const total = safeTextBlocks.reduce((n, b) => n + words(b), 0);
    expect(total).toBeLessThanOrEqual(30);
    expect(governedOverlay.headline).toBe(PROD_OVERLAY.headline);
    expect(governedOverlay.cta).toBe('Learn more');
    const verdict = validateVisualGovernance({ assetType: 'banner', platform: 'instagram', textBlocks: safeTextBlocks, hasCTA: true });
    expect(verdict.errors).not.toContain('text_density_exceeds_profile');
  });

  it('NEGATIVE CONTROL — the same copy summed without the total-budget pass fails closed', () => {
    const blocks = Object.values(PROD_OVERLAY).filter(Boolean);
    const verdict = validateVisualGovernance({ assetType: 'banner', platform: 'instagram', textBlocks: blocks, hasCTA: true });
    expect(verdict.errors).toContain('text_density_exceeds_profile');
  });

  it('only the fields the layout paints are kept and counted', () => {
    const { governedOverlay } = governImageOverlayText({
      assetType: 'banner', overlay: PROD_OVERLAY, allowCTA: true, paintedFields: ['headline', 'supportingText', 'cta'],
    });
    expect(governedOverlay.keyInsight).toBe('');
    expect(governedOverlay.hook).toBe('');
    expect(governedOverlay.supportingText).toBe(PROD_OVERLAY.supportingText);
  });

  it('copy that already fits is untouched', () => {
    const fields = { hook: '', headline: 'Plan a month in an hour', keyInsight: '', supportingText: 'Drafts, schedules and checks every post.', cta: 'Start free' };
    expect(fitOverlayToTotalBudget({ ...fields }, 30)).toBe(false);
  });
});

/* ── 4. Carousel and infographic: every slide / section fits its block ───────── */

describe('carousel — every slide fitted before it is drawn', () => {
  const LONG_BODY = 'Our planner drafts every post from your brief. It schedules them across channels at the best times. It checks tone, claims and links against your brand voice before anything ships, so nothing goes out off-brand.';

  it('slides stay within the per-slide word budget and the body block, ending on whole words', () => {
    const slides = normalizeStructuredItems(
      [{ headline: 'Plan a month in an hour', body: LONG_BODY }, { headline: 'One brief, every channel', body: LONG_BODY }],
      'Slide', 'carousel', {},
    );
    for (const s of slides) {
      expect(words(`${s.headline} ${s.body}`)).toBeLessThanOrEqual(34);
      expect(s.body.length).toBeLessThanOrEqual(CAROUSEL_BODY_MAX_CHARS);
      expect(endsOnWord(LONG_BODY, s.body)).toBe(true);
      expect(s.body.length).toBeGreaterThan(0);
    }
  });

  it('fitSlideCopy keeps whole sentences first', () => {
    const { body } = fitSlideCopy({ headline: 'Plan faster', body: LONG_BODY }, { maxWords: 34, maxBodyChars: 112 });
    expect(body).toBe('Our planner drafts every post from your brief. It schedules them across channels at the best times.');
  });
});

describe('infographic — section titles and bodies never cut mid-word', () => {
  it('long "Label: detail" items are clipped on word boundaries', () => {
    const detail = 'Every post is drafted from your brief, scheduled across your channels and checked against your brand voice before it ships anywhere';
    const sections = resolveInfographicSections(
      { overlay_text: { headline: `Plan a whole month of on-brand social posts in under one hour: ${detail}` } },
      { topic: 'Planning' },
    );
    // Sections are built from hook (topic), headline, … — pick the one from the headline.
    const first = sections.find((s) => s.title.startsWith('Plan a whole'))!;
    expect(first).toBeDefined();
    expect(first.title.length).toBeLessThanOrEqual(52);
    expect(endsOnWord('Plan a whole month of on-brand social posts in under one hour', first.title)).toBe(true);
    expect(first.body.length).toBeLessThanOrEqual(120);
    expect(endsOnWord(detail, first.body)).toBe(true);
  });

  it('clipCopyToChars prefers whole sentences, then whole words', () => {
    expect(clipCopyToChars('One. Two three four five six.', 8)).toBe('One.');
    expect(clipCopyToChars('alpha beta gamma delta', 12)).toBe('alpha beta');
  });
});

describe('overlay line breaking — the last line ends on a whole word', () => {
  it('never severs a word when clipping the final line', () => {
    const text = 'Transform your marketing chaos into clarity with real-time insights and smarter decisions';
    const lines = balanceTextLines(text, 30, 2);
    const last = lines[lines.length - 1];
    expect(endsOnWord(text, last)).toBe(true);
  });
});

/* ── 5. A provider failure is reported as itself ─────────────────────────────── */

describe('AI image provider failure — named, not hidden behind a copy code', () => {
  it('"model does not exist" is a model_unavailable failure that blocks the render', () => {
    const kind = classifyProviderImageError({ status: 400, message: "400 The model 'gpt-image-1' does not exist." });
    expect(kind).toBe('model_unavailable');
    expect(BLOCKING_PROVIDER_FAILURES.has(kind)).toBe(true);
  });

  it('a timeout or 5xx stays transient (existing fallback kept)', () => {
    expect(classifyProviderImageError({ status: 503, message: 'Service Unavailable' })).toBe('transient');
    expect(classifyProviderImageError(new Error('Request timed out'))).toBe('transient');
    expect(BLOCKING_PROVIDER_FAILURES.has('transient')).toBe(false);
  });

  it('auth and quota failures are recognised', () => {
    expect(classifyProviderImageError({ status: 401, message: 'Incorrect API key provided' })).toBe('auth');
    expect(classifyProviderImageError({ status: 429, code: 'insufficient_quota', message: 'You exceeded your current quota' })).toBe('quota');
  });

  it('the UI shows a readable reason, the provider cause first, and keeps the code', () => {
    const msg = describeCreatorGenerationError('governed_render_failed_closed:provider_image_unavailable:model_unavailable');
    expect(msg).toMatch(/AI image generation is unavailable/);
    expect(msg).toMatch(/code: governed_render_failed_closed:provider_image_unavailable:model_unavailable/);
    expect(describeCreatorGenerationError('governed_render_failed_closed:render_manifest_rejected:text_density_exceeds_profile'))
      .toMatch(/longer than this design can hold/);
    expect(describeCreatorGenerationError('Something else')).toBe('Something else');
  });
});

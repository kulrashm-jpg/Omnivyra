/**
 * BOLT format-governance regression tests (Part 2).
 *
 * Protect the canonical accept/reject sets the failure-hardening pass
 * codified. If anyone narrows the registry these tests fail loudly so
 * a deploy can't silently start rejecting valid format combinations.
 */

import {
  isSupportedTextFormat,
  getUnsupportedTextFormats,
  validateExecutionConfigFormats,
  resolveCampaignMode,
  getTextFormatsFromExecutionConfig,
} from '../../../lib/shared/bolt/formatGovernance';
import {
  isAutonomousRenderableFormat,
  isAttachmentRequiredFormat,
} from '../../../lib/shared/creatorGovernanceRegistry';

describe('Text format registry — regression protection', () => {
  test.each([
    ['post', true],
    ['tweet', true],
    ['poll', true],
    ['article', true],
    ['short_story', true],
    ['feed_post', true],   // alias → post
    ['linkedin_post', true], // alias → post
    ['x_post', true],       // alias → tweet
    ['blog', false],
    ['whitepaper', false],
    ['white_paper', false],
    ['video', false],
    ['reel', false],
    ['', false],
    ['post_video', false],
  ])('isSupportedTextFormat(%s) → %s', (format, expected) => {
    expect(isSupportedTextFormat(format)).toBe(expected);
  });

  test('getUnsupportedTextFormats returns only the bad entries', () => {
    const bad = getUnsupportedTextFormats(['post', 'tweet', 'blog', 'whitepaper', 'article']);
    expect(bad).toEqual(['blog', 'whitepaper']);
  });

  test('getTextFormatsFromExecutionConfig handles both text_formats and content_formats', () => {
    const out = getTextFormatsFromExecutionConfig({
      text_formats: ['post', 'tweet'],
      content_formats: ['article', 'reel'], // reel is creator, must NOT appear
    });
    expect(out.sort()).toEqual(['article', 'post', 'tweet']);
  });
});

describe('Creator format registry — regression protection', () => {
  test('carousel and story remain valid creator formats', () => {
    // story is registered as autonomous (see creatorGovernanceRegistry);
    // carousel is in the attachment-required group.
    expect(isAutonomousRenderableFormat('story') || isAttachmentRequiredFormat('story')).toBe(true);
    expect(isAutonomousRenderableFormat('carousel') || isAttachmentRequiredFormat('carousel')).toBe(true);
  });
});

describe('resolveCampaignMode', () => {
  test('defaults to text when missing or invalid string', () => {
    expect(resolveCampaignMode(undefined)).toBe('text');
    expect(resolveCampaignMode({})).toBe('text');
    expect(resolveCampaignMode({ campaign_mode: '' })).toBe('text');
    expect(resolveCampaignMode({ campaign_mode: 'unknown_mode' })).toBe('text');
  });
  test.each([
    ['creator', 'creator'],
    ['CREATOR', 'creator'],
    ['combined', 'combined'],
    ['text', 'text'],
  ])('campaign_mode=%s → %s', (mode, expected) => {
    expect(resolveCampaignMode({ campaign_mode: mode })).toBe(expected);
  });
});

describe('validateExecutionConfigFormats', () => {
  test('text-mode strategy with all valid text formats passes', () => {
    const r = validateExecutionConfigFormats({ text_formats: ['post', 'tweet', 'poll'] }, 'text');
    expect(r.ok).toBe(true);
    expect(r.unsupportedText).toEqual([]);
    expect(r.noFormatsSelected).toBe(false);
  });

  test('text-mode with an unsupported text format is rejected', () => {
    const r = validateExecutionConfigFormats({ text_formats: ['post', 'blog'] }, 'text');
    expect(r.ok).toBe(false);
    expect(r.unsupportedText).toContain('blog');
  });

  test('text-mode with a creator format in content_formats is rejected', () => {
    // This is the "strategy says text-mode but the payload smuggled a
    // creator-only format like reel into content_formats" case.
    const r = validateExecutionConfigFormats({ content_formats: ['reel'] }, 'text');
    expect(r.ok).toBe(false);
    expect(r.unsupportedText.length).toBeGreaterThan(0);
  });

  test('creator-mode with valid carousel + story passes', () => {
    const r = validateExecutionConfigFormats({ content_formats: ['carousel', 'story'] }, 'creator');
    expect(r.ok).toBe(true);
  });

  test('creator-mode with an unsupported format is rejected', () => {
    const r = validateExecutionConfigFormats({ content_formats: ['carousel', 'completely_made_up_format'] }, 'creator');
    expect(r.ok).toBe(false);
    expect(r.unsupportedCreator).toContain('completely_made_up_format');
  });

  test('empty formats with text mode is rejected', () => {
    const r = validateExecutionConfigFormats({}, 'text');
    expect(r.ok).toBe(false);
    expect(r.noFormatsSelected).toBe(true);
  });
});

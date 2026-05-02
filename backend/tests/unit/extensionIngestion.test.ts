import {
  buildProfileUrl,
  isExtensionCommentPlatform,
  isExtensionDmPlatform,
  normalizeExtensionPlatform,
  normalizeScrapedMessageContent,
  resolvePlatformUserId,
} from '../../../lib/engagement/extensionIngestion';
import { isActionableDmPreview } from '../../../lib/engagement/messageRoles';

describe('extension ingestion normalization', () => {
  it('normalizes platform aliases used by browser/RPA scrapers', () => {
    expect(normalizeExtensionPlatform('X')).toBe('twitter');
    expect(normalizeExtensionPlatform('ig')).toBe('instagram');
    expect(normalizeExtensionPlatform('FB')).toBe('facebook');
    expect(normalizeExtensionPlatform('youtube')).toBe('youtube');
  });

  it('exposes comments where platform interaction is possible and keeps YouTube DM unsupported', () => {
    expect(isExtensionCommentPlatform('linkedin')).toBe(true);
    expect(isExtensionCommentPlatform('x')).toBe(true);
    expect(isExtensionCommentPlatform('youtube')).toBe(true);

    expect(isExtensionDmPlatform('linkedin')).toBe(true);
    expect(isExtensionDmPlatform('instagram')).toBe(true);
    expect(isExtensionDmPlatform('youtube')).toBe(false);
  });

  it('builds stable author ids from profile URLs before username fallbacks', () => {
    expect(resolvePlatformUserId('linkedin', 'https://www.linkedin.com/in/alex/', 'ignored')).toBe(
      'https://www.linkedin.com/in/alex/',
    );
    expect(resolvePlatformUserId('twitter', null, '@alex')).toBe('https://x.com/alex');
    expect(buildProfileUrl('instagram', 'brand.team')).toBe('https://www.instagram.com/brand.team/');
    expect(buildProfileUrl('facebook', 'brand.page')).toBe('https://www.facebook.com/brand.page');
  });

  it('classifies self-authored scraped messages and strips sender prefixes', () => {
    expect(normalizeScrapedMessageContent({ content: 'You: Thanks for writing in' })).toEqual({
      content: 'Thanks for writing in',
      isSelf: true,
      prefixDetected: true,
    });

    expect(normalizeScrapedMessageContent({ content: 'Priya: Is this still available?' })).toEqual({
      content: 'Is this still available?',
      isSelf: false,
      prefixDetected: false,
    });

    expect(normalizeScrapedMessageContent({ content: 'Plain message', sender_self: true })).toEqual({
      content: 'Plain message',
      isSelf: true,
      prefixDetected: false,
    });

    expect(normalizeScrapedMessageContent({
      platform: 'linkedin',
      platform_message_id: 'urn:li:msg_message:(urn:li:fsd_profile:ACoAAABHLfMBdcFeqSWF3MEmltNWsdKyACDMcic,2-thread)',
      sender_username: 'ACoAAABHLfMBdcFeqSWF3MEmltNWsdKyACDMcic',
      content: 'Plain message without You prefix',
    })).toEqual({
      content: 'Plain message without You prefix',
      isSelf: true,
      prefixDetected: false,
    });
  });

  it('rejects LinkedIn notification wrapper previews as DM reply targets', () => {
    expect(isActionableDmPreview('Rajesh: Hi Kuldeep, hope you are doing well')).toBe(true);
    expect(isActionableDmPreview('You: Thanks, I will check')).toBe(true);
    expect(isActionableDmPreview('Kuldeep Rawat sent the following message at 2:04 AM')).toBe(false);
    expect(isActionableDmPreview('Kuldeep Rawat sent the following messages at 11:16 AM')).toBe(false);
  });
});

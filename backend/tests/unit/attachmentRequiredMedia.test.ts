/**
 * Phase 6F-1A — attachment-required media authority tests.
 *
 * Confirms video/podcast/audio (and webinar/interview recording aliases) are
 * one attachment-required family, derived from the registry's Group B, and that
 * AI-rendered (Group A) + text formats are excluded. Pure authority — no
 * behavior rewiring, so it cannot affect BOLT Text / Creator / scheduling.
 */

import {
  ATTACHMENT_REQUIRED_MEDIA_FORMATS,
  isAttachmentRequiredMedia,
  getRequiredAssetType,
  requiresAssetUrl,
  normalizeAttachmentMediaFormat,
  getMediaAssetFamily,
  VIDEO_ASSET_FORMATS,
  AUDIO_ASSET_FORMATS,
} from '@/lib/shared/bolt/attachmentRequiredMedia';
import {
  GROUP_B_ATTACHMENT_REQUIRED_FORMATS,
  isAttachmentRequiredFormat,
} from '@/lib/shared/creatorGovernanceRegistry';

describe('6F-1A — attachment-required media authority', () => {
  test('1/2/3. video, podcast, audio are attachment-required', () => {
    expect(isAttachmentRequiredMedia('video')).toBe(true);
    expect(isAttachmentRequiredMedia('podcast')).toBe(true);
    expect(isAttachmentRequiredMedia('audio')).toBe(true); // alias → podcast
    expect(isAttachmentRequiredMedia('reel')).toBe(true);
    expect(isAttachmentRequiredMedia('short')).toBe(true);
  });

  test('webinar / interview recordings alias onto the video attachment family', () => {
    expect(isAttachmentRequiredMedia('webinar_recording')).toBe(true);
    expect(isAttachmentRequiredMedia('interview_recording')).toBe(true);
    expect(normalizeAttachmentMediaFormat('webinar recording')).toBe('video');
    expect(normalizeAttachmentMediaFormat('audio')).toBe('podcast');
  });

  test('required asset type: video family → video, audio family → audio', () => {
    expect(getRequiredAssetType('video')).toBe('video');
    expect(getRequiredAssetType('reel')).toBe('video');
    expect(getRequiredAssetType('webinar_recording')).toBe('video');
    expect(getRequiredAssetType('podcast')).toBe('audio');
    expect(getRequiredAssetType('audio')).toBe('audio');
  });

  test('requiresAssetUrl mirrors attachment-required classification', () => {
    expect(requiresAssetUrl('video')).toBe(true);
    expect(requiresAssetUrl('podcast')).toBe(true);
    expect(requiresAssetUrl('image')).toBe(false);
  });

  test('AI-rendered (Group A) + text formats are NOT attachment-required', () => {
    for (const f of ['image', 'banner', 'infographic', 'carousel', 'pdf', 'slider', 'story']) {
      expect(isAttachmentRequiredMedia(f)).toBe(false);
      expect(getRequiredAssetType(f)).toBeNull();
    }
    for (const f of ['post', 'thread', 'article', 'tweet']) {
      expect(isAttachmentRequiredMedia(f)).toBe(false);
    }
  });

  test('unknown formats are not attachment-required (fail-closed)', () => {
    expect(isAttachmentRequiredMedia('hologram')).toBe(false);
    expect(isAttachmentRequiredMedia('')).toBe(false);
    expect(getRequiredAssetType('hologram')).toBeNull();
  });

  test('10. membership derives from the registry Group B (no drift, no duplicate list)', () => {
    expect([...ATTACHMENT_REQUIRED_MEDIA_FORMATS].sort()).toEqual([...GROUP_B_ATTACHMENT_REQUIRED_FORMATS].sort());
    // every member is attachment-required per the registry's own predicate
    for (const f of ATTACHMENT_REQUIRED_MEDIA_FORMATS) {
      expect(isAttachmentRequiredFormat(f)).toBe(true);
    }
  });
});

describe('6F-1B — business media taxonomy', () => {
  test('1/2/3. video-family business names normalize → video', () => {
    expect(normalizeAttachmentMediaFormat('webinar_recording')).toBe('video');
    expect(normalizeAttachmentMediaFormat('product_demo')).toBe('video');
    expect(normalizeAttachmentMediaFormat('event_recording')).toBe('video');
    expect(normalizeAttachmentMediaFormat('founder_talk_video')).toBe('video');
  });

  test('4/5/6. audio-family business names normalize → podcast', () => {
    expect(normalizeAttachmentMediaFormat('audio_interview')).toBe('podcast');
    expect(normalizeAttachmentMediaFormat('customer_interview')).toBe('podcast');
    expect(normalizeAttachmentMediaFormat('executive_interview')).toBe('podcast');
    expect(normalizeAttachmentMediaFormat('founder_talk_audio')).toBe('podcast');
  });

  test('7. normalization preserves the existing execution path (attachment-required + family)', () => {
    for (const f of VIDEO_ASSET_FORMATS) {
      expect(isAttachmentRequiredMedia(f)).toBe(true);
      expect(getMediaAssetFamily(f)).toBe('video');
      expect(getRequiredAssetType(f)).toBe('video');
    }
    for (const f of AUDIO_ASSET_FORMATS) {
      expect(isAttachmentRequiredMedia(f)).toBe(true);
      expect(getMediaAssetFamily(f)).toBe('audio');
      expect(getRequiredAssetType(f)).toBe('audio');
    }
  });

  test('8/9/10. every taxonomy member resolves to a real Group-B format (no new path)', () => {
    // Each business name must normalize to a canonical attachment-required
    // format the registry already recognizes — proving no new execution path,
    // no new scheduler/publisher/attachment-validation behavior.
    for (const f of [...VIDEO_ASSET_FORMATS, ...AUDIO_ASSET_FORMATS]) {
      const canonical = normalizeAttachmentMediaFormat(f);
      expect(['video', 'reel', 'short', 'podcast']).toContain(canonical);
      expect(isAttachmentRequiredFormat(canonical)).toBe(true);
    }
  });

  test('taxonomy does NOT capture AI-rendered or text formats', () => {
    for (const f of ['image', 'carousel', 'infographic', 'post', 'article', 'tweet']) {
      expect(getMediaAssetFamily(f)).toBeNull();
      expect(isAttachmentRequiredMedia(f)).toBe(false);
    }
  });
});

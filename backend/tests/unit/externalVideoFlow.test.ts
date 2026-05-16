/**
 * Validation — External Video Attachment Flow (human-production only).
 *
 *   1  uploaded video inheritance
 *   2  pasted URL inheritance (deterministic asset id)
 *   3  platform compatibility enforcement (duration/aspect/platform)
 *   4  override correctness (replace / disable / thumbnail)
 *   5  revert correctness
 *   6  scheduler isolation (flat finalized; content-only patch)
 *   7  platform-native caption preservation (no text fields)
 *   8  no duplicate lineage (idempotent asset id; LIVE unique+immutable)
 *   9  backward compatibility (image finalize untouched; additive DDL)
 *   10 Creator/Text separation
 *
 * Pure modules — no network, no AI rendering. LIVE micro-check uses
 * tx+rollback (content_external_video_asset is immutable-on-delete).
 */

import {
  isPlatformVideoCompatible,
  getVideoCompatiblePlatforms,
  buildExternalVideoAttachment,
  finalizeRowSharedVideo,
  finalizeRowSharedMedia,
} from '../../services/creator/media';

const ATT = {
  asset_id: 'extvid:abc', asset_url: 'https://cdn/clip.mp4',
  override_policy: 'inherit_all' as const,
};
const META = { duration_seconds: 30, aspect_ratio: '9:16' };

describe('Validation-3 — video compatibility (fail-closed)', () => {
  it('platform/duration/aspect/asset-type rules', () => {
    expect(isPlatformVideoCompatible('instagram', 'reel', META).compatible).toBe(true);
    expect(isPlatformVideoCompatible('tiktok', 'short', META).compatible).toBe(true);
    expect(isPlatformVideoCompatible('linkedin', 'video', { duration_seconds: 120, aspect_ratio: '16:9' }).compatible).toBe(true);
    // duration over platform ceiling (YouTube Shorts ≤ 60)
    expect(isPlatformVideoCompatible('youtube', 'short', { duration_seconds: 120 }).reason).toBe('duration_exceeds_platform');
    // aspect not allowed on tiktok
    expect(isPlatformVideoCompatible('tiktok', 'short', { aspect_ratio: '16:9' }).reason).toBe('aspect_incompatible');
    // not a video asset / text-like
    expect(isPlatformVideoCompatible('instagram', 'image', META).reason).toBe('not_video_asset');
    expect(isPlatformVideoCompatible('linkedin', 'post_with_asset', META).reason).toBe('text_like_asset');
    expect(isPlatformVideoCompatible('instagram', 'quantum', META).reason).toBe('unknown_asset');
    expect(isPlatformVideoCompatible('linkedin', 'reel', META).compatible).toBe(false); // reel not LinkedIn-supported
    expect(getVideoCompatiblePlatforms('reel', ['instagram', 'facebook', 'linkedin', 'tiktok'], META))
      .toEqual(['facebook', 'instagram']);
  });
});

describe('Validation-1/2/8 — attach + inheritance + no dup lineage', () => {
  it('deterministic asset id (same core+url ⇒ identical, idempotent)', () => {
    const a = buildExternalVideoAttachment({
      contentCoreId: 'core-1', organizationId: 'org', externalVideoUrl: 'https://cdn/clip.mp4',
      assetType: 'reel', providerType: 'upload',
    });
    const b = buildExternalVideoAttachment({
      contentCoreId: 'core-1', organizationId: 'org', externalVideoUrl: 'https://cdn/clip.mp4',
      assetType: 'reel', providerType: 'youtube',
    });
    expect(a.asset_id).toBe(b.asset_id);                       // no duplicate lineage
    expect(a.asset_id).toMatch(/^extvid:[0-9a-f]{64}$/);
    expect(a.core_asset_row.canonical_asset_family).toBe('video');
    expect(a.core_asset_row.asset_url).toBe('https://cdn/clip.mp4');
    expect(a.events).toContain('external_video_attached');
  });

  it('uploaded/pasted video inherits across compatible platforms', () => {
    for (const p of ['instagram', 'facebook']) {
      const r = finalizeRowSharedVideo({
        intentType: 'creator', platform: p, assetType: 'reel',
        attachment: ATT, videoMeta: META,
      });
      expect(r.content_patch).toEqual({ uploaded_media_url: 'https://cdn/clip.mp4' });
      expect(r.events).toContain('shared_video_inherited');
    }
  });
});

describe('Validation-4/5 — override + revert + thumbnail', () => {
  it('replace / disable / thumbnail override; revert lossless', () => {
    const replaced = finalizeRowSharedVideo({
      intentType: 'creator', platform: 'instagram', assetType: 'reel', attachment: ATT, videoMeta: META,
      overrides: { instagram: { kind: 'replaced', asset_id: 'ig', asset_url: 'https://cdn/ig.mp4', thumbnail_url: 'https://cdn/ig-thumb.jpg' } },
    });
    expect(replaced.content_patch).toEqual({ uploaded_media_url: 'https://cdn/ig.mp4', thumbnail_url: 'https://cdn/ig-thumb.jpg' });
    expect(replaced.events).toContain('video_override_applied');

    const disabled = finalizeRowSharedVideo({
      intentType: 'creator', platform: 'facebook', assetType: 'reel', attachment: ATT, videoMeta: META,
      overrides: { facebook: { kind: 'disabled' } },
    });
    expect(disabled.content_patch).toEqual({ uploaded_media_url: null });

    const reverted = finalizeRowSharedVideo({
      intentType: 'creator', platform: 'facebook', assetType: 'reel', attachment: ATT, videoMeta: META, overrides: {},
    });
    expect(reverted.content_patch).toEqual({ uploaded_media_url: 'https://cdn/clip.mp4' });
  });
});

describe('Validation-6/7/10 — scheduler isolation + Text separation', () => {
  it('content patch is media-only; flat finalized; reuse prevents dup', () => {
    const inc = finalizeRowSharedVideo({
      intentType: 'creator', platform: 'youtube', assetType: 'short',
      attachment: ATT, videoMeta: { duration_seconds: 999 }, // over YouTube ceiling
    });
    expect(inc.applied).toBe(false);
    expect(inc.finalized).toEqual({ platform: 'youtube', media_url: null, media_source: 'incompatible' });
    expect(inc.events).toContain('incompatible_video_skipped');

    const reused = finalizeRowSharedVideo({
      intentType: 'creator', platform: 'instagram', assetType: 'reel', attachment: ATT, videoMeta: META,
      existingUploadedUrl: 'https://cdn/clip.mp4',
    });
    expect(reused.reused).toBe(true);
    expect(reused.content_patch).toBeNull();
    expect(reused.events).toContain('shared_video_reused');

    const ok = finalizeRowSharedVideo({ intentType: 'creator', platform: 'instagram', assetType: 'reel', attachment: ATT, videoMeta: META });
    for (const k of ['caption', 'hashtags', 'cta', 'meta_description', 'scheduler_row']) {
      expect(k in (ok.content_patch ?? {})).toBe(false);
    }
    // Text rows never produce a video patch
    const text = finalizeRowSharedVideo({ intentType: 'text', platform: 'instagram', assetType: 'reel', attachment: ATT, videoMeta: META });
    expect(text.applied).toBe(false);
    expect(text.reason).toBe('not_creator');
  });
});

describe('Validation-9 — backward compatibility (image flow untouched)', () => {
  it('image finalizeRowSharedMedia still works unchanged', () => {
    const img = finalizeRowSharedMedia({
      intentType: 'creator', platform: 'linkedin', assetType: 'image',
      attachment: { asset_id: 'a', asset_url: 'https://cdn/x.png', override_policy: 'inherit_all', compatibility_policy: 'registry' },
    });
    expect(img.content_patch).toEqual({ uploaded_media_url: 'https://cdn/x.png' });
  });
});

// ── LIVE — immutable external-video lineage + no-dup ─────────────────────
const DB_URL = process.env.SUPABASE_DB_URL;
const liveDescribe = DB_URL ? describe : describe.skip;
liveDescribe('Validation-8 LIVE — external video lineage immutable + unique', () => {
  it('immutable + duplicate (core,asset) rejected (tx rolled back)', async () => {
    const { Client } = require('pg');
    const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect(); await c.query('BEGIN');
    const ok: string[] = []; const fail: string[] = [];
    const sp = async (n: string, fn: () => Promise<any>, expectErr?: string) => {
      await c.query('SAVEPOINT s');
      try { await fn(); await c.query('RELEASE SAVEPOINT s'); (expectErr ? fail : ok).push(n); }
      catch (e: any) { await c.query('ROLLBACK TO SAVEPOINT s'); (expectErr && new RegExp(expectErr).test(e.message) ? ok : fail).push(n); }
    };
    try {
      const id = (await c.query(
        `insert into content_external_video_asset(content_core_id,asset_id,external_video_url,provider_type) values('core-ev','ev-1','https://cdn/v.mp4','upload') returning id`,
      )).rows[0].id;
      ok.push('insert');
      await sp('UPDATE blocked', () => c.query(`update content_external_video_asset set external_video_url='https://evil' where id='${id}'`), 'LEDGER_IMMUTABLE');
      await sp('DELETE blocked', () => c.query(`delete from content_external_video_asset where id='${id}'`), 'LEDGER_IMMUTABLE');
      await sp('dup (core,asset) rejected', () => c.query(
        `insert into content_external_video_asset(content_core_id,asset_id,external_video_url,provider_type) values('core-ev','ev-1','https://cdn/v2.mp4','vimeo')`), 'duplicate key');
    } finally { await c.query('ROLLBACK'); await c.end(); }
    expect(fail).toEqual([]);
    expect(ok).toEqual(expect.arrayContaining(['insert', 'UPDATE blocked', 'DELETE blocked', 'dup (core,asset) rejected']));
  }, 30000);
});

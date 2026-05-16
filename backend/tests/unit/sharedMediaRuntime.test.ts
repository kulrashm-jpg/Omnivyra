/**
 * Validation — Step-15 finalized shared-media runtime wiring.
 *
 *   1  inherited media auto-attaches
 *   2  no duplicate render jobs (reuse identical inherited url)
 *   3  no duplicate media lineage (helper is pure; only media patch)
 *   4  override correctness (replace / disable)
 *   5  revert correctness (back to inherited)
 *   6  compatibility enforcement (fail-closed)
 *   7  BOLT Text caption isolation (Text rows = no-op; media-only patch)
 *   8  scheduler-boundary integrity (flat shape; only uploaded_media_url)
 *   9  backward compatibility (flag OFF default; no-attachment no-op)
 *   10 end-to-end multi-platform publishing
 *
 * Pure module — no supabase mock needed. LIVE check confirms the
 * additive asset_url columns + immutable lineage (tx + rollback).
 */

import {
  finalizeRowSharedMedia,
  isSharedMediaPublishingEnabled,
} from '../../services/creator/media';

const FLAG = 'ENABLE_CREATOR_WORKSPACE_LIFECYCLE';
const ATT = {
  asset_id: 'asset-1',
  asset_url: 'https://cdn/shared-1.png',
  override_policy: 'inherit_all' as const,
  compatibility_policy: 'registry' as const,
};

describe('Validation-9 — flag + backward compatibility', () => {
  const O = process.env[FLAG];
  afterEach(() => { if (O === undefined) delete process.env[FLAG]; else process.env[FLAG] = O; });

  it('flag OFF by default; no attachment ⇒ no-op (no behavior change)', () => {
    delete process.env[FLAG];
    expect(isSharedMediaPublishingEnabled()).toBe(false);
    const r = finalizeRowSharedMedia({
      intentType: 'creator', platform: 'linkedin', assetType: 'image',
      attachment: null,
    });
    expect(r.applied).toBe(false);
    expect(r.content_patch).toBeNull();
    expect(r.reason).toBe('no_attachment');
  });
});

describe('Validation-1/8 — inherited media auto-attaches (scheduler-safe)', () => {
  it('inherit_all ⇒ uploaded_media_url = shared url; flat shape only', () => {
    const r = finalizeRowSharedMedia({
      intentType: 'creator', platform: 'linkedin', assetType: 'image', attachment: ATT,
    });
    expect(r.applied).toBe(true);
    expect(r.content_patch).toEqual({ uploaded_media_url: 'https://cdn/shared-1.png' });
    expect(Object.keys(r.content_patch!)).toEqual(['uploaded_media_url']); // media-only
    expect(Object.keys(r.finalized!).sort()).toEqual(['media_source', 'media_url', 'platform']);
    expect(r.events).toContain('finalized_media_attached');
  });
});

describe('Validation-2/3 — render/upload reuse (no duplicates)', () => {
  it('identical inherited url already on the row ⇒ reused, NO patch', () => {
    const r = finalizeRowSharedMedia({
      intentType: 'creator', platform: 'linkedin', assetType: 'image', attachment: ATT,
      existingUploadedUrl: 'https://cdn/shared-1.png',
    });
    expect(r.reused).toBe(true);
    expect(r.applied).toBe(false);
    expect(r.content_patch).toBeNull();              // no duplicate upload/lineage
    expect(r.events).toContain('duplicate_render_prevented');
  });
});

describe('Validation-4/5 — override + revert', () => {
  it('replace override ⇒ override url; disable ⇒ null; revert ⇒ inherited', () => {
    const replaced = finalizeRowSharedMedia({
      intentType: 'creator', platform: 'instagram', assetType: 'image', attachment: ATT,
      overrides: { instagram: { kind: 'replaced', asset_id: 'ig-1', asset_url: 'https://cdn/ig.png' } },
    });
    expect(replaced.content_patch).toEqual({ uploaded_media_url: 'https://cdn/ig.png' });
    expect(replaced.finalized!.media_source).toBe('overridden_replaced');
    expect(replaced.events).toContain('override_applied');

    const disabled = finalizeRowSharedMedia({
      intentType: 'creator', platform: 'instagram', assetType: 'image', attachment: ATT,
      overrides: { instagram: { kind: 'disabled' } },
    });
    expect(disabled.content_patch).toEqual({ uploaded_media_url: null }); // media removed
    expect(disabled.events).toContain('no_media');

    const reverted = finalizeRowSharedMedia({
      intentType: 'creator', platform: 'instagram', assetType: 'image', attachment: ATT,
      overrides: {}, // override removed = revert
    });
    expect(reverted.content_patch).toEqual({ uploaded_media_url: 'https://cdn/shared-1.png' });
  });
});

describe('Validation-6 — compatibility enforcement (fail-closed)', () => {
  it('incompatible asset/platform ⇒ skipped, NO media attached', () => {
    const r = finalizeRowSharedMedia({
      intentType: 'creator', platform: 'linkedin', assetType: 'reel', attachment: ATT,
    });
    expect(r.applied).toBe(false);
    expect(r.content_patch).toBeNull();
    expect(r.finalized).toEqual({ platform: 'linkedin', media_url: null, media_source: 'incompatible' });
    expect(r.events).toContain('incompatible_skipped');
  });
});

describe('Validation-7 — BOLT Text caption isolation', () => {
  it('Text rows are a no-op; patch (when any) is media-only', () => {
    const text = finalizeRowSharedMedia({
      intentType: 'text', platform: 'linkedin', assetType: 'image', attachment: ATT,
    });
    expect(text.applied).toBe(false);
    expect(text.reason).toBe('not_creator');
    expect(text.content_patch).toBeNull();
    // for creator rows the only writable key is uploaded_media_url
    const creator = finalizeRowSharedMedia({
      intentType: 'creator', platform: 'linkedin', assetType: 'image', attachment: ATT,
    });
    expect(Object.keys(creator.content_patch ?? {})).toEqual(['uploaded_media_url']);
    for (const k of ['caption', 'hashtags', 'cta', 'meta_description', 'packaging']) {
      expect(k in (creator.content_patch ?? {})).toBe(false);
    }
  });
});

describe('Validation-10 — end-to-end multi-platform', () => {
  it('one asset → all compatible platforms; per-platform override honored', () => {
    const platforms = ['linkedin', 'facebook', 'x', 'instagram'];
    const overrides = {
      facebook: { kind: 'disabled' as const },
      x: { kind: 'replaced' as const, asset_id: 'x-1', asset_url: 'https://cdn/x.png' },
    };
    const out = platforms.map((p) => finalizeRowSharedMedia({
      intentType: 'creator', platform: p, assetType: 'image', attachment: ATT, overrides,
    }));
    const byP = Object.fromEntries(out.map((r) => [r.finalized!.platform, r]));
    expect(byP.linkedin.content_patch).toEqual({ uploaded_media_url: 'https://cdn/shared-1.png' });
    expect(byP.instagram.content_patch).toEqual({ uploaded_media_url: 'https://cdn/shared-1.png' });
    expect(byP.facebook.content_patch).toEqual({ uploaded_media_url: null });   // disabled
    expect(byP.x.content_patch).toEqual({ uploaded_media_url: 'https://cdn/x.png' }); // replaced
    // ONE shared asset reused across inherited platforms (no dup lineage)
    const inheritedUrls = [byP.linkedin, byP.instagram].map((r) => r.content_patch!.uploaded_media_url);
    expect(new Set(inheritedUrls).size).toBe(1);
  });
});

// ── LIVE — additive columns + immutable lineage preserved ────────────────
const DB_URL = process.env.SUPABASE_DB_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

liveDescribe('LIVE — asset_url columns additive + lineage still immutable', () => {
  it('asset_url stored at insert; UPDATE still blocked', async () => {
    const { Client } = require('pg');
    const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect(); await c.query('BEGIN');
    let updateBlocked = false;
    try {
      const id = (await c.query(
        `insert into content_core_asset(content_core_id,asset_id,asset_type,canonical_asset_family,content_spec_hash,asset_url) values('core-s15','a-s15','image','image','H','https://cdn/x.png') returning id`,
      )).rows[0].id;
      try { await c.query(`update content_core_asset set asset_url='https://evil' where id='${id}'`); }
      catch (e: any) { updateBlocked = /LEDGER_IMMUTABLE/.test(e.message); }
    } finally { await c.query('ROLLBACK'); await c.end(); }
    expect(updateBlocked).toBe(true);
  }, 30000);
});

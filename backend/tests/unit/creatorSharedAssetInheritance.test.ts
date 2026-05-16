/**
 * Validation — Shared Creator Media Asset Inheritance (media-only).
 *
 *   1  one media asset reused across platforms
 *   2  no duplicate render jobs (reuse key identity)
 *   3  no duplicate media lineage rows (LIVE unique constraint)
 *   4  platform-specific TEXT preserved (no text fields in this layer)
 *   5  override correctness (disable / replace)
 *   6  revert correctness (lossless)
 *   7  compatibility correctness
 *   8  scheduler isolation (flat finalized media only)
 *   9  Text/Creator separation (text-like never media-inherits)
 *   10 backward compatibility (LIVE immutable lineage, additive)
 *
 * Pure modules — no supabase mock needed. Live-DB checks are tx+rollback
 * (content_core_asset is immutable-on-delete; no test rows persist).
 */

import {
  isPlatformAssetCompatible,
  getCompatiblePlatforms,
  resolveSharedMediaInheritance,
  computeRenderReuseKey,
  shouldReuseRender,
  newRenderReasons,
  finalizeSchedulerMedia,
} from '../../services/creator/media';

const SIX = ['linkedin', 'facebook', 'x', 'threads', 'instagram', 'tiktok'];

describe('Validation-1 — one asset reused across compatible platforms', () => {
  it('inherit_all → every compatible platform uses the SAME shared asset', () => {
    const r = resolveSharedMediaInheritance({
      assetType: 'image', sharedAssetId: 'asset-1',
      targetPlatforms: SIX, overridePolicy: 'inherit_all',
    });
    const inherited = r.resolutions.filter((x) => x.source === 'inherited');
    expect(inherited.length).toBeGreaterThan(0);
    for (const x of inherited) expect(x.asset_id).toBe('asset-1');
    expect(r.is_default_selected).toBe(true);
    expect(new Set(inherited.map((x) => x.asset_id)).size).toBe(1); // ONE asset
  });
});

describe('Validation-2 — no duplicate render jobs (reuse identity)', () => {
  const core = { visual_prompt: 'a calm office', storyboard: [{ s: 1 }], pacing_guidance: 'slow', aspect_ratio: '1:1' };
  it('identical core ⇒ same reuse key ⇒ reuse (no new render)', () => {
    expect(computeRenderReuseKey(core)).toBe(computeRenderReuseKey({ ...core }));
    expect(shouldReuseRender(core, { ...core })).toBe(true);
    expect(newRenderReasons(core, { ...core })).toEqual([]);
  });
  it('differing storyboard / pacing / aspect / locale ⇒ NEW render', () => {
    expect(shouldReuseRender(core, { ...core, storyboard: [{ s: 2 }] })).toBe(false);
    expect(shouldReuseRender(core, { ...core, pacing_guidance: 'fast' })).toBe(false);
    expect(shouldReuseRender(core, { ...core, aspect_ratio: '9:16' })).toBe(false);
    expect(shouldReuseRender(core, { ...core, locale: 'fr' })).toBe(false);
    expect(newRenderReasons(core, { ...core, aspect_ratio: '9:16' })).toContain('aspect_incompatible');
  });
});

describe('Validation-4/9 — TEXT preserved + Text/Creator separation', () => {
  it('the media layer carries NO caption/hashtag/cta/metadata', () => {
    const r = resolveSharedMediaInheritance({
      assetType: 'image', sharedAssetId: 'a', targetPlatforms: ['linkedin', 'x'],
    });
    const keys = new Set<string>();
    for (const res of r.resolutions) Object.keys(res).forEach((k) => keys.add(k));
    for (const forbidden of ['caption', 'hashtags', 'cta', 'meta_description', 'keywords', 'packaging']) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect([...keys].sort()).toEqual(['asset_id', 'platform', 'reason', 'source'].filter((k) => keys.has(k)));
  });
  it('text-like asset NEVER media-inherits (all incompatible)', () => {
    const r = resolveSharedMediaInheritance({
      assetType: 'post_with_asset', sharedAssetId: 'a', targetPlatforms: ['linkedin', 'x'],
    });
    expect(r.resolutions.every((x) => x.source === 'incompatible')).toBe(true);
    expect(r.inherited_platforms).toEqual([]);
  });
});

describe('Validation-5/6 — override + revert correctness', () => {
  it('disable / replace overrides apply; absence ⇒ inherited (revert is lossless)', () => {
    const base = { assetType: 'image', sharedAssetId: 'shared-1', targetPlatforms: ['linkedin', 'instagram', 'facebook'] };
    const withOv = resolveSharedMediaInheritance({
      ...base,
      overrides: {
        instagram: { kind: 'disabled' },
        facebook: { kind: 'replaced', asset_id: 'fb-custom' },
      },
    });
    const byP = Object.fromEntries(withOv.resolutions.map((r) => [r.platform, r]));
    expect(byP.linkedin.source).toBe('inherited');
    expect(byP.linkedin.asset_id).toBe('shared-1');
    expect(byP.instagram.source).toBe('overridden_disabled');
    expect(byP.instagram.asset_id).toBeNull();
    expect(byP.facebook.source).toBe('overridden_replaced');
    expect(byP.facebook.asset_id).toBe('fb-custom');
    // revert = drop overrides → identical to the no-override resolution
    const reverted = resolveSharedMediaInheritance(base);
    expect(reverted.resolutions.every((r) => r.source === 'inherited' && r.asset_id === 'shared-1')).toBe(true);
  });
});

describe('Validation-7 — compatibility correctness', () => {
  it('registry-derived compatibility', () => {
    expect(isPlatformAssetCompatible('linkedin', 'image').compatible).toBe(true);
    expect(isPlatformAssetCompatible('x', 'image').compatible).toBe(true);
    expect(isPlatformAssetCompatible('linkedin', 'reel').compatible).toBe(false);
    expect(isPlatformAssetCompatible('instagram', 'reel').compatible).toBe(true);
    expect(isPlatformAssetCompatible('linkedin', 'post_with_asset').reason).toBe('text_like_asset');
    expect(isPlatformAssetCompatible('linkedin', 'hologram').reason).toBe('unknown_asset');
    expect(getCompatiblePlatforms('reel', SIX)).toEqual(['facebook', 'instagram']);
  });
});

describe('Validation-8 — scheduler isolation (flat media only)', () => {
  it('finalizeSchedulerMedia exposes ONLY {platform,media_url,media_source}', () => {
    const r = resolveSharedMediaInheritance({
      assetType: 'image', sharedAssetId: 'a1', targetPlatforms: ['linkedin', 'x'],
      overrides: { x: { kind: 'disabled' } },
    });
    const urls: Record<string, string> = { a1: 'https://cdn/a1.png' };
    const finalized = finalizeSchedulerMedia(r.resolutions, (id) => urls[id] ?? null);
    for (const f of finalized) {
      expect(Object.keys(f).sort()).toEqual(['media_source', 'media_url', 'platform']);
    }
    const li = finalized.find((f) => f.platform === 'linkedin')!;
    const x = finalized.find((f) => f.platform === 'x')!;
    expect(li.media_url).toBe('https://cdn/a1.png');
    expect(x.media_url).toBeNull(); // disabled → no media, scheduler just delivers
  });
});

// ── Validation-3/10 — LIVE immutable lineage + no-duplicate ──────────────
const DB_URL = process.env.SUPABASE_DB_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

liveDescribe('Validation-3/10 — LIVE lineage immutability + uniqueness', () => {
  it('content_core_asset is immutable + duplicate (core,asset) rejected', async () => {
    const { Client } = require('pg');
    const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    await c.query('BEGIN');
    const ok: string[] = []; const fail: string[] = [];
    const sp = async (n: string, fn: () => Promise<any>, expectErr?: string) => {
      await c.query('SAVEPOINT s');
      try { await fn(); await c.query('RELEASE SAVEPOINT s'); (expectErr ? fail : ok).push(n); }
      catch (e: any) { await c.query('ROLLBACK TO SAVEPOINT s'); (expectErr && new RegExp(expectErr).test(e.message) ? ok : fail).push(n); }
    };
    try {
      const core = 'core-t1', asset = 'asset-t1';
      const id = (await c.query(
        `insert into content_core_asset(content_core_id,asset_id,asset_type,canonical_asset_family,content_spec_hash) values($1,$2,'image','image','H1') returning id`,
        [core, asset],
      )).rows[0].id;
      ok.push('lineage insert');
      await sp('immutable UPDATE blocked', () => c.query(`update content_core_asset set asset_type='video' where id='${id}'`), 'LEDGER_IMMUTABLE');
      await sp('immutable DELETE blocked', () => c.query(`delete from content_core_asset where id='${id}'`), 'LEDGER_IMMUTABLE');
      await sp('duplicate (core,asset) rejected', () => c.query(
        `insert into content_core_asset(content_core_id,asset_id,asset_type,canonical_asset_family,content_spec_hash) values($1,$2,'image','image','H2')`,
        [core, asset],
      ), 'duplicate key');
      // attachment + override mutable (revert lossless via delete)
      const att = (await c.query(
        `insert into content_asset_attachment(content_core_id,asset_id) values($1,$2) returning id`, [core, asset],
      )).rows[0].id;
      await c.query(`insert into content_asset_platform_override(attachment_id,platform,override_kind) values('${att}','instagram','disabled')`);
      await c.query(`delete from content_asset_platform_override where attachment_id='${att}' and platform='instagram'`);
      ok.push('override revert (lossless delete) ok');
    } finally {
      await c.query('ROLLBACK'); await c.end();
    }
    expect(fail).toEqual([]);
    expect(ok).toEqual(expect.arrayContaining([
      'lineage insert', 'immutable UPDATE blocked', 'immutable DELETE blocked',
      'duplicate (core,asset) rejected', 'override revert (lossless delete) ok',
    ]));
  }, 30000);
});

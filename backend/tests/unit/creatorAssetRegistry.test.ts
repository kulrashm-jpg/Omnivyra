/**
 * Validation — Step-13 canonical Creator asset/governance reconciliation.
 *
 *   1  legacy alias normalization
 *   2  adapter resolution correctness
 *   3  scheduler eligibility correctness
 *   4  human-production correctness
 *   5  governance-path correctness
 *   6  platform compatibility correctness
 *   7  constraint-valid payloads (offline contract + LIVE SQL)
 *   8  Text/Creator isolation
 *   9  backward compatibility (registry internally reconciled)
 *   10 deterministic normalization
 *
 * Pure — no supabase needed (registry has zero runtime imports), but we
 * still assert the canonical payload contract against the LIVE deployed
 * is_valid_creator_daily_content_payload.
 */

import {
  normalizeCreatorAsset,
  getCreatorAsset,
  resolveCanonicalAdapterKey,
  isSchedulerImmediate,
  requiresMediaUploadBeforeSchedule,
  getSchedulerEligibility,
  isHumanProductionAsset,
  getGovernanceClassification,
  isTextLikeAsset,
  isPlatformSupported,
  normalizeAssetPlatformKey,
  getDbEnumAssetType,
  CREATOR_ASSET_REGISTRY,
  assertCanonicalAsset,
  assertPayloadShape,
  assertSchedulerImmediate,
  assertNotTextContaminated,
  assertAdapterStrategy,
  validateCanonicalReconciliation,
  CanonicalAssetError,
} from '../../services/creator/intelligence/canonical';

/** CanonicalAssetError carries the failure in `.code` (not the message),
 *  so assert on that rather than a message regex. */
function expectThrowsCode(fn: () => unknown, code: string) {
  let err: any;
  try { fn(); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(CanonicalAssetError);
  expect(err.code).toBe(code);
}

describe('Validation-1/10 — alias normalization (deterministic)', () => {
  it.each([
    ['reels', 'reel'], ['Reel', 'reel'], ['  REELS ', 'reel'],
    ['instagram_reels', 'reel'], ['instagram-reels', 'reel'],
    ['youtube_short', 'short'], ['youtube shorts', 'short'], ['tiktok', 'short'],
    ['slides', 'carousel'], ['slide', 'carousel'], ['pdf', 'carousel'], ['deck', 'carousel'],
    ['graphic', 'image'], ['photo', 'image'], ['banner', 'image'],
    ['infographic', 'infographic'], ['story', 'story'],
    ['post_with_asset', 'creator_post'], ['thread_with_asset', 'creator_post'],
    ['video', 'video'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeCreatorAsset(input)).toBe(expected);
    expect(normalizeCreatorAsset(input)).toBe(normalizeCreatorAsset(input)); // deterministic
  });

  it('unknown / empty → null (fail closed)', () => {
    expect(normalizeCreatorAsset('quantum_hologram')).toBeNull();
    expect(normalizeCreatorAsset('')).toBeNull();
    expect(normalizeCreatorAsset(null)).toBeNull();
    expect(() => assertCanonicalAsset('quantum_hologram')).toThrow(CanonicalAssetError);
  });
});

describe('Validation-2 — adapter resolution', () => {
  it('every canonical asset resolves an adapter strategy', () => {
    for (const k of Object.keys(CREATOR_ASSET_REGISTRY)) {
      expect(resolveCanonicalAdapterKey(k)).not.toBeNull();
      expect(() => assertAdapterStrategy(k)).not.toThrow();
    }
  });
  it('maps to the correct adapter family', () => {
    expect(resolveCanonicalAdapterKey('image')).toBe('image');
    expect(resolveCanonicalAdapterKey('infographic')).toBe('image');
    expect(resolveCanonicalAdapterKey('story')).toBe('image');
    expect(resolveCanonicalAdapterKey('carousel')).toBe('carousel');
    expect(resolveCanonicalAdapterKey('reel')).toBe('video');
    expect(resolveCanonicalAdapterKey('short')).toBe('video');
    expect(resolveCanonicalAdapterKey('video')).toBe('video');
    // creator_post has no first-class adapter → safe fallback to image
    expect(resolveCanonicalAdapterKey('post_with_asset')).toBe('image');
  });
});

describe('Validation-3 — scheduler eligibility', () => {
  it('image/carousel-family are immediate; video-family after upload; post never', () => {
    for (const k of ['image', 'carousel', 'infographic', 'story']) {
      expect(isSchedulerImmediate(k)).toBe(true);
      expect(getSchedulerEligibility(k)).toBe('immediate');
    }
    for (const k of ['reel', 'short', 'video']) {
      expect(isSchedulerImmediate(k)).toBe(false);
      expect(requiresMediaUploadBeforeSchedule(k)).toBe(true);
      expect(getSchedulerEligibility(k)).toBe('after_upload');
    }
    expect(getSchedulerEligibility('creator_post')).toBe('never');
    expectThrowsCode(() => assertSchedulerImmediate('reel'), 'SCHEDULER_NOT_IMMEDIATE');
    expect(() => assertSchedulerImmediate('image')).not.toThrow();
  });
});

describe('Validation-4 — human-production (OR semantics preserved)', () => {
  it('reel/short/video true; autonomous false', () => {
    for (const k of ['reel', 'short', 'video', 'reels', 'tiktok', 'youtube_short']) {
      expect(isHumanProductionAsset(k)).toBe(true);
    }
    for (const k of ['image', 'carousel', 'infographic', 'story', 'creator_post']) {
      expect(isHumanProductionAsset(k)).toBe(false);
    }
  });
  it('true if ANY candidate is human-production (legacy OR-semantics)', () => {
    expect(isHumanProductionAsset('image', 'video')).toBe(true);   // asset_type video
    expect(isHumanProductionAsset('carousel', 'carousel')).toBe(false);
    expect(isHumanProductionAsset(undefined, null, 'reel')).toBe(true);
  });
});

describe('Validation-5/8 — governance + Text/Creator isolation', () => {
  it('classifications are correct', () => {
    expect(getGovernanceClassification('image')).toBe('autonomous');
    expect(getGovernanceClassification('reel')).toBe('attachment_required');
    expect(getGovernanceClassification('post_with_asset')).toBe('text_like');
  });
  it('only creator_post is text_like; assertNotTextContaminated fails closed', () => {
    expect(isTextLikeAsset('creator_post')).toBe(true);
    expect(isTextLikeAsset('image')).toBe(false);
    expectThrowsCode(() => assertNotTextContaminated('post_with_asset'), 'TEXT_CONTAMINATION');
    expect(() => assertNotTextContaminated('carousel')).not.toThrow();
  });
});

describe('Validation-6 — platform compatibility', () => {
  it('asset×platform support is reconciled', () => {
    expect(isPlatformSupported('reel', 'instagram')).toBe(true);
    expect(isPlatformSupported('reel', 'linkedin')).toBe(false);
    expect(isPlatformSupported('short', 'tiktok')).toBe(true);
    expect(isPlatformSupported('carousel', 'x')).toBe(true);
    expect(isPlatformSupported('image', 'x')).toBe(true);
    expect(isPlatformSupported('video', 'youtube')).toBe(true);
  });
  it('platform key normalization (twitter→x, ig_reels→instagram)', () => {
    expect(normalizeAssetPlatformKey('Twitter')).toBe('x');
    expect(normalizeAssetPlatformKey('instagram_reels')).toBe('instagram');
    expect(isPlatformSupported('image', 'twitter')).toBe(true); // via x
  });
});

describe('Validation-7 — canonical payload contract (offline)', () => {
  it('assertPayloadShape enforces the deployed per-family contract', () => {
    expect(() => assertPayloadShape('image', { visual_descriptor: {} })).not.toThrow();
    expect(() => assertPayloadShape('carousel', { slides: [] })).not.toThrow();
    expect(() => assertPayloadShape('reel', { scenes: [] })).not.toThrow();
    expect(() => assertPayloadShape('post_with_asset', { caption_blueprint: {} })).not.toThrow();
    expectThrowsCode(() => assertPayloadShape('image', { slides: [] }), 'PAYLOAD_SHAPE_VIOLATION');
    expectThrowsCode(() => assertPayloadShape('carousel', { slides: {} }), 'PAYLOAD_SHAPE_VIOLATION');
    expectThrowsCode(() => assertPayloadShape('video', { scenes: {} }), 'PAYLOAD_SHAPE_VIOLATION');
  });
});

describe('Validation-9 — registry internally reconciled', () => {
  it('validateCanonicalReconciliation reports ZERO drift', () => {
    expect(validateCanonicalReconciliation()).toEqual([]);
  });
  it('db_enum stays within the deployed asset_type vocabulary', () => {
    const allowed = new Set(['image', 'carousel', 'video', 'post_with_asset']);
    for (const k of Object.keys(CREATOR_ASSET_REGISTRY)) {
      expect(allowed.has(getDbEnumAssetType(k) as string)).toBe(true);
    }
  });
});

// ── Validation-7 — LIVE deployed constraint agrees with canonical ────────
const DB_URL = process.env.SUPABASE_DB_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

liveDescribe('Validation-7 — canonical contract matches deployed SQL', () => {
  it('a minimal row per canonical asset passes is_valid_creator_daily_content_payload', async () => {
    const { Client } = require('pg');
    const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      for (const k of Object.keys(CREATOR_ASSET_REGISTRY)) {
        const def = getCreatorAsset(k)!;
        const c = def.payload_shape_contract;
        const row = {
          intent_type: 'creator',
          asset_type: def.db_enum_asset_type,
          packaging: { caption: 'c', hashtags: [], meta_description: 'm', keywords: [], cta: 'go' },
          asset_payload: { [c.required_key]: c.json_type === 'array' ? [] : {} },
          asset_instruction: {},
        };
        const r = await client.query(
          'SELECT public.is_valid_creator_daily_content_payload($1,$2,$3) AS ok',
          ['creator', def.db_enum_asset_type, JSON.stringify(row)],
        );
        expect({ asset: k, db: def.db_enum_asset_type, ok: r.rows[0].ok })
          .toEqual({ asset: k, db: def.db_enum_asset_type, ok: true });
      }
    } finally {
      await client.end();
    }
  }, 30000);
});

/**
 * Unit tests — Step-5 reel/video blueprint adapter (NO rendering).
 *
 *   1. Valid ReelBlueprint structure (every spec field present + typed).
 *   2. Deterministic output (identical ctx,opts → identical blueprint).
 *   3. Scenes generated correctly (SCENE MODEL fields, ordered arc).
 *   4. Platform adaptation variation (IG / TikTok / YT / LinkedIn / FB).
 *   5. Packaging completeness (verbatim, constraint-shaped).
 *   6. No DB access (supabase spy never called — purity proof).
 *   7. No runtime side effects (ctx not mutated).
 *   8. Registry resolution correctness (reel/video/short + aliases).
 *   9. LIVE deployed-constraint parity for the video asset_type.
 *
 * supabase mocked: the adapter graph transitively imports the engine /
 * weekly-structure-helpers (lazy supabase Proxy). A DB touch throws.
 */

const fromSpy = jest.fn(() => { throw new Error('DB access in pure reel adapter'); });
jest.mock('../../db/supabaseClient', () => ({
  __esModule: true,
  supabase: new Proxy({}, { get: () => fromSpy }),
}));

import { resolveCreatorContext } from '../../services/creator/intelligence/creatorIntelligenceEngine';
import { reelBlueprintAdapter } from '../../services/creator/intelligence/adapters/reelBlueprintAdapter';
import {
  createCreatorAdapterRegistry,
} from '../../services/creator/intelligence/adapters/creatorAdapterRegistry';
import type { CreatorContext } from '../../services/creator/intelligence/types';

const CTX: CreatorContext = resolveCreatorContext({
  topic: 'From Data to Decisions: Transform your marketing',
  objective: 'Build brand awareness for mid-market SaaS',
  contentType: 'reel',
  platforms: ['Instagram', 'TikTok', 'YouTube', 'LinkedIn', 'facebook'],
  campaignTheme: 'Smarter marketing through data',
  creativeObjective: 'Position the product as the data-to-decision bridge',
  coreMessage: 'Turn raw analytics into weekly decisions',
  tone: 'authoritative',
  cta: 'Follow for the full breakdown',
  distributionMode: 'unique',
});

const SCENE_KEYS = [
  'scene_index',
  'duration_guidance',
  'scene_objective',
  'visual_direction',
  'talking_point',
  'overlay_text',
  'transition_style',
  'pacing_note',
];

afterEach(() => fromSpy.mockClear());

describe('reelBlueprintAdapter — structure', () => {
  it('produces a fully-formed, correctly-typed ReelBlueprint', () => {
    const bp = reelBlueprintAdapter.build(CTX);
    expect(bp.asset_family).toBe('video');
    expect(bp.blueprint_version).toBe(1);
    expect(bp.render_ready).toBe(false);
    expect(typeof bp.blueprint_id).toBe('string');
    expect(typeof bp.hook).toBe('string');
    expect(typeof bp.opening_shot).toBe('string');
    expect(typeof bp.pacing_guidance).toBe('string');
    expect(typeof bp.thumbnail_concept).toBe('string');
    expect(typeof bp.emotional_arc).toBe('string');
    expect(Array.isArray(bp.scene_sequence)).toBe(true);
    expect(Array.isArray(bp.talking_points)).toBe(true);
    expect(Array.isArray(bp.overlays)).toBe(true);
    expect(Array.isArray(bp.transitions)).toBe(true);
    expect(Array.isArray(bp.creator_notes)).toBe(true);
    expect(bp.creator_notes.length).toBeGreaterThan(0);
    // asset_payload mirrors scene_sequence (DB-constraint surface).
    expect(bp.asset_payload.scenes).toEqual(bp.scene_sequence);
    expect(typeof bp.asset_instruction).toBe('object');
  });

  it('NO rendering/synthesis structure in the contract', () => {
    const bp = reelBlueprintAdapter.build(CTX);
    // Structural guarantee (not a free-text scan — derived marketing
    // copy may legitimately contain arbitrary words): the blueprint is
    // never render-ready, and a scene is a creative brief node, NOT a
    // render manifest — it must NOT carry any encoding/motion keys.
    expect(bp.render_ready).toBe(false);
    expect(Object.keys(bp.asset_payload)).toEqual(['scenes']);
    const RENDER_KEYS = ['codec', 'bitrate', 'fps', 'resolution', 'mp4', 'gpu', 'render', 'motion', 'keyframes'];
    for (const s of bp.scene_sequence) {
      for (const k of RENDER_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(s, k)).toBe(false);
      }
    }
  });
});

describe('reelBlueprintAdapter — scenes', () => {
  it('emits the ordered short-form arc with every SCENE MODEL field', () => {
    const bp = reelBlueprintAdapter.build(CTX);
    expect(bp.scene_sequence.length).toBe(5);
    bp.scene_sequence.forEach((s, i) => {
      expect(s.scene_index).toBe(i);
      for (const k of SCENE_KEYS) {
        expect(s).toHaveProperty(k);
        expect((s as any)[k]).toBeDefined();
      }
      expect(typeof s.duration_guidance).toBe('string');
      expect(typeof s.scene_objective).toBe('string');
    });
    // arc: hook first, CTA last
    expect(bp.scene_sequence[0]!.duration_guidance).toBe('0–3s');
    expect(bp.scene_sequence[0]!.talking_point).toBe(CTX.hook_strategy.verbal);
    expect(bp.scene_sequence[4]!.talking_point).toBe(CTX.packaging.cta);
  });
});

describe('reelBlueprintAdapter — determinism & purity', () => {
  it('is deterministic for identical (ctx, opts)', () => {
    const a = reelBlueprintAdapter.build(CTX, { platform: 'tiktok', weekIndex: 3 });
    const b = reelBlueprintAdapter.build(CTX, { platform: 'tiktok', weekIndex: 3 });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('never touches the database', () => {
    reelBlueprintAdapter.build(CTX);
    reelBlueprintAdapter.build(CTX, { platform: 'instagram' });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('does not mutate the input context', () => {
    const snapshot = JSON.stringify(CTX);
    reelBlueprintAdapter.build(CTX, { platform: 'youtube' });
    expect(JSON.stringify(CTX)).toEqual(snapshot);
  });
});

describe('reelBlueprintAdapter — platform adaptation', () => {
  it('produces differentiated guidance per platform', () => {
    const ig = reelBlueprintAdapter.build(CTX, { platform: 'instagram' });
    const tt = reelBlueprintAdapter.build(CTX, { platform: 'tiktok' });
    const yt = reelBlueprintAdapter.build(CTX, { platform: 'youtube' });
    const li = reelBlueprintAdapter.build(CTX, { platform: 'linkedin' });
    const fb = reelBlueprintAdapter.build(CTX, { platform: 'facebook' });

    // unique mode ⇒ exactly the one targeted platform's notes
    expect(Object.keys(ig.platform_adaptation_notes)).toEqual(['instagram']);
    expect(Object.keys(tt.platform_adaptation_notes)).toEqual(['tiktok']);

    const guides = [ig, tt, yt, li, fb].map((b) => b.pacing_guidance);
    expect(new Set(guides).size).toBe(5); // all distinct pacing

    expect(tt.platform_adaptation_notes.tiktok.toLowerCase()).toContain('trend');
    expect(yt.platform_adaptation_notes.youtube.toLowerCase()).toContain('retention');
    expect(li.platform_adaptation_notes.linkedin.toLowerCase()).toContain('authority');
    expect(ig.platform_adaptation_notes.instagram.toLowerCase()).toContain('visual-first');
    expect(fb.platform_adaptation_notes.facebook.toLowerCase()).toContain('community');
  });

  it('shared mode (no platform) carries the full creative core', () => {
    const shared = reelBlueprintAdapter.build(CTX);
    // every ctx.platform_strategy key surfaces an adaptation note
    expect(Object.keys(shared.platform_adaptation_notes).sort())
      .toEqual(Object.keys(CTX.platform_strategy).sort());
    expect(shared.creator_notes.some((n) => n.includes('Shared creative core'))).toBe(true);
  });
});

describe('reelBlueprintAdapter — packaging', () => {
  it('copies packaging verbatim and constraint-shaped', () => {
    const bp = reelBlueprintAdapter.build(CTX);
    expect(bp.packaging).toEqual(CTX.packaging);
    expect(Array.isArray(bp.packaging.hashtags)).toBe(true);
    expect(Array.isArray(bp.packaging.keywords)).toBe(true);
    expect(bp.packaging.caption.length).toBeGreaterThan(0);
    expect(bp.packaging.cta).toBe(CTX.packaging.cta);
  });
});

describe('creatorAdapterRegistry — reel resolution', () => {
  it('resolves reel/video/short + governance aliases to the reel adapter', () => {
    const reg = createCreatorAdapterRegistry();
    expect(reg.get('video')).toBe(reelBlueprintAdapter);
    expect(reg.get('reel')).toBe(reelBlueprintAdapter);
    expect(reg.get('reels')).toBe(reelBlueprintAdapter);     // alias → reel
    expect(reg.get('short')).toBe(reelBlueprintAdapter);
    expect(reg.get('shorts')).toBe(reelBlueprintAdapter);     // alias → short
    expect(reg.get('youtube_short')).toBe(reelBlueprintAdapter);
    expect(reg.get('tiktok')).toBe(reelBlueprintAdapter);     // alias → short
    expect(reg.list()).toHaveLength(3);
  });

  it('does not shadow image/carousel resolution', () => {
    const reg = createCreatorAdapterRegistry();
    expect(reg.get('image')!.assetFamily).toBe('image');
    expect(reg.get('carousel')!.assetFamily).toBe('carousel');
    expect(reg.get('video')!.assetFamily).toBe('video');
  });
});

// ── LIVE deployed-constraint parity (video asset_type) ───────────────────
const DB_URL = process.env.SUPABASE_DB_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

liveDescribe('LIVE is_valid_creator_daily_content_payload — video', () => {
  it('accepts the reel row the adapter produces', async () => {
    const { Client } = require('pg');
    const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      const bp = reelBlueprintAdapter.build(CTX, { platform: 'instagram' });
      const row = JSON.stringify({
        intent_type: 'creator',
        asset_type: 'video',
        packaging: bp.packaging,
        asset_payload: bp.asset_payload,
        asset_instruction: bp.asset_instruction,
      });
      const r = await client.query(
        'SELECT public.is_valid_creator_daily_content_payload($1,$2,$3) AS ok',
        ['creator', 'video', row],
      );
      expect(r.rows[0].ok).toBe(true);
    } finally {
      await client.end();
    }
  }, 25000);
});

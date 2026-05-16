/**
 * Unit tests — Step-3 blueprint adapters (image + carousel) + registry.
 *
 * Validates the adapter contract:
 *   1. Correct blueprint typing (asset_family, version, render_ready,
 *      structural keys) for ImageBlueprint / CarouselBlueprint.
 *   2. Constraint-valid packaging — copied VERBATIM from CreatorContext,
 *      carrying the 5 required keys with hashtags/keywords as arrays.
 *   3. Valid asset_payload shape per family (image → visual_descriptor
 *      object; carousel → slides array).
 *   4. Deterministic output — identical (ctx, opts) → identical blueprint.
 *   5. Purity — no DB access (supabase mock asserted never called),
 *      ctx not mutated.
 *   6. Registry resolves formats (incl. aliases) to the right adapter.
 *   7. REAL deployed-constraint parity — the produced row payload is fed
 *      to the LIVE `is_valid_creator_daily_content_payload(...)` SQL
 *      function (not migration source). Runs only when SUPABASE_DB_URL
 *      is configured; otherwise skipped with a visible note.
 *
 * The supabase mock is the purity PROOF: the carousel adapter
 * transitively imports `weekly-structure-helpers` (which top-level
 * imports the lazy supabase Proxy). If the adapter graph touched the DB
 * this spy would throw / register a call.
 */

const fromSpy = jest.fn(() => { throw new Error('DB access in pure adapter'); });
jest.mock('../../db/supabaseClient', () => ({
  __esModule: true,
  supabase: new Proxy({}, { get: () => fromSpy }),
}));

import { resolveCreatorContext } from '../../services/creator/intelligence/creatorIntelligenceEngine';
import { imageBlueprintAdapter } from '../../services/creator/intelligence/adapters/imageBlueprintAdapter';
import { carouselBlueprintAdapter } from '../../services/creator/intelligence/adapters/carouselBlueprintAdapter';
import {
  createCreatorAdapterRegistry,
  CreatorAdapterRegistryImpl,
} from '../../services/creator/intelligence/adapters/creatorAdapterRegistry';
import type { CreatorContext } from '../../services/creator/intelligence/types';

const CTX: CreatorContext = resolveCreatorContext({
  topic: 'From Data to Decisions: Transform your marketing',
  objective: 'Build brand awareness for mid-market SaaS',
  contentType: 'carousel',
  platforms: ['LinkedIn', 'Instagram', 'facebook'],
  campaignTheme: 'Smarter marketing through data',
  creativeObjective: 'Position the product as the data-to-decision bridge',
  audienceIntent: 'evaluating, skeptical',
  coreMessage: 'Turn raw analytics into weekly decisions',
  tone: 'authoritative',
  cta: 'Book a walkthrough',
  distributionMode: 'unique',
  brandGrounding: { company_name: 'Omnivyra', industry: 'marketing operations' },
});

/** Faithful structural port of the DEPLOYED predicate
 *  is_valid_creator_daily_content_payload — used for an offline,
 *  deterministic assertion in addition to the live SQL check. */
function deployedConstraintHolds(row: any, assetType: string): boolean {
  if (!row || typeof row !== 'object') return false;
  if (!('intent_type' in row && 'asset_type' in row && 'asset_payload' in row && 'packaging' in row)) return false;
  if (row.intent_type !== 'creator') return false;
  if (assetType && row.asset_type !== assetType) return false;
  const isObj = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(row.packaging)) return false;
  if (!isObj(row.asset_instruction)) return false;
  if (!isObj(row.asset_payload)) return false;
  const p = row.packaging;
  for (const k of ['caption', 'hashtags', 'meta_description', 'keywords', 'cta']) {
    if (!(k in p)) return false;
  }
  if (!Array.isArray(p.hashtags)) return false;
  if (!Array.isArray(p.keywords)) return false;
  if (assetType === 'carousel') {
    if (!Array.isArray(row.asset_payload.slides)) return false;
  } else if (assetType === 'image') {
    if (!isObj(row.asset_payload.visual_descriptor)) return false;
  }
  return true;
}

/** Persisted-row projection of a blueprint (mirrors how the pipeline
 *  stores creator daily_content_plans.content). */
function toRow(bp: any, assetType: string) {
  return {
    intent_type: 'creator',
    asset_type: assetType,
    packaging: bp.packaging,
    asset_payload: bp.asset_payload,
    asset_instruction: bp.asset_instruction,
  };
}

afterEach(() => fromSpy.mockClear());

describe('imageBlueprintAdapter', () => {
  it('produces a correctly-typed ImageBlueprint', () => {
    const bp = imageBlueprintAdapter.build(CTX);
    expect(bp.asset_family).toBe('image');
    expect(bp.blueprint_version).toBe(1);
    expect(bp.render_ready).toBe(false);
    expect(typeof bp.blueprint_id).toBe('string');
    expect(bp.blueprint_id.length).toBeGreaterThan(0);
    expect(typeof bp.overlay_copy).toBe('string');
    expect(typeof bp.composition_notes).toBe('string');
  });

  it('copies packaging verbatim (constraint-shaped, arrays intact)', () => {
    const bp = imageBlueprintAdapter.build(CTX);
    expect(bp.packaging).toEqual(CTX.packaging);
    expect(Array.isArray(bp.packaging.hashtags)).toBe(true);
    expect(Array.isArray(bp.packaging.keywords)).toBe(true);
    expect(bp.packaging.caption).toBe(CTX.packaging.caption);
    expect(bp.packaging.cta).toBe(CTX.packaging.cta);
  });

  it('emits a valid image asset_payload (visual_descriptor object)', () => {
    const bp = imageBlueprintAdapter.build(CTX);
    expect(bp.asset_payload.visual_descriptor).toBeDefined();
    expect(typeof bp.asset_payload.visual_descriptor).toBe('object');
    expect(Array.isArray(bp.asset_payload.visual_descriptor)).toBe(false);
    expect(typeof bp.asset_instruction).toBe('object');
  });

  it('is deterministic', () => {
    const a = imageBlueprintAdapter.build(CTX, { platform: 'instagram', weekIndex: 2 });
    const b = imageBlueprintAdapter.build(CTX, { platform: 'instagram', weekIndex: 2 });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('unique-mode restricts platform_adaptation_notes to that platform', () => {
    const bp = imageBlueprintAdapter.build(CTX, { platform: 'instagram' });
    expect(Object.keys(bp.platform_adaptation_notes)).toEqual(['instagram']);
  });

  it('passes the offline + live deployed constraint port', () => {
    const bp = imageBlueprintAdapter.build(CTX);
    expect(deployedConstraintHolds(toRow(bp, 'image'), 'image')).toBe(true);
  });
});

describe('carouselBlueprintAdapter', () => {
  it('produces a correctly-typed CarouselBlueprint', () => {
    const bp = carouselBlueprintAdapter.build(CTX);
    expect(bp.asset_family).toBe('carousel');
    expect(bp.blueprint_version).toBe(1);
    expect(bp.render_ready).toBe(false);
    expect(Array.isArray(bp.slide_objectives)).toBe(true);
    expect(typeof bp.sequencing_strategy).toBe('string');
  });

  it('emits a valid carousel asset_payload (slides array, roles sane)', () => {
    const bp = carouselBlueprintAdapter.build(CTX);
    expect(Array.isArray(bp.asset_payload.slides)).toBe(true);
    expect(bp.asset_payload.slides.length).toBeGreaterThanOrEqual(3);
    expect(bp.asset_payload.slides[0]!.role).toBe('hook');
    expect(bp.asset_payload.slides[bp.asset_payload.slides.length - 1]!.role).toBe('cta');
    bp.asset_payload.slides.forEach((s, i) => expect(s.index).toBe(i));
  });

  it('copies packaging verbatim', () => {
    const bp = carouselBlueprintAdapter.build(CTX);
    expect(bp.packaging).toEqual(CTX.packaging);
  });

  it('is deterministic', () => {
    const a = carouselBlueprintAdapter.build(CTX, { variationSeed: 7 });
    const b = carouselBlueprintAdapter.build(CTX, { variationSeed: 7 });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('passes the offline deployed constraint port', () => {
    const bp = carouselBlueprintAdapter.build(CTX);
    expect(deployedConstraintHolds(toRow(bp, 'carousel'), 'carousel')).toBe(true);
  });
});

describe('purity', () => {
  it('never touches the database', () => {
    imageBlueprintAdapter.build(CTX);
    carouselBlueprintAdapter.build(CTX);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('does not mutate the input context', () => {
    const snapshot = JSON.stringify(CTX);
    imageBlueprintAdapter.build(CTX, { platform: 'facebook' });
    carouselBlueprintAdapter.build(CTX, { platform: 'facebook' });
    expect(JSON.stringify(CTX)).toEqual(snapshot);
  });
});

describe('creatorAdapterRegistry', () => {
  it('resolves formats and aliases to the correct adapter', () => {
    const reg = createCreatorAdapterRegistry();
    expect(reg.get('image')).toBe(imageBlueprintAdapter);
    expect(reg.get('carousel')).toBe(carouselBlueprintAdapter);
    // governance aliases: graphic/photo → image, slides/slide → carousel
    expect(reg.get('graphic')).toBe(imageBlueprintAdapter);
    expect(reg.get('Photo')).toBe(imageBlueprintAdapter);
    expect(reg.get('slides')).toBe(carouselBlueprintAdapter);
    expect(reg.get(' SLIDE ')).toBe(carouselBlueprintAdapter);
  });

  it('returns undefined for unsupported formats (no implicit default)', () => {
    const reg = createCreatorAdapterRegistry();
    // 'reel' is now claimed by the Step-5 reel adapter; podcast/audio
    // and empty remain unsupported.
    expect(reg.get('podcast')).toBeUndefined();
    expect(reg.get('audio')).toBeUndefined();
    expect(reg.get('')).toBeUndefined();
  });

  it('lists exactly the registered adapters (image, carousel, reel)', () => {
    const reg = createCreatorAdapterRegistry();
    expect(reg.list()).toHaveLength(3);
    expect(reg.list().map((a) => a.assetFamily).sort()).toEqual(['carousel', 'image', 'video']);
  });

  it('is a CreatorAdapterRegistry instance with contract methods', () => {
    const reg = createCreatorAdapterRegistry();
    expect(reg).toBeInstanceOf(CreatorAdapterRegistryImpl);
    expect(typeof reg.get).toBe('function');
    expect(typeof reg.register).toBe('function');
    expect(typeof reg.list).toBe('function');
  });
});

// ── Live deployed-constraint parity (real SQL function) ──────────────────
const DB_URL = process.env.SUPABASE_DB_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

liveDescribe('LIVE is_valid_creator_daily_content_payload parity', () => {
  it('accepts the image + carousel rows the adapters produce', async () => {
    // Lazy require so a missing pg / no DB never breaks the offline suite.
    const { Client } = require('pg');
    const client = new Client({
      connectionString: DB_URL,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    try {
      const imgRow = toRow(imageBlueprintAdapter.build(CTX), 'image');
      const carRow = toRow(carouselBlueprintAdapter.build(CTX), 'carousel');

      const img = await client.query(
        'SELECT public.is_valid_creator_daily_content_payload($1,$2,$3) AS ok',
        ['creator', 'image', JSON.stringify(imgRow)],
      );
      const car = await client.query(
        'SELECT public.is_valid_creator_daily_content_payload($1,$2,$3) AS ok',
        ['creator', 'carousel', JSON.stringify(carRow)],
      );

      expect(img.rows[0].ok).toBe(true);
      expect(car.rows[0].ok).toBe(true);
    } finally {
      await client.end();
    }
  }, 25000);
});

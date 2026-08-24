/**
 * Phase 2B — Content Creator upload → canonical asset → composition reference.
 *
 * WHAT THIS SUITE IS FOR
 * ----------------------
 * The point of the asset/reference split is reuse: one uploaded file, many
 * roles, no duplication. These tests exercise that as behaviour — change a
 * usage and assert the SAME asset id survives; detach and assert the file is
 * still there — rather than asserting that functions were called.
 *
 * The stub below enforces the two integrity rules the DATABASE enforces (the
 * composite foreign key and the uniqueness key) so "cross-tenant rejected" and
 * "duplicate rejected" are real outcomes, not decoration. It mirrors the
 * harness the Phase 2A suite already uses.
 *
 * Phase 2B is persistence ONLY. A test at the end pins that no generation or
 * provider module was touched, because "the upload silently started changing
 * generated images" is the regression this phase must not cause.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import * as fs from 'fs';
import * as path from 'path';

type Row = Record<string, unknown>;

const assets: Row[] = [];
const refs: Row[] = [];
const mediaFiles: Row[] = [];
let seq = 0;

function applyFilters(rows: Row[], f: Record<string, unknown>): Row[] {
  return rows.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v));
}

function tableRows(table: string): Row[] {
  if (table === 'canonical_media_assets') return assets;
  if (table === 'media_files') return mediaFiles;
  return refs;
}

function builderFor(table: string, mode: string, payload?: Row) {
  const rows = tableRows(table);
  const filters: Record<string, unknown> = {};

  const b: Record<string, unknown> = {
    select: () => b,
    order: () => b,
    limit: () => b,
    eq(col: string, val: unknown) { filters[col] = val; return b; },
    then(resolve: (r: { data: Row[]; error: null }) => unknown) {
      return Promise.resolve(resolve({ data: applyFilters(rows, filters), error: null }));
    },
    maybeSingle() {
      if (mode === 'update') {
        const target = applyFilters(rows, filters)[0];
        if (target) Object.assign(target, payload);
        return Promise.resolve({ data: target ?? null, error: null });
      }
      return Promise.resolve({ data: applyFilters(rows, filters)[0] ?? null, error: null });
    },
    single() {
      if (mode === 'insert') {
        const row: Row = { ...payload, id: `id-${++seq}`, created_at: `T${seq}`, updated_at: `T${seq}` };
        if (table === 'canonical_media_assets') {
          // UNIQUE (storage_bucket, storage_path)
          if (assets.find((a) => a.storage_bucket === row.storage_bucket && a.storage_path === row.storage_path)) {
            return Promise.resolve({ data: null, error: { message: 'duplicate key value violates unique constraint' } });
          }
          row.lifecycle_state = row.lifecycle_state ?? 'pending';
        }
        if (table === 'composition_asset_references') {
          // Composite FK: (company_id, asset_id) -> (company_id, id)
          if (!assets.find((a) => a.id === row.asset_id && a.company_id === row.company_id)) {
            return Promise.resolve({ data: null, error: { message: 'insert or update violates foreign key constraint' } });
          }
          // UNIQUE (composition_type, composition_id, asset_id, purpose)
          if (refs.find((r) => r.composition_type === row.composition_type
            && r.composition_id === row.composition_id
            && r.asset_id === row.asset_id
            && r.purpose === row.purpose)) {
            return Promise.resolve({ data: null, error: { message: 'duplicate key value violates unique constraint' } });
          }
        }
        rows.push(row);
        return Promise.resolve({ data: row, error: null });
      }
      if (mode === 'update') {
        const target = applyFilters(rows, filters)[0];
        if (target) Object.assign(target, payload);
        return Promise.resolve({ data: target ?? null, error: null });
      }
      return Promise.resolve({ data: applyFilters(rows, filters)[0] ?? null, error: null });
    },
    delete() {
      const doomed = applyFilters(rows, filters);
      for (const d of doomed) rows.splice(rows.indexOf(d), 1);
      return { eq: b.eq, then: (r: (x: { error: null }) => unknown) => Promise.resolve(r({ error: null })) };
    },
  };
  return b;
}

const fakeDb = (table: string) => ({
  select: () => builderFor(table, 'select'),
  insert: (p: Row) => builderFor(table, 'insert', p),
  update: (p: Row) => builderFor(table, 'update', p),
  delete: () => {
    const filters: Record<string, unknown> = {};
    const d: Record<string, unknown> = {
      eq(col: string, val: unknown) { filters[col] = val; return d; },
      then(resolve: (r: { error: null }) => unknown) {
        const rows = tableRows(table);
        for (const row of applyFilters(rows, filters)) rows.splice(rows.indexOf(row), 1);
        return Promise.resolve(resolve({ error: null }));
      },
    };
    return d;
  },
});

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => fakeDb(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => fakeDb(t), rpc: jest.fn() } }));

import {
  registerUploadedMediaAsset,
  attachCreatorCompositionAsset,
  listCreatorCompositionAssets,
  listCreatorCompositionAssetsResolved,
  detachCreatorCompositionAsset,
  changeCreatorCompositionAssetUsage,
  listCreatorAssetUsages,
  storageKeyFromMediaPath,
} from '../../services/creator/creatorCompositionAssetService';
import {
  CREATOR_ASSET_USAGE_OPTIONS,
  CREATOR_ASSET_USAGE_PURPOSES,

  CREATOR_COMPOSITION_TYPE,
  isCreatorAssetUsagePurpose,
  creatorAssetUsageLabel,
  creatorCompositionKey,
  mintCreatorCompositionId,
} from '../../../lib/content/creatorCompositionAsset';
import { defaultModeForPurpose } from '../../../lib/content/compositionAssetRouting';
import { COMPOSITION_ASSET_PURPOSES } from '../../../lib/content/compositionAssetReference';

const CO_A = 'company-a';
const CO_B = 'company-b';
const USER_A = 'user-a';
const USER_B = 'user-b';
const COMP = 'creator_image_1700000000_abc';

/** Seed a stored upload exactly as mediaService writes it. */
function seedUpload(userId: string, name = 'person.png'): string {
  const id = `mf-${++seq}`;
  mediaFiles.push({
    id,
    user_id: userId,
    storage_bucket: 'media-images',
    file_path: `media-images/${userId}/${Date.now()}-${name}`,
    mime_type: 'image/png',
    file_size: 2048,
    width: 1200,
    height: 800,
    file_name: name,
    file_url: `https://cdn.example/${name}`,
  });
  return id;
}

beforeEach(() => { assets.length = 0; refs.length = 0; mediaFiles.length = 0; seq = 0; });

/* ── A. Upload → canonical asset ─────────────────────────────────────────── */

describe('A — an upload becomes a canonical media asset', () => {
  it('registers with origin=upload, the caller company, and ready lifecycle', async () => {
    const mf = seedUpload(USER_A);
    const asset = await registerUploadedMediaAsset({ companyId: CO_A, userId: USER_A, mediaFileId: mf });

    expect(asset.origin).toBe('upload');
    expect(asset.companyId).toBe(CO_A);
    expect(asset.createdBy).toBe(USER_A);
    expect(asset.lifecycleState).toBe('ready');
    expect(asset.mimeType).toBe('image/png');
    expect(asset.width).toBe(1200);
    expect(asset.height).toBe(800);
    expect(asset.byteSize).toBe(2048);
  });

  it('stores the storage KEY, not the bucket-prefixed path', () => {
    // mediaService writes `<bucket>/<key>`; Storage addresses `<key>`.
    expect(storageKeyFromMediaPath('media-images', 'media-images/u/1-a.png')).toBe('u/1-a.png');
    expect(storageKeyFromMediaPath('media-images', 'u/1-a.png')).toBe('u/1-a.png');
    expect(storageKeyFromMediaPath('', 'u/1-a.png')).toBe('u/1-a.png');
  });

  it('carries NO usage on the asset — usage belongs to the relationship', async () => {
    const asset = await registerUploadedMediaAsset({
      companyId: CO_A, userId: USER_A, mediaFileId: seedUpload(USER_A),
    });
    for (const forbidden of ['usage', 'purpose', 'role', 'mode']) {
      expect(asset).not.toHaveProperty(forbidden);
    }
  });

  it('reuses the existing asset when the same upload is registered twice', async () => {
    const mf = seedUpload(USER_A);
    const first = await registerUploadedMediaAsset({ companyId: CO_A, userId: USER_A, mediaFileId: mf });
    const second = await registerUploadedMediaAsset({ companyId: CO_A, userId: USER_A, mediaFileId: mf });
    expect(second.id).toBe(first.id);
    expect(assets).toHaveLength(1);
  });

  it("refuses another user's uploaded file, indistinguishably from a missing one", async () => {
    const mf = seedUpload(USER_B);
    const foreign = await registerUploadedMediaAsset({ companyId: CO_A, userId: USER_A, mediaFileId: mf })
      .catch((e) => String(e.message));
    const missing = await registerUploadedMediaAsset({ companyId: CO_A, userId: USER_A, mediaFileId: 'nope' })
      .catch((e) => String(e.message));
    expect(foreign).toBe(missing);
    expect(assets).toHaveLength(0);
  });

  it('refuses a non-image upload', async () => {
    const mf = seedUpload(USER_A);
    (mediaFiles.find((m) => m.id === mf) as Row).mime_type = 'application/pdf';
    await expect(registerUploadedMediaAsset({ companyId: CO_A, userId: USER_A, mediaFileId: mf }))
      .rejects.toThrow(/Only image uploads/i);
  });

  it('requires company, user and file', async () => {
    for (const bad of [
      { companyId: '', userId: USER_A, mediaFileId: 'x' },
      { companyId: CO_A, userId: '', mediaFileId: 'x' },
      { companyId: CO_A, userId: USER_A, mediaFileId: '' },
    ]) {
      await expect(registerUploadedMediaAsset(bad)).rejects.toThrow(/required/i);
    }
  });
});

/* ── B. Usage ────────────────────────────────────────────────────────────── */

describe('B — usage selection', () => {
  it.each(CREATOR_ASSET_USAGE_PURPOSES)('attaches with purpose %s', async (purpose) => {
    const asset = await registerUploadedMediaAsset({
      companyId: CO_A, userId: USER_A, mediaFileId: seedUpload(USER_A),
    });
    const ref = await attachCreatorCompositionAsset({
      companyId: CO_A, compositionId: COMP, assetId: asset.id, purpose,
    });
    expect(ref.purpose).toBe(purpose);
    expect(ref.mode).toBe(defaultModeForPurpose(purpose));
    expect(ref.compositionType).toBe(CREATOR_COMPOSITION_TYPE);
    expect(ref.ordinal).toBe(0);
  });

  it('offers exactly the six Content Creator purposes, all of them persistable', () => {
    expect(CREATOR_ASSET_USAGE_PURPOSES).toEqual(
      ['subject', 'product', 'background', 'logo', 'supporting', 'style_reference']);
    for (const p of CREATOR_ASSET_USAGE_PURPOSES) expect(COMPOSITION_ASSET_PURPOSES).toContain(p);
  });

  it('keeps subject and product distinct — different intent, never collapsed', () => {
    expect(isCreatorAssetUsagePurpose('subject')).toBe(true);
    expect(isCreatorAssetUsagePurpose('product')).toBe(true);
    expect(creatorAssetUsageLabel('subject')).not.toBe(creatorAssetUsageLabel('product'));
  });

  it('does NOT expose the derived or near-synonymous purposes', () => {
    for (const hidden of ['favicon', 'dashboard', 'ui_surface', 'product_screenshot',
      'composition_reference', 'realism_reference']) {
      expect(isCreatorAssetUsagePurpose(hidden)).toBe(false);
      // …but they remain persistable — this is a UI scope, not a vocabulary fork.
      expect(COMPOSITION_ASSET_PURPOSES).toContain(hidden);
    }
  });

  it('every offered option has a distinct label and a hint', () => {
    const labels = CREATOR_ASSET_USAGE_OPTIONS.map((o) => o.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const o of CREATOR_ASSET_USAGE_OPTIONS) expect(o.hint.length).toBeGreaterThan(0);
  });

  it('rejects a purpose the Creator does not offer, at the service boundary', async () => {
    const asset = await registerUploadedMediaAsset({
      companyId: CO_A, userId: USER_A, mediaFileId: seedUpload(USER_A),
    });
    for (const bad of ['favicon', 'hero', '', 'SUBJECT']) {
      await expect(attachCreatorCompositionAsset({
        companyId: CO_A, compositionId: COMP, assetId: asset.id, purpose: bad as never,
      })).rejects.toThrow(/not one Content Creator offers/i);
    }
    expect(refs).toHaveLength(0);
  });

  it('introduces no parallel usage enum — the vocabulary is imported, not redeclared', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../lib/content/creatorCompositionAsset.ts'), 'utf8');
    // No `AssetUsage` type/enum/const of its own (the audit's discarded proposal).
    expect(src).not.toMatch(/\b(type|enum|interface|const)\s+AssetUsage\b/);
    // The purpose type comes from the canonical contract, never re-derived here.
    expect(src).toMatch(/import type \{[^}]*CompositionAssetPurpose[^}]*\} from '\.\/compositionAssetReference'/);
    // Offered purposes are a SUBSET of the canonical vocabulary, never a superset.
    for (const p of CREATOR_ASSET_USAGE_PURPOSES) expect(COMPOSITION_ASSET_PURPOSES).toContain(p);
    expect(CREATOR_ASSET_USAGE_PURPOSES.length).toBeLessThan(COMPOSITION_ASSET_PURPOSES.length);
  });
});

/* ── C. Persistence linkage ──────────────────────────────────────────────── */

describe('C — asset and reference are correctly linked', () => {
  it('the reference points at the canonical asset and resolves for display', async () => {
    const asset = await registerUploadedMediaAsset({
      companyId: CO_A, userId: USER_A, mediaFileId: seedUpload(USER_A),
    });
    await attachCreatorCompositionAsset({
      companyId: CO_A, compositionId: COMP, assetId: asset.id, purpose: 'subject',
    });
    const items = await listCreatorCompositionAssetsResolved(CO_A, COMP);
    expect(items).toHaveLength(1);
    expect(items[0].reference.assetId).toBe(asset.id);
    expect(items[0].asset?.id).toBe(asset.id);
    expect(items[0].asset?.sourceUrl).toContain('https://cdn.example/');
  });

  it('a composition with no uploads reads as empty — the image is optional', async () => {
    expect(await listCreatorCompositionAssets(CO_A, COMP)).toEqual([]);
  });
});

/* ── D. Change usage without re-uploading ────────────────────────────────── */

describe('D — changing usage keeps one canonical asset', () => {
  it('subject → background reuses the same asset id and leaves one reference', async () => {
    const asset = await registerUploadedMediaAsset({
      companyId: CO_A, userId: USER_A, mediaFileId: seedUpload(USER_A),
    });
    const first = await attachCreatorCompositionAsset({
      companyId: CO_A, compositionId: COMP, assetId: asset.id, purpose: 'subject',
    });

    const changed = await changeCreatorCompositionAssetUsage({
      companyId: CO_A, compositionId: COMP, referenceId: first.id,
      assetId: asset.id, purpose: 'background',
    });

    expect(changed.assetId).toBe(asset.id);
    expect(changed.purpose).toBe('background');
    expect(assets).toHaveLength(1);                       // no second file
    const list = await listCreatorCompositionAssets(CO_A, COMP);
    expect(list).toHaveLength(1);
    expect(list[0].purpose).toBe('background');
  });
});

/* ── E. Remove / replace ─────────────────────────────────────────────────── */

describe('E — remove and replace', () => {
  it('detach removes the relationship and KEEPS the canonical asset', async () => {
    const asset = await registerUploadedMediaAsset({
      companyId: CO_A, userId: USER_A, mediaFileId: seedUpload(USER_A),
    });
    const ref = await attachCreatorCompositionAsset({
      companyId: CO_A, compositionId: COMP, assetId: asset.id, purpose: 'subject',
    });

    await detachCreatorCompositionAsset(CO_A, ref.id);

    expect(await listCreatorCompositionAssets(CO_A, COMP)).toEqual([]);
    expect(assets.find((a) => a.id === asset.id)).toBeDefined();   // file survives
  });

  it('an asset detached from one composition stays usable in another', async () => {
    const asset = await registerUploadedMediaAsset({
      companyId: CO_A, userId: USER_A, mediaFileId: seedUpload(USER_A),
    });
    await attachCreatorCompositionAsset({
      companyId: CO_A, compositionId: 'comp-1', assetId: asset.id, purpose: 'subject',
    });
    const second = await attachCreatorCompositionAsset({
      companyId: CO_A, compositionId: 'comp-2', assetId: asset.id, purpose: 'background',
    });
    await detachCreatorCompositionAsset(CO_A, second.id);

    expect(await listCreatorCompositionAssets(CO_A, 'comp-1')).toHaveLength(1);
    expect(await listCreatorAssetUsages(CO_A, asset.id)).toHaveLength(1);
    expect(assets).toHaveLength(1);
  });

  it('replace: the new upload becomes the reference, the old asset survives', async () => {
    const oldAsset = await registerUploadedMediaAsset({
      companyId: CO_A, userId: USER_A, mediaFileId: seedUpload(USER_A, 'old.png'),
    });
    const oldRef = await attachCreatorCompositionAsset({
      companyId: CO_A, compositionId: COMP, assetId: oldAsset.id, purpose: 'subject',
    });

    const newAsset = await registerUploadedMediaAsset({
      companyId: CO_A, userId: USER_A, mediaFileId: seedUpload(USER_A, 'new.png'),
    });
    await attachCreatorCompositionAsset({
      companyId: CO_A, compositionId: COMP, assetId: newAsset.id, purpose: 'subject',
    });
    await detachCreatorCompositionAsset(CO_A, oldRef.id);

    const list = await listCreatorCompositionAssets(CO_A, COMP);
    expect(list).toHaveLength(1);
    expect(list[0].assetId).toBe(newAsset.id);
    // The replaced file is NOT deleted — canonical assets are reusable.
    expect(assets.find((a) => a.id === oldAsset.id)).toBeDefined();
  });
});

/* ── F. Tenant isolation ─────────────────────────────────────────────────── */

describe('F — tenant isolation', () => {
  it("company B cannot attach company A's asset", async () => {
    const asset = await registerUploadedMediaAsset({
      companyId: CO_A, userId: USER_A, mediaFileId: seedUpload(USER_A),
    });
    await expect(attachCreatorCompositionAsset({
      companyId: CO_B, compositionId: COMP, assetId: asset.id, purpose: 'subject',
    })).rejects.toThrow(/not found for this company/i);
    expect(refs).toHaveLength(0);
  });

  it("company B cannot read company A's references, even on the same composition id", async () => {
    const asset = await registerUploadedMediaAsset({
      companyId: CO_A, userId: USER_A, mediaFileId: seedUpload(USER_A),
    });
    await attachCreatorCompositionAsset({
      companyId: CO_A, compositionId: COMP, assetId: asset.id, purpose: 'subject',
    });
    expect(await listCreatorCompositionAssets(CO_B, COMP)).toEqual([]);
  });

  it('company scoping is sent to the database, not applied afterwards', async () => {
    const asset = await registerUploadedMediaAsset({
      companyId: CO_A, userId: USER_A, mediaFileId: seedUpload(USER_A),
    });
    await attachCreatorCompositionAsset({
      companyId: CO_A, compositionId: COMP, assetId: asset.id, purpose: 'subject',
    });
    // Every stored reference carries its tenant; nothing is company-less.
    for (const r of refs) expect(r.company_id).toBe(CO_A);
  });
});

/* ── G. Unready assets ───────────────────────────────────────────────────── */

describe('G — an asset that is not ready cannot become a reference', () => {
  it.each(['pending', 'failed'])('refuses lifecycle %s', async (state) => {
    const asset = await registerUploadedMediaAsset({
      companyId: CO_A, userId: USER_A, mediaFileId: seedUpload(USER_A),
    });
    (assets.find((a) => a.id === asset.id) as Row).lifecycle_state = state;
    await expect(attachCreatorCompositionAsset({
      companyId: CO_A, compositionId: COMP, assetId: asset.id, purpose: 'subject',
    })).rejects.toThrow(/not ready/i);
    expect(refs).toHaveLength(0);
  });
});

/* ── H. Duplicate protection ─────────────────────────────────────────────── */

describe('H — repeated submission does not duplicate', () => {
  it('the same asset in the same role twice is rejected by the uniqueness key', async () => {
    const asset = await registerUploadedMediaAsset({
      companyId: CO_A, userId: USER_A, mediaFileId: seedUpload(USER_A),
    });
    const input = {
      companyId: CO_A, compositionId: COMP, assetId: asset.id, purpose: 'subject' as const,
    };
    await attachCreatorCompositionAsset(input);
    await expect(attachCreatorCompositionAsset(input)).rejects.toThrow(/unique constraint/i);
    expect(await listCreatorCompositionAssets(CO_A, COMP)).toHaveLength(1);
  });
});

/* ── I. Composition identity survives navigation ─────────────────────────── */

describe('I — the composition key is stable across template navigation', () => {
  it('is per creator type and deterministic for a given draft', () => {
    expect(creatorCompositionKey('image')).toBe('creator_composition_id:image');
    expect(creatorCompositionKey('carousel')).not.toBe(creatorCompositionKey('image'));
    expect(creatorCompositionKey(null)).toBe('creator_composition_id:unknown');
  });

  it('a minted id encodes its type and is unique per draft', () => {
    const a = mintCreatorCompositionId('image', 1700000000000, 'aaaaaa');
    const b = mintCreatorCompositionId('image', 1700000000000, 'bbbbbb');
    expect(a).toContain('image');
    expect(a).not.toBe(b);
  });

  it('references are found by composition id alone — template choice is not part of the key', async () => {
    const asset = await registerUploadedMediaAsset({
      companyId: CO_A, userId: USER_A, mediaFileId: seedUpload(USER_A),
    });
    await attachCreatorCompositionAsset({
      companyId: CO_A, compositionId: COMP, assetId: asset.id, purpose: 'subject',
    });
    // Nothing about a template is stored on the reference, so changing template
    // cannot detach the asset.
    for (const r of refs) {
      expect(Object.keys(r)).not.toContain('template_id');
      expect(r.composition_id).toBe(COMP);
    }
    expect(await listCreatorCompositionAssets(CO_A, COMP)).toHaveLength(1);
  });
});

/* ── J. Generation isolation — the critical Phase 2B guarantee ───────────── */

describe('J — nothing reaches generation', () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');

  it('no generation or provider module imports the Phase 2B modules', () => {
    for (const p of [
      'backend/services/creator/creatorPromptComposer.ts',
      'backend/services/creator/creatorMultimodalReferences.ts',
      'backend/services/creatorAssetRendererImage.ts',
      'backend/services/creatorAssetRendererMedia.ts',
      'lib/creator-content/creatorSuggestionAndPayload.ts',
    ]) {
      const src = read(p);
      expect(src).not.toMatch(/creatorCompositionAsset/);
      expect(src).not.toMatch(/compositionAssetReference/);
      expect(src).not.toMatch(/canonicalMediaAsset/);
    }
  });

  it('the generation payload still carries no asset array', () => {
    const src = read('lib/creator-content/creatorSuggestionAndPayload.ts');
    expect(src).not.toMatch(/\bassets:\s*\[/);
    expect(src).not.toMatch(/referenceImages/);
  });

  it('the Phase 2B service touches no provider or renderer module', () => {
    const src = read('backend/services/creator/creatorCompositionAssetService.ts');
    for (const forbidden of ['generateProviderImage', 'images.edit', 'assembleMultimodalPayload',
      'composeCreatorImagePrompt', 'referenceImageUrl', 'creatorAssetRenderer']) {
      expect(src).not.toContain(forbidden);
    }
  });

  it('the UI panel states what the attached asset actually does', () => {
    const src = read('components/creator/CreatorImageAssetPanel.tsx');
    // Phase 61A wired composition_id into generation and Phase 63 made the mode
    // correct, so the old 'does not change the generated image yet' line became
    // false. The panel now states the guarantee its MODE actually gives.
    expect(src).toMatch(/Placed on this design as uploaded/i);
    expect(src).toMatch(/Used as a reference for this design/i);
    expect(src).not.toMatch(/does not change the generated image yet/i);
  });
});

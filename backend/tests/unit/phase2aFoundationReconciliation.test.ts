/**
 * Phase 2A — foundation reconciliation.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Phase 2 wiring audit found the canonical asset foundations sound but
 * short of two things that are cheap now and expensive after first write:
 *
 *   - `metadata` on the reference, so a new per-use property never costs a
 *     migration;
 *   - `supporting`, the one value the product requirement names that the
 *     purpose vocabulary lacked.
 *
 * It also had to settle which of TWO asset->composition tables is canonical:
 * `content_asset` (older, live-gated, reachable through
 * POST /api/content/:id/assets) or `composition_asset_references`. This suite
 * pins that decision at the level a future reader will check — the schema —
 * and proves the additions did not weaken the tenancy guarantee that makes the
 * newer table the right answer.
 *
 * The stub below mirrors the harness in `compositionAssetReference.test.ts`
 * deliberately: it enforces the composite foreign key and the uniqueness key,
 * so "cross-tenant rejected" is exercised behaviour rather than decoration.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import * as fs from 'fs';
import * as path from 'path';

type Row = Record<string, unknown>;

const assets: Row[] = [];
const refs: Row[] = [];
let seq = 0;

function applyFilters(rows: Row[], f: Record<string, unknown>): Row[] {
  return rows.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v));
}

function builderFor(table: string, mode: string, payload?: Row) {
  const rows = table === 'canonical_media_assets' ? assets : refs;
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
      return Promise.resolve({ data: applyFilters(rows, filters)[0] ?? null, error: null });
    },
    single() {
      if (mode === 'insert') {
        const row: Row = { ...payload, id: `id-${++seq}`, created_at: `T${seq}`, updated_at: `T${seq}` };
        if (table === 'composition_asset_references') {
          // Composite FK: (company_id, asset_id) -> (company_id, id).
          const parent = assets.find((a) => a.id === row.asset_id && a.company_id === row.company_id);
          if (!parent) {
            return Promise.resolve({
              data: null,
              error: { message: 'insert or update violates foreign key constraint' },
            });
          }
          // UNIQUE (composition_type, composition_id, asset_id, purpose)
          const dup = refs.find(
            (r) => r.composition_type === row.composition_type
              && r.composition_id === row.composition_id
              && r.asset_id === row.asset_id
              && r.purpose === row.purpose);
          if (dup) {
            return Promise.resolve({
              data: null,
              error: { message: 'duplicate key value violates unique constraint' },
            });
          }
        }
        rows.push(row);
        return Promise.resolve({ data: row, error: null });
      }
      return Promise.resolve({ data: applyFilters(rows, filters)[0] ?? null, error: null });
    },
  };
  return b;
}

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => ({
    select: () => builderFor(table, 'select'),
    insert: (p: Row) => builderFor(table, 'insert', p),
    update: (p: Row) => builderFor(table, 'update', p),
    delete: () => builderFor(table, 'delete'),
  }),
}));

import {
  COMPOSITION_ASSET_MODES,
  COMPOSITION_ASSET_PURPOSES,
  COMPOSITION_ONLY_PURPOSES,
  PROVIDER_PURPOSES,
  isCompositionAssetPurpose,
  validateCompositionAssetReferenceInput,
  compareCompositionAssetReferences,
} from '../../../lib/content/compositionAssetReference';
import {
  addCompositionAssetReference,
  listCompositionAssetReferences,
} from '../../services/compositionAssetReferenceService';
import { createCanonicalMediaAsset } from '../../services/canonicalMediaAssetService';

const CO_A = 'company-a';
const CO_B = 'company-b';

async function makeAsset(companyId: string, name = 'photo.png') {
  return createCanonicalMediaAsset({
    companyId,
    storageBucket: 'media',
    storagePath: `${companyId}/${name}-${Math.random()}`,
    mimeType: 'image/png',
    origin: 'upload',
  });
}

beforeEach(() => {
  assets.length = 0;
  refs.length = 0;
  seq = 0;
});

/* ── A. Canonical asset creation ────────────────────────────────────────── */

describe('A — canonical asset identity is unchanged by Phase 2A', () => {
  it('creates a tenant-owned upload asset with the documented lifecycle', async () => {
    const a = await makeAsset(CO_A);
    expect(a.companyId).toBe(CO_A);
    expect(a.origin).toBe('upload');
    expect(a.lifecycleState).toBe('pending');
    expect(a.storageBucket).toBe('media');
  });

  it('carries NO usage/role/purpose field — usage lives on the relationship', async () => {
    const a = await makeAsset(CO_A);
    for (const forbidden of ['usage', 'role', 'purpose', 'mode']) {
      expect(a).not.toHaveProperty(forbidden);
    }
  });
});

/* ── B. Tenant isolation ────────────────────────────────────────────────── */

describe('B — tenant isolation', () => {
  it("rejects attaching company A's asset to company B's composition", async () => {
    const a = await makeAsset(CO_A);
    await expect(addCompositionAssetReference({
      companyId: CO_B,
      compositionType: 'creator-composition',
      compositionId: 'c-1',
      assetId: a.id,
      purpose: 'subject',
      mode: 'condition',
    })).rejects.toThrow(/not found for this company/i);
  });

  it('a foreign asset and a missing asset are indistinguishable to the caller', async () => {
    const a = await makeAsset(CO_A);
    const foreign = addCompositionAssetReference({
      companyId: CO_B, compositionType: 'x', compositionId: 'c', assetId: a.id,
      purpose: 'subject', mode: 'condition',
    }).catch((e) => String(e.message));
    const missing = addCompositionAssetReference({
      companyId: CO_B, compositionType: 'x', compositionId: 'c', assetId: 'no-such-asset',
      purpose: 'subject', mode: 'condition',
    }).catch((e) => String(e.message));
    expect(await foreign).toBe(await missing);
  });

  it("does not leak company A's references into company B's read", async () => {
    const a = await makeAsset(CO_A);
    await addCompositionAssetReference({
      companyId: CO_A, compositionType: 'creator-composition', compositionId: 'shared-id',
      assetId: a.id, purpose: 'subject', mode: 'condition',
    });
    const seenByB = await listCompositionAssetReferences(CO_B, 'creator-composition', 'shared-id');
    expect(seenByB).toEqual([]);
  });
});

/* ── C. Reference uniqueness (the ACTUAL schema contract) ───────────────── */

describe('C — uniqueness is (composition_type, composition_id, asset_id, purpose)', () => {
  it('rejects the same asset twice in one composition with the SAME purpose', async () => {
    const a = await makeAsset(CO_A);
    const ref = {
      companyId: CO_A, compositionType: 'creator-composition', compositionId: 'c-1',
      assetId: a.id, purpose: 'subject' as const, mode: 'condition' as const,
    };
    await addCompositionAssetReference(ref);
    await expect(addCompositionAssetReference(ref)).rejects.toThrow(/unique constraint/i);
  });
});

/* ── D. One asset, many compositions, many usages ───────────────────────── */

describe('D — one asset serves many compositions in different roles', () => {
  it('subject here, background there, supporting elsewhere — one file', async () => {
    const a = await makeAsset(CO_A);
    await addCompositionAssetReference({
      companyId: CO_A, compositionType: 'creator-composition', compositionId: 'A',
      assetId: a.id, purpose: 'subject', mode: 'condition',
    });
    await addCompositionAssetReference({
      companyId: CO_A, compositionType: 'creator-composition', compositionId: 'B',
      assetId: a.id, purpose: 'background', mode: 'condition',
    });
    await addCompositionAssetReference({
      companyId: CO_A, compositionType: 'daily_content_plan', compositionId: 'C',
      assetId: a.id, purpose: 'supporting', mode: 'compose',
    });

    expect((await listCompositionAssetReferences(CO_A, 'creator-composition', 'A'))[0].purpose).toBe('subject');
    expect((await listCompositionAssetReferences(CO_A, 'creator-composition', 'B'))[0].purpose).toBe('background');
    expect((await listCompositionAssetReferences(CO_A, 'daily_content_plan', 'C'))[0].purpose).toBe('supporting');

    // The point of the split: three usages, ONE underlying file.
    expect(assets.filter((x) => x.id === a.id)).toHaveLength(1);
  });
});

/* ── E. Same asset, two roles, one composition ──────────────────────────── */

describe('E — the same asset may hold two distinct roles in one composition', () => {
  it('logo/compose and style_reference/condition coexist', async () => {
    const a = await makeAsset(CO_A);
    await addCompositionAssetReference({
      companyId: CO_A, compositionType: 'creator-composition', compositionId: 'c-1',
      assetId: a.id, purpose: 'logo', mode: 'compose',
    });
    await addCompositionAssetReference({
      companyId: CO_A, compositionType: 'creator-composition', compositionId: 'c-1',
      assetId: a.id, purpose: 'style_reference', mode: 'condition',
    });
    const list = await listCompositionAssetReferences(CO_A, 'creator-composition', 'c-1');
    expect(list).toHaveLength(2);
    expect(list.map((r) => r.mode).sort()).toEqual(['compose', 'condition']);
  });
});

/* ── F. Ordering ────────────────────────────────────────────────────────── */

describe('F — ordinal produces a deterministic order', () => {
  it('orders by ordinal, then created_at, then id', async () => {
    const a1 = await makeAsset(CO_A, 'one');
    const a2 = await makeAsset(CO_A, 'two');
    const a3 = await makeAsset(CO_A, 'three');
    await addCompositionAssetReference({
      companyId: CO_A, compositionType: 'k', compositionId: 'c', assetId: a3.id,
      purpose: 'overlay', mode: 'compose', ordinal: 2,
    });
    await addCompositionAssetReference({
      companyId: CO_A, compositionType: 'k', compositionId: 'c', assetId: a1.id,
      purpose: 'subject', mode: 'condition', ordinal: 0,
    });
    await addCompositionAssetReference({
      companyId: CO_A, compositionType: 'k', compositionId: 'c', assetId: a2.id,
      purpose: 'background', mode: 'condition', ordinal: 1,
    });
    const list = await listCompositionAssetReferences(CO_A, 'k', 'c');
    expect(list.map((r) => r.assetId)).toEqual([a1.id, a2.id, a3.id]);
  });

  it('ties on ordinal are broken deterministically, not arbitrarily', () => {
    const mk = (ordinal: number, createdAt: string, id: string) => ({ ordinal, createdAt, id });
    const tied = [mk(0, 'T2', 'b'), mk(0, 'T1', 'a'), mk(0, 'T1', 'z')];
    const once = [...tied].sort(compareCompositionAssetReferences).map((r) => r.id);
    const again = [...tied].reverse().sort(compareCompositionAssetReferences).map((r) => r.id);
    expect(once).toEqual(again);
    expect(once).toEqual(['a', 'z', 'b']);
  });
});

/* ── G. Purpose vocabulary ──────────────────────────────────────────────── */

describe('G — the canonical persisted usage vocabulary', () => {
  it('accepts every canonical purpose', () => {
    for (const p of COMPOSITION_ASSET_PURPOSES) expect(isCompositionAssetPurpose(p)).toBe(true);
  });

  it('includes `supporting` — the one value the product requirement was missing', () => {
    expect(COMPOSITION_ASSET_PURPOSES).toContain('supporting');
    expect(COMPOSITION_ONLY_PURPOSES).toContain('supporting');
    expect(isCompositionAssetPurpose('supporting')).toBe(true);
  });

  it('covers every role the product requirement names', () => {
    for (const required of [
      'subject', 'product', 'background', 'logo',
      'supporting', 'overlay', 'composition_reference', 'style_reference',
    ]) {
      expect(COMPOSITION_ASSET_PURPOSES).toContain(required);
    }
  });

  it('retains every provider purpose — the vocabulary is a superset, not a fork', () => {
    for (const p of PROVIDER_PURPOSES) expect(COMPOSITION_ASSET_PURPOSES).toContain(p);
    expect(COMPOSITION_ASSET_PURPOSES).toHaveLength(
      PROVIDER_PURPOSES.length + COMPOSITION_ONLY_PURPOSES.length);
  });

  it('rejects anything outside the vocabulary', () => {
    for (const bad of ['hero', 'thumbnail', 'SUBJECT', '', 'supporting_image']) {
      expect(isCompositionAssetPurpose(bad)).toBe(false);
    }
  });

  it('no parallel AssetUsage enum was introduced', () => {
    const contract = fs.readFileSync(
      path.resolve(__dirname, '../../../lib/content/compositionAssetReference.ts'), 'utf8');
    expect(contract).not.toMatch(/AssetUsage/);
  });
});

/* ── H. Mode ────────────────────────────────────────────────────────────── */

describe('H — mode contract is unchanged', () => {
  it('is exactly compose | condition — no third mode', () => {
    expect([...COMPOSITION_ASSET_MODES]).toEqual(['compose', 'condition']);
  });

  it('rejects an unknown mode at validation', () => {
    const r = validateCompositionAssetReferenceInput({
      companyId: 'c', compositionType: 't', compositionId: 'i', assetId: 'a',
      purpose: 'subject', mode: 'blend' as never,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/mode must be one of/);
  });
});

/* ── I. Metadata ────────────────────────────────────────────────────────── */

describe('I — metadata escape hatch', () => {
  it('round-trips an arbitrary object', async () => {
    const a = await makeAsset(CO_A);
    const ref = await addCompositionAssetReference({
      companyId: CO_A, compositionType: 'creator-composition', compositionId: 'c-1',
      assetId: a.id, purpose: 'subject', mode: 'condition',
      metadata: { focalPoint: { x: 0.5, y: 0.33 }, note: 'crop to face' },
    });
    expect(ref.metadata).toEqual({ focalPoint: { x: 0.5, y: 0.33 }, note: 'crop to face' });
    const [read] = await listCompositionAssetReferences(CO_A, 'creator-composition', 'c-1');
    expect(read.metadata).toEqual({ focalPoint: { x: 0.5, y: 0.33 }, note: 'crop to face' });
  });

  it('defaults to {} so consumers never branch on null', async () => {
    const a = await makeAsset(CO_A);
    const ref = await addCompositionAssetReference({
      companyId: CO_A, compositionType: 'k', compositionId: 'c',
      assetId: a.id, purpose: 'overlay', mode: 'compose',
    });
    expect(ref.metadata).toEqual({});
  });

  it('a legacy row with null metadata still reads as {}', async () => {
    const a = await makeAsset(CO_A);
    await addCompositionAssetReference({
      companyId: CO_A, compositionType: 'k', compositionId: 'legacy',
      assetId: a.id, purpose: 'subject', mode: 'condition',
    });
    // Simulate a row written before the column existed.
    refs[refs.length - 1].metadata = null;
    const [read] = await listCompositionAssetReferences(CO_A, 'k', 'legacy');
    expect(read.metadata).toEqual({});
  });

  it('rejects a non-object metadata', () => {
    for (const bad of [[], 'x', 7]) {
      const r = validateCompositionAssetReferenceInput({
        companyId: 'c', compositionType: 't', compositionId: 'i', assetId: 'a',
        purpose: 'subject', mode: 'condition', metadata: bad as never,
      });
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toMatch(/metadata must be an object/);
    }
  });

  it('metadata is NOT a second home for purpose or mode', () => {
    const contract = fs.readFileSync(
      path.resolve(__dirname, '../../../lib/content/compositionAssetReference.ts'), 'utf8');
    // Both stay typed columns; the doc says so explicitly so the next reader
    // does not "just put it in metadata".
    expect(contract).toMatch(/purpose: CompositionAssetPurpose/);
    expect(contract).toMatch(/mode: CompositionAssetMode/);
    expect(contract).toMatch(/NOT a second home for `purpose` or/);
  });
});

/* ── J. Schema pins + legacy boundary ───────────────────────────────────── */

describe('J — Phase 2A migration pins', () => {
  const DIR = path.resolve(__dirname, '../../../supabase/migrations');
  const HARDENING = fs.readFileSync(
    path.join(DIR, '20261008000000_composition_asset_reference_hardening.sql'), 'utf8');
  const BASE = fs.readFileSync(
    path.join(DIR, '20261007000000_composition_asset_reference.sql'), 'utf8');

  it('adds metadata as a defaulted, non-null jsonb column', () => {
    expect(HARDENING).toMatch(
      /ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  });

  it('adds `supporting` to the database CHECK, matching the TypeScript vocabulary', () => {
    expect(HARDENING).toContain("'supporting'");
    for (const p of COMPOSITION_ASSET_PURPOSES) expect(HARDENING).toContain(`'${p}'`);
  });

  it('does NOT add a speculative transform column', () => {
    expect(HARDENING).not.toMatch(/ADD COLUMN[^;]*transform/i);
  });

  it('records the content_asset legacy boundary on the table itself', () => {
    expect(HARDENING).toMatch(/COMMENT ON TABLE public\.content_asset/);
    expect(HARDENING).toMatch(/composition_asset_references/);
  });

  it('MUTATION GUARD: additive only — nothing dropped, no data rewritten', () => {
    expect(HARDENING).not.toMatch(/DROP TABLE/i);
    expect(HARDENING).not.toMatch(/DROP COLUMN/i);
    expect(HARDENING).not.toMatch(/\bTRUNCATE\b/i);
    expect(HARDENING).not.toMatch(/\bDELETE FROM\b/i);
    expect(HARDENING).not.toMatch(/\bUPDATE\s+public\./i);
    // The only DROP permitted is the unnamed CHECK it immediately replaces.
    const drops = HARDENING.match(/DROP CONSTRAINT/gi) ?? [];
    expect(drops).toHaveLength(1);
  });

  it('MUTATION GUARD: touches no unrelated table', () => {
    expect(HARDENING).not.toMatch(
      /ALTER TABLE\s+(public\.)?(media_files|creator_assets|creator_asset_attachments|content_assets|content|daily_content_plans|scheduled_posts|canonical_media_assets)/i);
  });

  it('is order-tolerant: every block is guarded on the table existing', () => {
    // The ledger is desynced from production, so this must be safe to apply to
    // a database where the base migration has not yet run.
    expect(HARDENING).toMatch(/information_schema\.tables/);
    expect(HARDENING).toMatch(/table_name = 'composition_asset_references'/);
  });

  it('leaves the base migration untouched — history is not rewritten', () => {
    expect(BASE).toMatch(/FOREIGN KEY \(company_id, asset_id\)/);
    expect(BASE).not.toContain("'supporting'");
    expect(BASE).not.toMatch(/metadata jsonb/);
  });

  it('the tenancy guarantee still rests on the composite FK', () => {
    expect(BASE).toMatch(/REFERENCES public\.canonical_media_assets \(company_id, id\)/);
    expect(HARDENING).not.toMatch(/DROP CONSTRAINT composition_asset_references_asset_fk/);
  });
});

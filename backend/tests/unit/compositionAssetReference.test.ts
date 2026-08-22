/**
 * Composition Asset Reference — the contract that makes an asset reusable.
 *
 * WHY THIS EXISTS
 * ---------------
 * Phase 43 deliberately left usage OFF the canonical asset, because the same
 * photograph is the subject of one composition, the background of another and
 * an overlay in a third. That decision is only worth anything if the other half
 * exists and actually permits reuse — otherwise the pressure to "just add a
 * usage column" returns immediately.
 *
 * So the reuse tests below are the point of the suite, not a formality: one
 * asset, three compositions, three different purposes AND three different
 * modes, with no duplication of the underlying file.
 *
 * The stub enforces the two integrity rules the DATABASE enforces — the
 * composite foreign key and the uniqueness key — so "cross-tenant rejected" and
 * "duplicate rejected" are exercised behaviour rather than decoration. The SQL
 * that backs them is pinned separately in section H.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import * as fs from 'fs';
import * as path from 'path';

type Row = Record<string, unknown>;

/* ── In-memory stand-in enforcing the real DB invariants ────────────────────*/

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
          const parent = assets.find(
            (a) => a.id === row.asset_id && a.company_id === row.company_id);
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
  compareCompositionAssetReferences,
  isCompositionAssetMode,
  isCompositionAssetPurpose,
  validateCompositionAssetReferenceInput,
  type CompositionAssetReferenceInput,
} from '../../../lib/content/compositionAssetReference';
import {
  addCompositionAssetReference,
  listCompositionAssetReferences,
  listReferencesForAsset,
} from '../../services/compositionAssetReferenceService';

const COMPANY_A = 'company-aaaa';
const COMPANY_B = 'company-bbbb';

/** Seed an asset directly — Phase 43's own path is tested in its own suite. */
function seedAsset(companyId: string): string {
  const id = `asset-${++seq}`;
  assets.push({ id, company_id: companyId, lifecycle_state: 'ready' });
  return id;
}

function refInput(over: Partial<CompositionAssetReferenceInput> = {}): CompositionAssetReferenceInput {
  return {
    companyId: COMPANY_A,
    compositionType: 'creator_card',
    compositionId: 'comp-1',
    assetId: 'placeholder',
    purpose: 'subject',
    mode: 'condition',
    ...over,
  };
}

beforeEach(() => {
  assets.length = 0;
  refs.length = 0;
  seq = 0;
});

describe('A — the asset stays usage-neutral', () => {
  const ASSET_CONTRACT = fs.readFileSync(
    path.resolve(__dirname, '../../../lib/content/canonicalMediaAsset.ts'), 'utf8');

  it('MUTATION GUARD: Phase 43 asset still has no purpose/mode/usage field', () => {
    // If usage ever migrates onto the asset, this whole relationship becomes
    // dead weight and reuse silently breaks. That regression must fail here.
    const body = ASSET_CONTRACT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['usage', 'purpose', 'mode', 'assetRole']) {
      expect(body).not.toMatch(new RegExp(`\\b${forbidden}\\b\\s*[?:]`));
    }
  });

  it('one asset can be referenced more than once', async () => {
    const assetId = seedAsset(COMPANY_A);
    await addCompositionAssetReference(refInput({ assetId, compositionId: 'c1' }));
    await addCompositionAssetReference(refInput({ assetId, compositionId: 'c2' }));

    const uses = await listReferencesForAsset(COMPANY_A, assetId);
    expect(uses).toHaveLength(2);
    // Still ONE stored file.
    expect(assets.filter((a) => a.id === assetId)).toHaveLength(1);
  });
});

describe('B — purpose', () => {
  it.each(COMPOSITION_ASSET_PURPOSES)('accepts purpose %s', (purpose) => {
    expect(isCompositionAssetPurpose(purpose)).toBe(true);
    expect(validateCompositionAssetReferenceInput(refInput({ purpose })).ok).toBe(true);
  });

  it('rejects an unknown purpose', () => {
    expect(isCompositionAssetPurpose('vibes')).toBe(false);
    const r = validateCompositionAssetReferenceInput(refInput({ purpose: 'vibes' as never }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('purpose');
  });

  it('the Phase 42 composition roles exist', () => {
    for (const p of ['subject', 'background', 'overlay']) {
      expect(COMPOSITION_ASSET_PURPOSES).toContain(p);
    }
    // `logo` was already in the provider vocabulary — reused, not re-added.
    expect(PROVIDER_PURPOSES).toContain('logo');
    expect(COMPOSITION_ONLY_PURPOSES).not.toContain('logo' as never);
  });

  it('MUTATION GUARD: one vocabulary — every provider purpose is a legal composition purpose', () => {
    // A fork here is the failure mode: two enums that drift until a provider
    // purpose can no longer be expressed on a reference.
    for (const p of PROVIDER_PURPOSES) expect(COMPOSITION_ASSET_PURPOSES).toContain(p);
    expect(COMPOSITION_ASSET_PURPOSES).toHaveLength(
      PROVIDER_PURPOSES.length + COMPOSITION_ONLY_PURPOSES.length);
  });

  it('product (a photograph) is distinct from product_screenshot (UI)', () => {
    expect(COMPOSITION_ASSET_PURPOSES).toContain('product');
    expect(COMPOSITION_ASSET_PURPOSES).toContain('product_screenshot');
  });
});

describe('C — mode is a guarantee, not a style', () => {
  it('compose and condition are both accepted', () => {
    expect(isCompositionAssetMode('compose')).toBe(true);
    expect(isCompositionAssetMode('condition')).toBe(true);
  });

  it('rejects an unknown mode', () => {
    expect(isCompositionAssetMode('creative')).toBe(false);
    const r = validateCompositionAssetReferenceInput(refInput({ mode: 'creative' as never }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('mode');
  });

  it('MUTATION GUARD: exactly two modes, and they are not styles', () => {
    // Adding a third "mode" (e.g. 'auto') would reintroduce the ambiguity the
    // provider spike existed to remove: whether pixels are preserved must never
    // be a guess.
    expect([...COMPOSITION_ASSET_MODES].sort()).toEqual(['compose', 'condition']);
  });
});

describe('D — multiple references and ordering', () => {
  it('a composition holds many assets in distinct roles', async () => {
    const [a, b, c, d] = [seedAsset(COMPANY_A), seedAsset(COMPANY_A), seedAsset(COMPANY_A), seedAsset(COMPANY_A)];
    await addCompositionAssetReference(refInput({ assetId: a, purpose: 'subject',    mode: 'condition', ordinal: 0 }));
    await addCompositionAssetReference(refInput({ assetId: b, purpose: 'product',    mode: 'condition', ordinal: 1 }));
    await addCompositionAssetReference(refInput({ assetId: c, purpose: 'logo',       mode: 'compose',   ordinal: 2 }));
    await addCompositionAssetReference(refInput({ assetId: d, purpose: 'background', mode: 'condition', ordinal: 3 }));

    const list = await listCompositionAssetReferences(COMPANY_A, 'creator_card', 'comp-1');
    expect(list).toHaveLength(4);
    expect(list.map((r) => r.purpose)).toEqual(['subject', 'product', 'logo', 'background']);
    expect(list.map((r) => r.mode)).toEqual(['condition', 'condition', 'compose', 'condition']);
  });

  it('ordering is deterministic, including when ordinals tie', () => {
    // ordinal alone is not a total order; ties resolve on (createdAt, id).
    const rows = [
      { ordinal: 1, createdAt: 'T2', id: 'b' },
      { ordinal: 0, createdAt: 'T9', id: 'z' },
      { ordinal: 1, createdAt: 'T1', id: 'c' },
      { ordinal: 1, createdAt: 'T1', id: 'a' },
    ];
    const once = [...rows].sort(compareCompositionAssetReferences).map((r) => r.id);
    const twice = [...rows].reverse().sort(compareCompositionAssetReferences).map((r) => r.id);
    expect(once).toEqual(['z', 'a', 'c', 'b']);
    expect(twice).toEqual(once); // input order cannot change the result
  });

  it('rejects a negative ordinal', () => {
    const r = validateCompositionAssetReferenceInput(refInput({ ordinal: -1 }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('ordinal');
  });
});

describe('E — reuse: THE reason usage is not on the asset', () => {
  it('the same asset takes different purposes AND modes in different compositions', async () => {
    const assetId = seedAsset(COMPANY_A);

    await addCompositionAssetReference(refInput({ assetId, compositionId: 'c1', purpose: 'subject',    mode: 'condition' }));
    await addCompositionAssetReference(refInput({ assetId, compositionId: 'c2', purpose: 'background', mode: 'condition' }));
    await addCompositionAssetReference(refInput({ assetId, compositionId: 'c3', purpose: 'overlay',    mode: 'compose'   }));

    const c1 = await listCompositionAssetReferences(COMPANY_A, 'creator_card', 'c1');
    const c2 = await listCompositionAssetReferences(COMPANY_A, 'creator_card', 'c2');
    const c3 = await listCompositionAssetReferences(COMPANY_A, 'creator_card', 'c3');

    expect(c1[0].purpose).toBe('subject');
    expect(c2[0].purpose).toBe('background');
    expect(c3[0].purpose).toBe('overlay');
    expect(c3[0].mode).toBe('compose');

    // One file, three roles — no duplication anywhere.
    expect(assets).toHaveLength(1);
    expect(refs).toHaveLength(3);
  });

  it('one asset may hold two different roles within ONE composition', async () => {
    const assetId = seedAsset(COMPANY_A);
    await addCompositionAssetReference(refInput({ assetId, purpose: 'overlay', mode: 'compose' }));
    await addCompositionAssetReference(refInput({ assetId, purpose: 'style_reference', mode: 'condition' }));
    const list = await listCompositionAssetReferences(COMPANY_A, 'creator_card', 'comp-1');
    expect(list).toHaveLength(2);
  });
});

describe('F — tenant isolation', () => {
  it('CRITICAL: company A cannot attach company B asset', async () => {
    const foreign = seedAsset(COMPANY_B);
    await expect(
      addCompositionAssetReference(refInput({ companyId: COMPANY_A, assetId: foreign })),
    ).rejects.toThrow(/not found for this company/i);
    expect(refs).toHaveLength(0);
  });

  it('a foreign asset and a missing asset are indistinguishable to the caller', async () => {
    // Otherwise this becomes an existence oracle for another tenant's ids.
    const foreign = seedAsset(COMPANY_B);
    const missing = 'asset-does-not-exist';
    const errs: string[] = [];
    for (const id of [foreign, missing]) {
      await addCompositionAssetReference(refInput({ assetId: id })).catch((e) => errs.push(e.message));
    }
    expect(errs).toHaveLength(2);
    expect(errs[0]).toBe(errs[1]);
  });

  it('reads are company-scoped', async () => {
    const assetId = seedAsset(COMPANY_A);
    await addCompositionAssetReference(refInput({ assetId }));
    expect(await listCompositionAssetReferences(COMPANY_A, 'creator_card', 'comp-1')).toHaveLength(1);
    expect(await listCompositionAssetReferences(COMPANY_B, 'creator_card', 'comp-1')).toHaveLength(0);
    expect(await listReferencesForAsset(COMPANY_B, assetId)).toHaveLength(0);
  });

  it('every accessor demands a company — an id alone is never enough', () => {
    expect(listCompositionAssetReferences.length).toBe(3);
    expect(listReferencesForAsset.length).toBe(2);
  });
});

describe('G — integrity', () => {
  it('a missing asset is rejected', async () => {
    await expect(
      addCompositionAssetReference(refInput({ assetId: 'nope' })),
    ).rejects.toThrow(/not found/i);
  });

  it('an exact duplicate is rejected', async () => {
    const assetId = seedAsset(COMPANY_A);
    await addCompositionAssetReference(refInput({ assetId, purpose: 'subject' }));
    await expect(
      addCompositionAssetReference(refInput({ assetId, purpose: 'subject' })),
    ).rejects.toThrow(/duplicate key value/i);
    expect(refs).toHaveLength(1);
  });

  it('required fields cannot be omitted', () => {
    for (const field of ['companyId', 'compositionType', 'compositionId', 'assetId'] as const) {
      const input = refInput();
      delete (input as Partial<CompositionAssetReferenceInput>)[field];
      const r = validateCompositionAssetReferenceInput(input);
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toContain(field);
    }
  });

  it('the service refuses an invalid payload before touching the database', async () => {
    await expect(
      addCompositionAssetReference(refInput({ mode: 'bogus' as never })),
    ).rejects.toThrow(/invalid composition asset reference/i);
    expect(refs).toHaveLength(0);
  });
});

describe('H — schema pins', () => {
  const MIGRATION = fs.readFileSync(
    path.resolve(__dirname,
      '../../../supabase/migrations/20261007000000_composition_asset_reference.sql'), 'utf8');

  it('cross-tenant reference is structurally impossible: composite FK', () => {
    // A plain `REFERENCES canonical_media_assets(id)` would leave the tenant
    // boundary resting entirely on application code. The composite key means
    // naming an asset requires naming its owner.
    expect(MIGRATION).toMatch(/FOREIGN KEY \(company_id, asset_id\)/);
    expect(MIGRATION).toMatch(/REFERENCES public\.canonical_media_assets \(company_id, id\)/);
    expect(MIGRATION).not.toMatch(/REFERENCES public\.canonical_media_assets ?\(id\)/);
  });

  it('the composite FK target exists on the parent', () => {
    expect(MIGRATION).toMatch(/ADD CONSTRAINT canonical_media_assets_company_id_key UNIQUE \(company_id, id\)/);
  });

  it('purpose and mode are typed columns with CHECKs, not jsonb', () => {
    expect(MIGRATION).toMatch(/mode\s+text\s+NOT NULL/);
    expect(MIGRATION).toMatch(/CHECK \(mode IN \('compose', 'condition'\)\)/);
    expect(MIGRATION).toMatch(/purpose\s+text\s+NOT NULL/);
    for (const p of ['subject', 'background', 'overlay', 'product']) {
      expect(MIGRATION).toContain(`'${p}'`);
    }
  });

  it('duplicate relationships are rejected by a uniqueness key that includes purpose', () => {
    expect(MIGRATION).toMatch(
      /UNIQUE \(composition_type, composition_id, asset_id, purpose\)/);
  });

  it('ordinal cannot be negative', () => {
    expect(MIGRATION).toMatch(/ordinal\s+integer\s+NOT NULL DEFAULT 0 CHECK \(ordinal >= 0\)/);
  });

  it('RLS is enabled with the same membership predicate as its neighbours', () => {
    expect(MIGRATION).toContain('ENABLE ROW LEVEL SECURITY');
    expect(MIGRATION).toContain('user_company_roles');
    expect(MIGRATION).toMatch(/ucr\.status\s*=\s*'active'/);
  });

  it('MUTATION GUARD: additive — no existing flow table is altered', () => {
    // The only ALTER permitted is the FK target on Phase 43's own table.
    expect(MIGRATION).not.toMatch(
      /ALTER TABLE\s+(public\.)?(media_files|creator_assets|creator_asset_attachments|content_assets|daily_content_plans|scheduled_posts)/i);
    expect(MIGRATION).not.toMatch(/DROP TABLE/i);
    expect(MIGRATION).not.toMatch(/UPDATE\s+(public\.)?(media_files|creator_assets)/i);
  });

  it('MUTATION GUARD: no usage column was added to the asset table', () => {
    const alters = MIGRATION.match(/ALTER TABLE public\.canonical_media_assets[\s\S]*?;/g) ?? [];
    expect(alters.length).toBeGreaterThan(0);
    for (const a of alters) {
      expect(a).not.toMatch(/ADD COLUMN/i);
      expect(a).toMatch(/ADD CONSTRAINT/i);
    }
  });
});

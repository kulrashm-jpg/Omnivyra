/**
 * Canonical Media Asset foundation.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Content Asset & Template audit found SEVEN representations of "an image"
 * across this codebase, two incompatible tenancy models, and no identity that
 * survives an asset being reused in a second composition. The worst of those
 * models — `media_files`, anchored on `user_id` with no `company_id` — forced
 * "tenant == row owner" and left `/api/media/*` cross-tenant reachable until
 * MEDIA-SEC-001 closed it.
 *
 * These tests pin the properties that stop the canonical table repeating any of
 * that: identity that is independent of every use, a company boundary that an
 * asset id alone cannot cross, provenance and lifecycle that reject nonsense,
 * and — critically — the DELIBERATE ABSENCE of usage semantics.
 *
 * The absence guard is load-bearing. Adding `usage: 'background'` to the asset
 * would look like progress and would quietly make one image unusable in a
 * second role; nothing else in the suite would fail.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import * as fs from 'fs';
import * as path from 'path';

/* ── In-memory stand-in for the table ────────────────────────────────────────
 * Records the filters each query applied, so the tenancy tests can assert that
 * company scoping was REALLY sent to the database rather than merely producing
 * an empty result by luck. */

type Row = Record<string, unknown>;
const store: { rows: Row[] } = { rows: [] };
const appliedFilters: Array<Record<string, unknown>> = [];

function makeBuilder(initialRows: Row[] | null, mode: 'select' | 'insert' | 'update', payload?: Row) {
  const filters: Record<string, unknown> = {};
  appliedFilters.push(filters);

  const builder: Record<string, unknown> = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    eq(column: string, value: unknown) {
      filters[column] = value;
      return builder;
    },
    then(resolve: (r: { data: Row[]; error: null }) => unknown) {
      return Promise.resolve(resolve({ data: applyFilters(initialRows ?? store.rows, filters), error: null }));
    },
    maybeSingle() {
      const matched = applyFilters(store.rows, filters);
      return Promise.resolve({ data: matched[0] ?? null, error: null });
    },
    single() {
      if (mode === 'insert') {
        const row = { ...payload, id: `asset-${store.rows.length + 1}`, created_at: 'T0', updated_at: 'T0' };
        store.rows.push(row);
        return Promise.resolve({ data: row, error: null });
      }
      if (mode === 'update') {
        const matched = applyFilters(store.rows, filters);
        if (!matched[0]) return Promise.resolve({ data: null, error: { message: 'not found' } });
        Object.assign(matched[0], payload);
        return Promise.resolve({ data: matched[0], error: null });
      }
      const matched = applyFilters(store.rows, filters);
      return Promise.resolve({ data: matched[0] ?? null, error: null });
    },
  };
  return builder;
}

function applyFilters(rows: Row[], filters: Record<string, unknown>): Row[] {
  return rows.filter((row) => Object.entries(filters).every(([col, val]) => row[col] === val));
}

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => ({
    select: () => makeBuilder(null, 'select'),
    insert: (payload: Row) => makeBuilder(null, 'insert', payload),
    update: (payload: Row) => makeBuilder(null, 'update', payload),
  }),
}));

import {
  MEDIA_ASSET_ORIGINS,
  MEDIA_ASSET_LIFECYCLE_STATES,
  canTransitionMediaAsset,
  isUsableMediaAsset,
  validateCanonicalMediaAssetInput,
  type CanonicalMediaAssetInput,
} from '../../../lib/content/canonicalMediaAsset';
import {
  createCanonicalMediaAsset,
  getCanonicalMediaAsset,
  setCanonicalMediaAssetLifecycle,
} from '../../services/canonicalMediaAssetService';

const COMPANY_A = 'company-aaaa';
const COMPANY_B = 'company-bbbb';

function validInput(overrides: Partial<CanonicalMediaAssetInput> = {}): CanonicalMediaAssetInput {
  return {
    companyId: COMPANY_A,
    storageBucket: 'media-uploads',
    storagePath: 'company-aaaa/images/photo.png',
    mimeType: 'image/png',
    origin: 'upload',
    ...overrides,
  };
}

beforeEach(() => {
  store.rows = [];
  appliedFilters.length = 0;
});

describe('A — identity', () => {
  it('assigns a stable id that is not derived from any single use', async () => {
    const asset = await createCanonicalMediaAsset(validInput());
    expect(asset.id).toBeTruthy();

    // The id must not be the storage path, the filename, the URL, the uploader
    // or the tenant — every one of which was found acting as identity somewhere.
    expect(asset.id).not.toBe(asset.storagePath);
    expect(asset.id).not.toBe(asset.originalFilename);
    expect(asset.id).not.toBe(asset.companyId);
    expect(asset.id).not.toBe(asset.createdBy);
  });

  it('two uploads of the same filename are two distinct assets', async () => {
    const first = await createCanonicalMediaAsset(validInput({ storagePath: 'a/photo.png' }));
    const second = await createCanonicalMediaAsset(validInput({ storagePath: 'b/photo.png' }));
    expect(first.id).not.toBe(second.id);
  });

  it('MUTATION GUARD: the contract carries no composition/template/campaign coupling', () => {
    // Identity must survive reuse across many compositions, so the asset may
    // not reference the thing it is currently used by.
    const asset = validInput();
    for (const forbidden of ['compositionId', 'templateId', 'campaignId', 'scheduledPostId', 'creatorAssetId']) {
      expect(asset).not.toHaveProperty(forbidden);
    }
  });
});

describe('B — tenancy', () => {
  it('CRITICAL: company B cannot read company A asset by id', async () => {
    const asset = await createCanonicalMediaAsset(validInput({ companyId: COMPANY_A }));

    const asA = await getCanonicalMediaAsset(COMPANY_A, asset.id);
    expect(asA?.id).toBe(asset.id);

    const asB = await getCanonicalMediaAsset(COMPANY_B, asset.id);
    expect(asB).toBeNull();
  });

  it('the company filter is actually sent to the database, not applied after', async () => {
    const asset = await createCanonicalMediaAsset(validInput());
    appliedFilters.length = 0;
    await getCanonicalMediaAsset(COMPANY_A, asset.id);

    // A read that forgot .eq('company_id', …) would still pass the test above
    // whenever the store held one row. Pin the predicate itself.
    const readFilters = appliedFilters.find((f) => 'id' in f);
    expect(readFilters).toBeDefined();
    expect(readFilters!.company_id).toBe(COMPANY_A);
  });

  it('an id alone is never sufficient — every accessor demands a company', () => {
    // Signature-level guarantee: companyId is the first positional argument, so
    // there is no accessor that takes only an id.
    expect(getCanonicalMediaAsset.length).toBe(2);
    expect(setCanonicalMediaAssetLifecycle.length).toBe(3);
  });

  it('cross-tenant lifecycle mutation is refused', async () => {
    const asset = await createCanonicalMediaAsset(validInput({ companyId: COMPANY_A }));
    await expect(setCanonicalMediaAssetLifecycle(COMPANY_B, asset.id, 'ready')).rejects.toThrow(
      /not found/i,
    );
  });

  it('created_by is provenance and never an authorization input', async () => {
    const asset = await createCanonicalMediaAsset(validInput({ createdBy: 'user-1' }));
    // Another member of the SAME company reads it fine — access follows the
    // company, not the uploader. This is the media_files trap, refused.
    const read = await getCanonicalMediaAsset(COMPANY_A, asset.id);
    expect(read?.createdBy).toBe('user-1');
    expect(read?.id).toBe(asset.id);
  });
});

describe('C — provenance', () => {
  it.each(MEDIA_ASSET_ORIGINS)('accepts origin %s', (origin) => {
    expect(validateCanonicalMediaAssetInput(validInput({ origin })).ok).toBe(true);
  });

  it('rejects an unsupported origin', () => {
    const result = validateCanonicalMediaAssetInput(
      validInput({ origin: 'hallucinated' as never }),
    );
    expect(result.ok).toBe(false);
  });

  it('every origin maps to a flow that exists today — no speculative values', () => {
    expect([...MEDIA_ASSET_ORIGINS].sort()).toEqual(['external', 'generated', 'stock', 'upload']);
  });
});

describe('D — lifecycle', () => {
  it('a new asset is pending, never ready', async () => {
    const asset = await createCanonicalMediaAsset(validInput());
    // "I wrote the bytes" and "the object is verified readable" are different
    // claims; the two-step upload path already distinguishes them.
    expect(asset.lifecycleState).toBe('pending');
    expect(isUsableMediaAsset(asset)).toBe(false);
  });

  it('pending may become ready or failed', () => {
    expect(canTransitionMediaAsset('pending', 'ready')).toBe(true);
    expect(canTransitionMediaAsset('pending', 'failed')).toBe(true);
  });

  it('terminal states accept nothing', () => {
    expect(canTransitionMediaAsset('ready', 'pending')).toBe(false);
    expect(canTransitionMediaAsset('failed', 'ready')).toBe(false);
    expect(canTransitionMediaAsset('ready', 'failed')).toBe(false);
  });

  it('an illegal transition is refused against the PERSISTED state', async () => {
    const asset = await createCanonicalMediaAsset(validInput());
    await setCanonicalMediaAssetLifecycle(COMPANY_A, asset.id, 'ready');
    // A stale caller must not be able to resurrect or re-promote.
    await expect(setCanonicalMediaAssetLifecycle(COMPANY_A, asset.id, 'failed')).rejects.toThrow(
      /illegal lifecycle transition/i,
    );
  });

  it('only ready is usable', () => {
    expect(isUsableMediaAsset({ lifecycleState: 'ready' })).toBe(true);
    expect(isUsableMediaAsset({ lifecycleState: 'pending' })).toBe(false);
    expect(isUsableMediaAsset({ lifecycleState: 'failed' })).toBe(false);
  });

  it('the lifecycle is the minimum, not a state machine', () => {
    expect(MEDIA_ASSET_LIFECYCLE_STATES).toHaveLength(3);
  });
});

describe('E — contract', () => {
  it.each(['companyId', 'storageBucket', 'storagePath', 'mimeType'] as const)(
    'rejects input missing %s',
    (field) => {
      const input = validInput();
      delete (input as Partial<CanonicalMediaAssetInput>)[field];
      const result = validateCanonicalMediaAssetInput(input);
      expect(result.ok).toBe(false);
      expect(result.errors.join(" ")).toContain(field);
    },
  );

  it('reports every failure at once rather than the first', () => {
    const result = validateCanonicalMediaAssetInput({ origin: 'nope' as never });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });

  it('optional dimensions must be positive when supplied, absent when unknown', () => {
    expect(validateCanonicalMediaAssetInput(validInput({ width: 0 })).ok).toBe(false);
    expect(validateCanonicalMediaAssetInput(validInput({ byteSize: -1 })).ok).toBe(false);
    // Absent means absent — never guessed into existence.
    expect(validateCanonicalMediaAssetInput(validInput({ width: null })).ok).toBe(true);
  });

  it('the service refuses an invalid payload before touching the database', async () => {
    await expect(
      createCanonicalMediaAsset(validInput({ origin: 'bogus' as never })),
    ).rejects.toThrow(/invalid canonical media asset/i);
    expect(store.rows).toHaveLength(0);
  });
});

describe('F — usage semantics are deliberately absent', () => {
  const CONTRACT = fs.readFileSync(
    path.resolve(__dirname, '../../../lib/content/canonicalMediaAsset.ts'),
    'utf8',
  );
  const MIGRATION = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../supabase/migrations/20261006000000_canonical_media_asset_foundation.sql',
    ),
    'utf8',
  );

  it('MUTATION GUARD: no usage/role field on the asset contract', () => {
    // The same photograph is the subject in one composition, the background in
    // another and a reference in a third. Usage belongs to the asset-to-
    // composition relationship; on the asset it would pin one image to one role.
    const body = CONTRACT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['usage', 'assetRole', 'purpose', 'ReferenceImagePurpose']) {
      expect(body).not.toMatch(new RegExp(`\\b${forbidden}\\b\\s*[?:]`));
    }
  });

  it('MUTATION GUARD: no usage column on the table', () => {
    const columns = MIGRATION.slice(
      MIGRATION.indexOf('CREATE TABLE'),
      MIGRATION.indexOf('CREATE INDEX'),
    );
    for (const forbidden of ['usage', 'asset_role', 'purpose', 'subject', 'background', 'overlay']) {
      expect(columns).not.toMatch(new RegExp(`^\\s+${forbidden}\\s+`, 'm'));
    }
  });

  it('tenancy is explicit in the schema: company_id NOT NULL', () => {
    expect(MIGRATION).toMatch(/company_id\s+uuid\s+NOT NULL/);
    // created_by must stay nullable — it is provenance, not the anchor.
    expect(MIGRATION).toMatch(/created_by\s+uuid\s+NULL/);
  });

  it('RLS is enabled and scoped by active company membership', () => {
    expect(MIGRATION).toContain('ENABLE ROW LEVEL SECURITY');
    expect(MIGRATION).toContain('user_company_roles');
    expect(MIGRATION).toMatch(/ucr\.status\s*=\s*'active'/);
  });

  it('MUTATION GUARD: this migration is additive — it alters no existing table', () => {
    // The foundation must not migrate, redirect or reshape media_files,
    // creator_assets or content_assets. Naming them in prose is fine; issuing
    // DDL against them is not.
    expect(MIGRATION).not.toMatch(/ALTER TABLE\s+(public\.)?(media_files|creator_assets|content_assets|creator_asset_attachments)/i);
    expect(MIGRATION).not.toMatch(/DROP TABLE/i);
    expect(MIGRATION).not.toMatch(/INSERT INTO\s+(public\.)?(media_files|creator_assets)/i);
  });
});

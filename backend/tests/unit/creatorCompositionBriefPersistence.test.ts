/**
 * PR 2 — the creator brief is persisted server-side per draft, tenant-scoped.
 *
 * The stub enforces what the database enforces: the uniqueness key
 * (company_id, composition_type, composition_id) for upsert, and equality
 * filters for reads — so "company B cannot read company A's brief" is a real
 * outcome of the filters the service applies, not decoration.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

type Row = Record<string, unknown>;
const rows: Row[] = [];
let failWrites = false;

function builder(table: string) {
  const filters: Record<string, unknown> = {};
  const b: Record<string, unknown> = {
    select: () => b,
    eq(col: string, val: unknown) { filters[col] = val; return b; },
    maybeSingle() {
      const hit = rows.find((r) => r.__table === table && Object.entries(filters).every(([k, v]) => r[k] === v));
      return Promise.resolve({ data: hit ?? null, error: null });
    },
    upsert(payload: Row, opts: { onConflict: string }) {
      if (failWrites) return Promise.resolve({ error: { message: 'relation "creator_composition_briefs" does not exist' } });
      const keys = opts.onConflict.split(',');
      const existing = rows.find((r) => r.__table === table && keys.every((k) => r[k] === payload[k]));
      if (existing) Object.assign(existing, payload);
      else rows.push({ ...payload, __table: table });
      return Promise.resolve({ error: null });
    },
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => builder(t) }));

const access: { allow: Set<string> } = { allow: new Set() };
jest.mock('@/backend/services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async ({ res, companyId }: { res: { status: (n: number) => { json: (b: unknown) => void } }; companyId: string }) => {
    if (access.allow.has(companyId)) return { companyId };
    res.status(403).json({ error: 'forbidden' });
    return null;
  }),
  resolveUserContext: jest.fn(async () => ({ userId: 'user-1' })),
}));

import * as fs from 'fs';
import * as path from 'path';
import {
  getCreatorCompositionBrief,
  saveCreatorCompositionBrief,
  isValidCompositionId,
} from '../../services/creator/creatorCompositionBriefService';
import handler from '../../../pages/api/creator-assets/composition-brief';

const BRIEF = {
  mainMessage: 'Teams publish a week of content in one afternoon',
  body: 'Teams publish a week of content in one afternoon. Busy founders get evenings back.',
  audience: 'Busy founders', tone: 'Confident', cta: 'Start free', offer: 'Scheduler', objective: 'Drive trials',
  source: 'workspace',
};

function mockReqRes(method: string, query: Record<string, string>, body?: Record<string, unknown>) {
  const out: { status: number; json: unknown } = { status: 0, json: null };
  const res = {
    setHeader: jest.fn(),
    status(n: number) { out.status = n; return this; },
    json(b: unknown) { out.json = b; return this; },
    end() { return this; },
    headersSent: false,
  };
  const req = { method, query, body: body ?? {}, headers: {}, url: '/api/creator-assets/composition-brief' };
  return { req, res, out };
}

beforeEach(() => { rows.length = 0; failWrites = false; access.allow = new Set(); });

describe('service round-trip', () => {
  it('save → get returns the same sanitised brief', async () => {
    const saved = await saveCreatorCompositionBrief({ companyId: 'co-A', userId: 'u', compositionId: 'creator_image_1_abc', brief: BRIEF });
    expect(saved.ok).toBe(true);
    const got = await getCreatorCompositionBrief('co-A', 'creator_image_1_abc');
    expect(got).toEqual(BRIEF);
  });

  it('a second save for the same draft UPDATES (one row per draft)', async () => {
    await saveCreatorCompositionBrief({ companyId: 'co-A', userId: 'u', compositionId: 'd1', brief: BRIEF });
    await saveCreatorCompositionBrief({ companyId: 'co-A', userId: 'u', compositionId: 'd1', brief: { ...BRIEF, mainMessage: 'Changed' } });
    expect(rows).toHaveLength(1);
    expect((await getCreatorCompositionBrief('co-A', 'd1'))!.mainMessage).toBe('Changed');
  });

  it('CRITICAL tenant isolation: the same draft id in another company resolves to nothing', async () => {
    await saveCreatorCompositionBrief({ companyId: 'co-A', userId: 'u', compositionId: 'shared-id', brief: BRIEF });
    expect(await getCreatorCompositionBrief('co-B', 'shared-id')).toBeNull();
    // …and company B writing that id creates ITS OWN row, never overwriting A's.
    await saveCreatorCompositionBrief({ companyId: 'co-B', userId: 'u', compositionId: 'shared-id', brief: { ...BRIEF, mainMessage: 'B message' } });
    expect((await getCreatorCompositionBrief('co-A', 'shared-id'))!.mainMessage).toBe(BRIEF.mainMessage);
    expect((await getCreatorCompositionBrief('co-B', 'shared-id'))!.mainMessage).toBe('B message');
  });

  it('rejects an invalid draft id or a contentless brief; degrades when the store is missing', async () => {
    expect(isValidCompositionId('creator_image_1_ab-c.d:e')).toBe(true);
    expect(isValidCompositionId('../etc')).toBe(false);
    expect(isValidCompositionId('a b')).toBe(false);
    expect((await saveCreatorCompositionBrief({ companyId: 'co-A', userId: 'u', compositionId: 'x y', brief: BRIEF })).ok).toBe(false);
    expect(await saveCreatorCompositionBrief({ companyId: 'co-A', userId: 'u', compositionId: 'd', brief: { audience: 'only' } }))
      .toEqual({ ok: false, reason: 'invalid' });
    failWrites = true;
    expect(await saveCreatorCompositionBrief({ companyId: 'co-A', userId: 'u', compositionId: 'd', brief: BRIEF }))
      .toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('API route', () => {
  it('PUT then GET round-trips for a member of the company', async () => {
    access.allow = new Set(['co-A']);
    const put = mockReqRes('PUT', {}, { company_id: 'co-A', composition_id: 'draft-1', brief: BRIEF });
    await handler(put.req as never, put.res as never);
    expect(put.out.status).toBe(200);
    const get = mockReqRes('GET', { company_id: 'co-A', composition_id: 'draft-1' });
    await handler(get.req as never, get.res as never);
    expect(get.out.status).toBe(200);
    expect((get.out.json as { brief: unknown }).brief).toEqual(BRIEF);
  });

  it('CRITICAL: a non-member is rejected before any read or write', async () => {
    access.allow = new Set(['co-A']);
    await saveCreatorCompositionBrief({ companyId: 'co-A', userId: 'u', compositionId: 'draft-1', brief: BRIEF });
    const get = mockReqRes('GET', { company_id: 'co-B', composition_id: 'draft-1' });
    await handler(get.req as never, get.res as never);
    expect(get.out.status).toBe(403);
    const put = mockReqRes('PUT', {}, { company_id: 'co-B', composition_id: 'draft-1', brief: { ...BRIEF, mainMessage: 'hijack' } });
    await handler(put.req as never, put.res as never);
    expect(put.out.status).toBe(403);
    expect((await getCreatorCompositionBrief('co-A', 'draft-1'))!.mainMessage).toBe(BRIEF.mainMessage);
  });

  it('a member of company B reading A\'s draft id gets null (filter, not just the gate)', async () => {
    access.allow = new Set(['co-A', 'co-B']);
    await saveCreatorCompositionBrief({ companyId: 'co-A', userId: 'u', compositionId: 'draft-1', brief: BRIEF });
    const get = mockReqRes('GET', { company_id: 'co-B', composition_id: 'draft-1' });
    await handler(get.req as never, get.res as never);
    expect(get.out.status).toBe(200);
    expect((get.out.json as { brief: unknown }).brief).toBeNull();
  });

  it('validates input and method', async () => {
    access.allow = new Set(['co-A']);
    const noCo = mockReqRes('GET', { composition_id: 'd' });
    await handler(noCo.req as never, noCo.res as never);
    expect(noCo.out.status).toBe(400);
    const badId = mockReqRes('GET', { company_id: 'co-A', composition_id: '../x' });
    await handler(badId.req as never, badId.res as never);
    expect(badId.out.status).toBe(400);
    const empty = mockReqRes('PUT', {}, { company_id: 'co-A', composition_id: 'd', brief: {} });
    await handler(empty.req as never, empty.res as never);
    expect(empty.out.status).toBe(400);
    const del = mockReqRes('DELETE', { company_id: 'co-A', composition_id: 'd' });
    await handler(del.req as never, del.res as never);
    expect(del.out.status).toBe(405);
  });

  it('the migration is additive, tenant-keyed and RLS-protected', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations/20261222000000_creator_composition_briefs.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.creator_composition_briefs/);
    expect(sql).toMatch(/UNIQUE \(company_id, composition_type, composition_id\)/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/\bDROP\b|\bALTER TABLE public\.(?!creator_composition_briefs)/);
  });
});

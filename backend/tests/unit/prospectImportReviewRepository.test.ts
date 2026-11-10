/**
 * R3 review list: hold (idempotent), lazy expiry (best-effort), and decide
 * (import / skip) with the writer-side membership check that stands in for the
 * absent `decided_by` foreign key (GOV-H, PI review finding 1).
 */

type Res = { data?: unknown; error?: unknown; status?: number };
const log: string[] = [];
let script: Record<string, Res[]> = {};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    // The FIRST verb decides the result (update(...).select('id') is an update).
    let op: string | null = null;
    const chain: Record<string, unknown> = {};
    const record = (m: string, a: unknown[]) => { log.push(`${table}.${m}(${JSON.stringify(a)})`); };
    for (const m of ['eq', 'gt', 'lt', 'order', 'contains', 'ilike']) {
      chain[m] = (...a: unknown[]) => { record(m, a); return chain; };
    }
    for (const m of ['select', 'update', 'delete', 'upsert', 'insert']) {
      chain[m] = (...a: unknown[]) => { op = op ?? m; record(m, a); return chain; };
    }
    const resolve = (): Res => (script[`${table}.${op ?? 'select'}`] ?? []).shift() ?? { data: [], error: null, status: 200 };
    chain.limit = (...a: unknown[]) => { record('limit', a); return Promise.resolve(resolve()); };
    chain.then = (ok: (r: Res) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(ok, ko);
    return chain;
  },
}));

import {
  decideReviewItems,
  holdForReview,
  listReviewItems,
  ReviewDecisionRefused,
} from '../../services/prospectImportReview/repository';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const USER = '00000000-0000-4000-8000-0000000000u1';
const NOW = '2026-11-10T12:00:00.000Z';
const member: Res = { data: [{ company_id: ORG }], error: null, status: 200 };

beforeEach(() => { log.length = 0; script = {}; });

describe('hold', () => {
  it('one row per matched person, upserted with ignoreDuplicates (re-runs add nothing, skipped stays skipped)', async () => {
    await holdForReview(ORG, 'apollo', [
      { providerRecordId: 'ap-1', reason: 'name_match', matchedPersonIds: ['p1', 'p2'], raw: { id: 'ap-1' } },
    ], NOW);
    const up = log.find((l) => l.startsWith('prospect_import_review_items.upsert'))!;
    expect(up).toContain('"matched_person_id":"p1"');
    expect(up).toContain('"matched_person_id":"p2"');
    expect(up).toContain('"onConflict":"organization_id,source,provider_record_id,matched_person_id"');
    expect(up).toContain('"ignoreDuplicates":true');
    // Lazy expiry ran first, tenant-scoped.
    expect(log.indexOf(`prospect_import_review_items.delete([])`)).toBeLessThan(log.indexOf(up));
  });

  it('expiry is best-effort: a failing DELETE does not fail the hold', async () => {
    script['prospect_import_review_items.delete'] = [{ error: { message: 'boom' } }];
    await expect(holdForReview(ORG, 'apollo', [
      { providerRecordId: 'ap-1', reason: 'name_match', matchedPersonIds: ['p1'], raw: {} },
    ], NOW)).resolves.toEqual({ held: 1 });
  });
});

describe('list', () => {
  it('groups by provider record and reports queue size and age', async () => {
    script['prospect_import_review_items.select'] = [{ status: 200, error: null, data: [
      { source: 'apollo', provider_record_id: 'ap-1', matched_person_id: 'p1', reason: 'name_match', raw_record: { name: 'Jane Doe' }, created_at: '2026-11-01', expires_at: '2026-12-01' },
      { source: 'apollo', provider_record_id: 'ap-1', matched_person_id: 'p2', reason: 'name_match', raw_record: { name: 'Jane Doe' }, created_at: '2026-11-01', expires_at: '2026-12-01' },
      { source: 'apollo', provider_record_id: 'ap-2', matched_person_id: 'p3', reason: 'role_contact', raw_record: {}, created_at: '2026-11-02', expires_at: '2026-12-02' },
    ] }];
    const out = await listReviewItems(ORG, NOW);
    expect(out.items.map((i) => [i.providerRecordId, i.matchedPersonIds])).toEqual([['ap-1', ['p1', 'p2']], ['ap-2', ['p3']]]);
    expect(out.pendingRows).toBe(3);
    expect(out.oldestCreatedAt).toBe('2026-11-01');
    expect(log.some((l) => l === `prospect_import_review_items.gt(["expires_at","${NOW}"])`)).toBe(true);
  });
});

describe('decide: writer validation for decided_by', () => {
  it('a non-member is refused before any write', async () => {
    script['user_company_roles.select'] = [{ data: [], error: null, status: 200 }];
    await expect(decideReviewItems({ organizationId: ORG, userId: USER, source: 'apollo', providerRecordIds: ['ap-1'], decision: 'skip', now: NOW }))
      .rejects.toMatchObject({ code: 'not_a_member' });
    expect(log.some((l) => /\.(update|delete|upsert|insert)\(/.test(l))).toBe(false);
  });

  it('an UNREADABLE membership (204 / null error) is refused, never treated as "member"', async () => {
    script['user_company_roles.select'] = [{ data: null, error: null, status: 204 }];
    await expect(decideReviewItems({ organizationId: ORG, userId: USER, source: 'apollo', providerRecordIds: ['ap-1'], decision: 'import', now: NOW }))
      .rejects.toBeInstanceOf(ReviewDecisionRefused);
  });

  it.each([
    [{ providerRecordIds: [] }], [{ userId: '' }], [{ organizationId: ' ' }], [{ decision: 'merge' }],
    [{ providerRecordIds: Array.from({ length: 101 }, (_, i) => `r${i}`) }],
  ])('invalid input is refused: %j', async (over) => {
    await expect(decideReviewItems({ organizationId: ORG, userId: USER, source: 'apollo', providerRecordIds: ['ap-1'], decision: 'skip', now: NOW, ...(over as object) } as never))
      .rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('decide: skip and import', () => {
  it('SKIP clears the held record and attributes the decision', async () => {
    script['user_company_roles.select'] = [member];
    script['prospect_import_review_items.select'] = [{ data: [{ id: 'r1', raw_record: { id: 'ap-1' } }], error: null, status: 200 }];
    script['prospect_import_review_items.update'] = [{ data: [{ id: 'r1' }], error: null, status: 200 }];
    const out = await decideReviewItems({ organizationId: ORG, userId: USER, source: 'apollo', providerRecordIds: ['ap-1'], decision: 'skip', now: NOW });
    expect(out).toEqual([{ providerRecordId: 'ap-1', status: 'skipped' }]);
    const upd = log.find((l) => l.startsWith('prospect_import_review_items.update'))!;
    expect(upd).toContain('"status":"skipped"');
    expect(upd).toContain('"raw_record":null');
    expect(upd).toContain(`"decided_by":"${USER}"`);
  });

  it('IMPORT replays the held raw record through ingestLeadBatch, THEN deletes the rows', async () => {
    script['user_company_roles.select'] = [member];
    script['prospect_import_review_items.select'] = [{ data: [{ id: 'r1', raw_record: { id: 'ap-1', name: 'Jane Doe' } }], error: null, status: 200 }];
    const ingest = jest.fn(async () => {
      log.push('INGEST');
      return { organizationId: ORG, source: 'apollo', total: 1, succeeded: 1, failed: 0, outcomes: [{ externalId: 'ap-1', ok: true }] };
    });
    const out = await decideReviewItems({ organizationId: ORG, userId: USER, source: 'apollo', providerRecordIds: ['ap-1'], decision: 'import', now: NOW, ingest: ingest as never });
    expect(out).toEqual([{ providerRecordId: 'ap-1', status: 'imported' }]);
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG, source: 'apollo', records: [{ id: 'ap-1', name: 'Jane Doe' }] }));
    const ingestAt = log.indexOf('INGEST');
    const deleteAfter = log.findIndex((l, i) => i > ingestAt && l.startsWith('prospect_import_review_items.delete'));
    expect(deleteAfter).toBeGreaterThan(ingestAt);
  });

  it('a failed import leaves the item PENDING (no delete) and says why', async () => {
    script['user_company_roles.select'] = [member];
    script['prospect_import_review_items.select'] = [{ data: [{ id: 'r1', raw_record: { id: 'ap-1' } }], error: null, status: 200 }];
    const ingest = jest.fn(async () => ({ organizationId: ORG, source: 'apollo', total: 1, succeeded: 0, failed: 1,
      outcomes: [{ externalId: 'ap-1', ok: false, rejection: 'identity_failed' }] }));
    const deletesBefore = log.filter((l) => l.startsWith('prospect_import_review_items.delete')).length;
    const out = await decideReviewItems({ organizationId: ORG, userId: USER, source: 'apollo', providerRecordIds: ['ap-1'], decision: 'import', now: NOW, ingest: ingest as never });
    expect(out).toEqual([{ providerRecordId: 'ap-1', status: 'import_failed', reason: 'identity_failed' }]);
    // Only the lazy-expiry delete ran; no item delete followed the failed ingest.
    expect(log.filter((l) => l.startsWith('prospect_import_review_items.delete')).length).toBe(deletesBefore + 1);
  });

  it('a concurrent second SKIP that changes no row reports not_pending, not a false success', async () => {
    script['user_company_roles.select'] = [member];
    script['prospect_import_review_items.select'] = [{ data: [{ id: 'r1', raw_record: { id: 'ap-1' } }], error: null, status: 200 }];
    script['prospect_import_review_items.update'] = [{ data: [], error: null, status: 200 }];
    const out = await decideReviewItems({ organizationId: ORG, userId: USER, source: 'apollo', providerRecordIds: ['ap-1'], decision: 'skip', now: NOW });
    expect(out).toEqual([{ providerRecordId: 'ap-1', status: 'not_pending' }]);
  });

  it('a failed SKIP write reports skip_failed, never an import failure', async () => {
    script['user_company_roles.select'] = [member];
    script['prospect_import_review_items.select'] = [{ data: [{ id: 'r1', raw_record: { id: 'ap-1' } }], error: null, status: 200 }];
    script['prospect_import_review_items.update'] = [{ data: null, error: { message: 'x' }, status: 500 }];
    const out = await decideReviewItems({ organizationId: ORG, userId: USER, source: 'apollo', providerRecordIds: ['ap-1'], decision: 'skip', now: NOW });
    expect(out).toEqual([{ providerRecordId: 'ap-1', status: 'skip_failed', reason: 'skip_write_failed' }]);
  });

  it('a record that is no longer pending (decided, expired, or never held) is reported, not invented', async () => {
    script['user_company_roles.select'] = [member];
    script['prospect_import_review_items.select'] = [{ data: [], error: null, status: 200 }];
    const out = await decideReviewItems({ organizationId: ORG, userId: USER, source: 'apollo', providerRecordIds: ['ap-9'], decision: 'import', now: NOW });
    expect(out).toEqual([{ providerRecordId: 'ap-9', status: 'not_pending' }]);
  });
});

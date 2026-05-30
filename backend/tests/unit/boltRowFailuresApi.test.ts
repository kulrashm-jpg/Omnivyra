/**
 * /api/super-admin/bolt-failures/[failureId]/rows + rows-summary tests.
 *
 * Covers:
 *   - 401/403 when capability check fails
 *   - 405 on non-GET
 *   - 400 on missing failureId
 *   - 200 + migration_required envelope when the table is missing
 *   - 200 + items envelope when the table exists
 *   - filter & pagination query params reach the service
 */

let __authOk = true;
jest.mock('../../security/requireCapability', () => ({
  requireCapability: async (_req: any, res: any) => {
    if (__authOk) return { ok: true, principal: { userId: 'super-admin-1' } };
    res.status(403).json({ error: 'forbidden' });
    return { ok: false };
  },
}));

const listFailuresMock = jest.fn();
const summaryMock = jest.fn();
jest.mock('../../services/boltRowFailureDashboard', () => ({
  listRowFailuresForFailure: (...args: unknown[]) => listFailuresMock(...args),
  getRowFailureSummary: (...args: unknown[]) => summaryMock(...args),
}));

import rowsHandler from '../../../pages/api/super-admin/bolt-failures/[failureId]/rows';
import summaryHandler from '../../../pages/api/super-admin/bolt-failures/[failureId]/rows-summary';

function makeReqRes(method: string, query: Record<string, string> = {}) {
  const json = jest.fn();
  const status = jest.fn(() => ({ json, end: jest.fn() }));
  const res: any = { status, json, end: jest.fn() };
  const req: any = { method, query, headers: {} };
  return { req, res, status, json };
}

beforeEach(() => {
  __authOk = true;
  listFailuresMock.mockReset();
  summaryMock.mockReset();
});

describe('/api/super-admin/bolt-failures/[failureId]/rows — auth', () => {
  test('403 when capability check fails', async () => {
    __authOk = false;
    const { req, res, status } = makeReqRes('GET', { failureId: 'f1' });
    await rowsHandler(req, res);
    expect(status).toHaveBeenCalledWith(403);
    expect(listFailuresMock).not.toHaveBeenCalled();
  });

  test('405 on POST', async () => {
    const { req, res, status } = makeReqRes('POST', { failureId: 'f1' });
    await rowsHandler(req, res);
    expect(status).toHaveBeenCalledWith(405);
  });

  test('400 when failureId missing', async () => {
    const { req, res, status } = makeReqRes('GET', {});
    await rowsHandler(req, res);
    expect(status).toHaveBeenCalledWith(400);
  });
});

describe('/api/super-admin/bolt-failures/[failureId]/rows — happy path', () => {
  test('200 + items envelope', async () => {
    listFailuresMock.mockResolvedValueOnce({
      items: [{ id: 'r1' }, { id: 'r2' }],
      total: 5,
      limit: 25,
      offset: 0,
      has_more: true,
    });
    const { req, res, status, json } = makeReqRes('GET', { failureId: 'f1' });
    await rowsHandler(req, res);
    expect(status).toHaveBeenCalledWith(200);
    const payload = json.mock.calls[json.mock.calls.length - 1][0];
    expect(payload.items).toHaveLength(2);
    expect(payload.total).toBe(5);
    expect(payload.has_more).toBe(true);
  });

  test('passes pagination + filters to service', async () => {
    listFailuresMock.mockResolvedValueOnce({ items: [], total: 0, limit: 10, offset: 30, has_more: false });
    const { req, res } = makeReqRes('GET', {
      failureId: 'f1',
      limit: '10',
      offset: '30',
      sort: 'failure_code',
      order: 'asc',
      failure_code: 'DAILY_PLAN_INVALID_PLATFORM',
      platform: 'linkedin',
      content_type: 'post',
      search: 'missing',
    });
    await rowsHandler(req, res);
    expect(listFailuresMock).toHaveBeenCalledWith('f1', expect.objectContaining({
      limit: 10,
      offset: 30,
      sort: 'failure_code',
      order: 'asc',
      failureCode: 'DAILY_PLAN_INVALID_PLATFORM',
      platform: 'linkedin',
      contentType: 'post',
      search: 'missing',
    }));
  });

  test('falls back to default sort when sort is not in allow-list', async () => {
    listFailuresMock.mockResolvedValueOnce({ items: [], total: 0, limit: 50, offset: 0, has_more: false });
    const { req, res } = makeReqRes('GET', { failureId: 'f1', sort: 'created_at' });
    await rowsHandler(req, res);
    const call = listFailuresMock.mock.calls[0][1];
    expect(call.sort).toBeUndefined();
  });
});

describe('/api/super-admin/bolt-failures/[failureId]/rows — migration safety', () => {
  test('200 + migration_required envelope when table is missing', async () => {
    listFailuresMock.mockResolvedValueOnce({ migration_required: true });
    const { req, res, status, json } = makeReqRes('GET', { failureId: 'f1' });
    await rowsHandler(req, res);
    expect(status).toHaveBeenCalledWith(200);
    const payload = json.mock.calls[json.mock.calls.length - 1][0];
    expect(payload.migration_required).toBe(true);
    expect(payload.items).toEqual([]);
    expect(payload.total).toBe(0);
    expect(typeof payload.notice).toBe('string');
  });
});

describe('/api/super-admin/bolt-failures/[failureId]/rows-summary', () => {
  test('403 when capability check fails', async () => {
    __authOk = false;
    const { req, res, status } = makeReqRes('GET', { failureId: 'f1' });
    await summaryHandler(req, res);
    expect(status).toHaveBeenCalledWith(403);
  });

  test('200 + summary payload', async () => {
    summaryMock.mockResolvedValueOnce({
      rows_failed: 7,
      by_code: [{ key: 'DAILY_PLAN_INVALID_PLATFORM', count: 5 }],
      by_platform: [],
      by_content_type: [],
      by_week: [],
      by_stage: [],
    });
    const { req, res, status, json } = makeReqRes('GET', { failureId: 'f1' });
    await summaryHandler(req, res);
    expect(status).toHaveBeenCalledWith(200);
    const payload = json.mock.calls[json.mock.calls.length - 1][0];
    expect(payload.rows_failed).toBe(7);
    expect(payload.by_code[0].count).toBe(5);
  });

  test('200 + migration_required envelope when table missing', async () => {
    summaryMock.mockResolvedValueOnce({ migration_required: true });
    const { req, res, status, json } = makeReqRes('GET', { failureId: 'f1' });
    await summaryHandler(req, res);
    expect(status).toHaveBeenCalledWith(200);
    const payload = json.mock.calls[json.mock.calls.length - 1][0];
    expect(payload.migration_required).toBe(true);
    expect(payload.rows_failed).toBe(0);
  });
});

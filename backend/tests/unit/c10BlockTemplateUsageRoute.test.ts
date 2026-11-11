/**
 * C10: POST /api/block-templates/[id] records ONE use. Company access is
 * enforced first; every service failure is a non-2xx with a code - never a
 * silent 200.
 */
const enforceCompanyAccess = jest.fn(async () => ({ userId: 'u1' }));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: (...a: unknown[]) => (enforceCompanyAccess as unknown as (...x: unknown[]) => unknown)(...a) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

const recordBlockTemplateUse = jest.fn();
jest.mock('../../services/blockTemplateService', () => {
  class BlockTemplateUsageError extends Error { constructor(m: string, readonly kind: string) { super(m); } }
  return {
    getBlockTemplate: jest.fn(), updateBlockTemplate: jest.fn(), deleteBlockTemplate: jest.fn(),
    recordBlockTemplateUse: (...a: unknown[]) => recordBlockTemplateUse(...a),
    BlockTemplateUsageError,
  };
});

import handler from '../../../pages/api/block-templates/[id]';
import { BlockTemplateUsageError } from '../../services/blockTemplateService';

const CO = '00000000-0000-4000-8000-0000000000aa';
const TPL = '00000000-0000-4000-8000-0000000000c1';
const call = async () => {
  const res: { code: number; body: Record<string, unknown> } = { code: 0, body: {} };
  const r = { status: (c: number) => { res.code = c; return r; }, json: (b: Record<string, unknown>) => { res.body = b; return r; } };
  await (handler as unknown as (q: unknown, s: unknown) => Promise<void>)({ method: 'POST', query: { id: TPL, company_id: CO }, body: {} }, r);
  return res;
};

beforeEach(() => { recordBlockTemplateUse.mockReset(); enforceCompanyAccess.mockClear(); });

it('records one use for the authorised company and returns the new count', async () => {
  recordBlockTemplateUse.mockResolvedValue(5);
  const res = await call();
  expect(enforceCompanyAccess).toHaveBeenCalledTimes(1);
  expect(recordBlockTemplateUse).toHaveBeenCalledTimes(1);
  expect(recordBlockTemplateUse).toHaveBeenCalledWith(TPL, CO);
  expect(res).toEqual({ code: 200, body: { usage_count: 5 } });
});

it.each([
  ['invalid_argument', 400], ['not_found', 404], ['conflict', 409], ['read_failed', 503], ['write_failed', 503],
])('a %s failure is %i, never a silent 200', async (kind, code) => {
  recordBlockTemplateUse.mockRejectedValue(new (BlockTemplateUsageError as unknown as new (m: string, k: string) => Error)('x', kind));
  const res = await call();
  expect(res.code).toBe(code);
  expect(res.body.code).toBe(`USAGE_${kind.toUpperCase()}`);
});

it('no company access = nothing recorded', async () => {
  enforceCompanyAccess.mockResolvedValueOnce(null as never);
  await call();
  expect(recordBlockTemplateUse).not.toHaveBeenCalled();
});

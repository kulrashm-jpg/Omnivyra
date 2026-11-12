/**
 * SECURITY (2026-11-13, 05 review): POST /api/command-center/creator-content/intake-ai and package-ai ran their
 * company access check only `if (companyId)`. A user with no default company who sent no company_id skipped it and
 * reached an unattributed, company-less AI call (runCompletionWithOperation({ companyId: '' })).
 *
 * Now: a company is required (400) and ALWAYS access-checked; the AI gateway is never reached without one.
 */
const mockUser = { current: null as null | Record<string, unknown> };
const mockAi = jest.fn(async () => ({ choices: [{ message: { content: 'ok' } }], output: 'ok', content: 'ok' }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: async () => mockUser.current,
  enforceCompanyAccess: async (i: { companyId?: string; res: any }) => {
    const u = mockUser.current as { companyIds?: string[]; userId?: string } | null;
    if (u?.companyIds?.includes(String(i.companyId))) return { userId: u.userId };
    i.res.status(403).json({ error: 'forbidden' });
    return null;
  },
}));
jest.mock('../../services/aiGateway', () => ({ runCompletionWithOperation: mockAi }));
jest.mock('../../services/context/canonicalContentContextResolver', () => ({ resolveCompanyGroundingGuard: async () => ({ directive: '' }) }));
jest.mock('@/config', () => ({ config: { OPENAI_MODEL: 'test-model' } }), { virtual: true });

/* eslint-disable @typescript-eslint/no-var-requires */
const intake = require('../../../pages/api/command-center/creator-content/intake-ai').default;
const pkg = require('../../../pages/api/command-center/creator-content/package-ai').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const noDefault = { userId: 'user-x', role: 'user', companyIds: [A], defaultCompanyId: '', authenticated: true };
const userA = { userId: 'user-a', role: 'user', companyIds: [A], defaultCompanyId: A, authenticated: true };

async function post(handler: any, body: Record<string, unknown>) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  await handler({ method: 'POST', headers: {}, query: {}, body }, res);
  return res;
}

beforeEach(() => {
  mockAi.mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe.each([
  ['intake-ai', intake, { brief: { description: 'a brief' } }],
  ['package-ai', pkg, { op: 'generate_summary', text: 'some text' }],
] as const)('%s', (_n, handler, payload) => {
  it('a user with NO default company sending no company_id -> 400, the AI gateway is never reached', async () => {
    mockUser.current = noDefault;
    const res = await post(handler, { ...payload });
    expect(res.statusCode).toBe(400);
    expect(mockAi).not.toHaveBeenCalled();
  });

  it('naming another company -> refused, the AI gateway is never reached', async () => {
    mockUser.current = userA;
    const res = await post(handler, { ...payload, company_id: B });
    expect(res.statusCode).toBe(403);
    expect(mockAi).not.toHaveBeenCalled();
  });

  it('CONTROL: the default company (and an explicit own company) reach the gateway attributed to that company', async () => {
    mockUser.current = userA;
    await post(handler, { ...payload });
    await post(handler, { ...payload, company_id: A });
    expect(mockAi).toHaveBeenCalledTimes(2);
    expect((mockAi.mock.calls as unknown as Array<[{ companyId: string }]>).every(([c]) => c.companyId === A)).toBe(true);
  });
});

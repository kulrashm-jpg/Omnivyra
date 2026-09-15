/**
 * SEC-91 W2-A (STEP 3AH-91, wave 2) — W2A-5 (low-risk part): POST /api/content
 * attributes the canonical content row to the AUTHENTICATED caller.
 *
 * The route forwarded the whole request body (minus company/campaign keys)
 * into createContent(), so `createdBy` / `created_by` came from the client: any
 * member could create content — and its first revision — attributed to another
 * user (e.g. a company admin). `created_by` is now always the authorized
 * principal; a client value is ignored. (lifecycleStatus from the body is a
 * separate, documented product decision — see docs/security/SEC91_W2A.md.)
 */
import { seed, invoke, CO_A, CO_B, USER_A, USER_B } from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

const mockCreateContent = jest.fn(async (input: Record<string, unknown>) => ({ id: 'content-1', ...input }));
jest.mock('../../services/content/contentService', () => ({
  createContent: (input: Record<string, unknown>) => mockCreateContent(input),
  listContent: jest.fn(async () => []),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const contentIndex = require('../../../pages/api/content/index').default;
/* eslint-enable @typescript-eslint/no-var-requires */

beforeEach(() => {
  seed();
  mockCreateContent.mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('POST /api/content — created_by is the caller', () => {
  it('a body createdBy naming ANOTHER user is ignored; the row is attributed to the caller', async () => {
    const r = await invoke(contentIndex, {
      method: 'POST',
      query: { companyId: CO_A },
      body: { contentType: 'post', title: 't', body: 'b', createdBy: USER_B },
      as: 'A',
    });
    expect(r.status).toBe(201);
    expect(mockCreateContent).toHaveBeenCalledTimes(1);
    expect(mockCreateContent.mock.calls[0][0]).toMatchObject({ companyId: CO_A, createdBy: USER_A });
  });

  it('the snake_case spelling (created_by) is not forwarded either', async () => {
    await invoke(contentIndex, {
      method: 'POST',
      query: { companyId: CO_A },
      body: { contentType: 'post', title: 't', created_by: USER_B },
      as: 'A',
    });
    const input = mockCreateContent.mock.calls[0][0];
    expect(input.createdBy).toBe(USER_A);
    expect(input).not.toHaveProperty('created_by');
  });

  it('no createdBy in the body → still the caller', async () => {
    await invoke(contentIndex, { method: 'POST', query: { companyId: CO_A }, body: { contentType: 'post' }, as: 'A' });
    expect(mockCreateContent.mock.calls[0][0].createdBy).toBe(USER_A);
  });

  it('tenant guard unchanged: another company → 403, nothing created', async () => {
    const r = await invoke(contentIndex, { method: 'POST', query: { companyId: CO_B }, body: { contentType: 'post' }, as: 'A' });
    expect(r.status).toBe(403);
    expect(mockCreateContent).not.toHaveBeenCalled();
  });
});

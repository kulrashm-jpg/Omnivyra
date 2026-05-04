import type { NextApiHandler } from 'next';
import { applyAuthGuard } from '../../backend/middleware/applyAuthGuard';
import { buildAuthContext } from '../../backend/auth/authContext';
import { runWithServiceRole, supabase } from '../../backend/db/supabaseClient';
import { mockAuthContext, mockRequest, mockResponse } from './helpers';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ from: jest.fn(), marker: 'service-client' })),
}));

jest.mock('../../backend/auth/authContext', () => {
  const actual = jest.requireActual('../../backend/auth/authContext');
  return {
    ...actual,
    buildAuthContext: jest.fn(),
  };
});

const mockedBuildAuthContext = buildAuthContext as jest.MockedFunction<typeof buildAuthContext>;
const okHandler: NextApiHandler = (_req, res) => res.status(200).json({ ok: true });

describe('service-role protection', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env['SUPABASE_' + 'SERVICE_' + 'ROLE_KEY'] = 'service-role-key';
    mockedBuildAuthContext.mockReset();
  });

  it('throws on direct legacy service-role usage', () => {
    expect(() => (supabase as any).from('users')).toThrow('Direct supabase usage is prohibited');
  });

  it('throws when runWithServiceRole has no reason', async () => {
    await expect(runWithServiceRole('', async () => true)).rejects.toThrow(
      'Service role usage requires explicit reason',
    );
  });

  it('allows runWithServiceRole with explicit reason', async () => {
    await expect(runWithServiceRole('unit test service role path', async () => 'ok')).resolves.toBe('ok');
  });

  it('does not let service-role bypass org guard', async () => {
    mockedBuildAuthContext.mockResolvedValueOnce(mockAuthContext({
      activeOrgId: 'org-2',
      memberships: [],
      roles: [],
      isSuperAdmin: false,
    }));

    const req = mockRequest({ authorization: 'Bearer valid', 'x-org-id': 'org-1' });
    const res = mockResponse();
    await applyAuthGuard({ requiresAuth: true, requiresOrg: true })(okHandler)(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

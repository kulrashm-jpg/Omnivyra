import companyProfileHandler from '../../../pages/api/company-profile';
import refineHandler from '../../../pages/api/company-profile/refine';
import {
  getLatestProfile,
  getProfile,
  saveProfile,
  refineProfileWithAIWithDetails,
} from '../../services/companyProfileService';
import { createApiRequestMock, createMockRes } from '../utils';

jest.mock('../../services/companyProfileService', () => ({
  getLatestProfile: jest.fn(),
  getProfile: jest.fn(),
  saveProfile: jest.fn(),
  refineProfileWithAI: jest.fn(),
  refineProfileWithAIWithDetails: jest.fn(),
}));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn().mockResolvedValue({ user: { id: 'user-1' }, error: null }),
}));
jest.mock('../../services/rbacService', () => ({
  ...jest.requireActual('../../services/rbacService'),
  isSuperAdmin: jest.fn().mockResolvedValue(true),
  getUserRole: jest.fn().mockResolvedValue({ role: 'SUPER_ADMIN', error: null }),
}));

describe('Company profile API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates or updates profile', async () => {
    (saveProfile as jest.Mock).mockResolvedValue({
      company_id: 'acme',
      name: 'Acme',
    });
    const req = createApiRequestMock({
      method: 'POST',
      companyId: 'acme',
      body: { name: 'Acme' },
    });
    const res = createMockRes();
    await companyProfileHandler(req, res);
    expect(saveProfile).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body?.profile?.name).toBe('Acme');
  });

  it('fetches profile', async () => {
    (getProfile as jest.Mock).mockResolvedValue({
      company_id: 'latest',
      name: 'Acme',
    });
    const req = createApiRequestMock({
      method: 'GET',
      companyId: 'latest',
    });
    const res = createMockRes();
    await companyProfileHandler(req, res);
    expect(getProfile).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body?.profile?.name).toBe('Acme');
  });

  it('refines profile', async () => {
    (getProfile as jest.Mock).mockResolvedValue(null);
    (saveProfile as jest.Mock).mockResolvedValue({
      company_id: 'acme',
      name: 'Acme',
    });
    (refineProfileWithAIWithDetails as jest.Mock).mockResolvedValue({
      profile: {
        company_id: 'acme',
        name: 'Acme Refined',
        source: 'ai_refined',
      },
      details: {
        company_id: 'acme',
        before_profile: { company_id: 'acme', name: 'Acme' },
        after_profile: { company_id: 'acme', name: 'Acme Refined' },
        source_urls: [],
        source_summaries: [],
        changed_fields: [{ field: 'name', before: 'Acme', after: 'Acme Refined' }],
        created_at: new Date().toISOString(),
      },
    });
    const req = createApiRequestMock({
      method: 'POST',
      companyId: 'acme',
      body: { companyId: 'acme' },
    });
    const res = createMockRes();
    await refineHandler(req, res);
    expect(refineProfileWithAIWithDetails).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body?.profile?.name).toBe('Acme Refined');
  });
});

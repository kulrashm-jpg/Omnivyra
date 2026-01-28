import companyProfileHandler from '../../../pages/api/company-profile';
import refineHandler from '../../../pages/api/company-profile/refine';
import {
  getLatestProfile,
  getProfile,
  saveProfile,
  refineProfileWithAI,
  refineProfileWithAIWithDetails,
} from '../../services/companyProfileService';
import type { NextApiRequest, NextApiResponse } from 'next';

jest.mock('../../services/companyProfileService', () => ({
  getLatestProfile: jest.fn(),
  getProfile: jest.fn(),
  saveProfile: jest.fn(),
  refineProfileWithAI: jest.fn(),
  refineProfileWithAIWithDetails: jest.fn(),
}));

const createMockRes = () => {
  const res: Partial<NextApiResponse> & { json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return res as NextApiResponse;
};

describe('Company profile API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates or updates profile', async () => {
    (saveProfile as jest.Mock).mockResolvedValue({
      company_id: 'acme',
      name: 'Acme',
    });

    const req = {
      method: 'POST',
      query: {},
      body: { name: 'Acme' },
    } as unknown as NextApiRequest;

    const res = createMockRes();
    await companyProfileHandler(req, res);

    expect(saveProfile).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.profile.name).toBe('Acme');
  });

  it('fetches profile', async () => {
    (getLatestProfile as jest.Mock).mockResolvedValue({
      company_id: 'latest',
      name: 'Acme',
    });

    const req = {
      method: 'GET',
      query: {},
    } as unknown as NextApiRequest;

    const res = createMockRes();
    await companyProfileHandler(req, res);

    expect(getLatestProfile).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.profile.name).toBe('Acme');
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

    const req = {
      method: 'POST',
      query: {},
      body: {},
    } as unknown as NextApiRequest;

    const res = createMockRes();
    await refineHandler(req, res);

    expect(refineProfileWithAIWithDetails).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.profile.name).toBe('Acme Refined');
  });
});

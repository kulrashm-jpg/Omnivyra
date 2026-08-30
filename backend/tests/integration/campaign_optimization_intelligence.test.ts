/**
 * Integration tests for Campaign Optimization Intelligence.
 * Read-only and advisory only.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../../services/decisionComposerService', () => ({
  composeDecisionIntelligence: jest.fn(),
  composeCampaignOptimizationView: jest.fn(),
}));

jest.mock('../../services/intelligenceExecutionContext', () => ({
  runInApiReadContext: jest.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
}));

jest.mock('../../middleware/withRBAC', () => ({ withRBAC: (h: any) => h }));
/*
 * WITHRBAC-SEC-001 — these routes now bind the campaign's server-owned company
 * to the caller via requireCampaignTenantAccess before reading anything. This
 * suite covers optimization OUTPUT, not the authorization boundary, and it
 * already bypasses withRBAC, so the guard is granted here. The boundary itself
 * (foreign campaign, identifier splits, ordering) is covered against the real
 * primitives in backend/tests/unit/withRbacSec001IdentifierBinding.test.ts.
 */
jest.mock('../../security/TenantGuard', () => ({
  requireCampaignTenantAccess: jest.fn(async () => ({ organizationId: 'test-company' })),
}));


import { supabase } from '../../db/supabaseClient';
import {
  composeCampaignOptimizationView,
  composeDecisionIntelligence,
} from '../../services/decisionComposerService';
import {
  generateCampaignOptimizationInsights,
} from '../../services/CampaignOptimizationIntelligenceService';

import campaignOptimizationHandler from '../../../pages/api/analytics/campaign-optimization';

const campaignId = 'opt-campaign-1';

function mockCampaignLookup(companyId: string | null = 'company-1') {
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'campaigns') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: companyId ? { company_id: companyId } : null,
          error: null,
        }),
      };
    }

    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
  });
}

function setOptimizationInsights(insights: Array<{
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  category: 'PERFORMANCE' | 'GOVERNANCE' | 'EXECUTION' | 'CONTENT_STRATEGY';
  headline: string;
  explanation?: string;
  recommendedAction?: string;
}>) {
  (composeDecisionIntelligence as jest.Mock).mockResolvedValue({ insights: [] });
  (composeCampaignOptimizationView as jest.Mock).mockReturnValue({
    campaignId,
    insights: insights.map((insight) => ({
      explanation: 'Test explanation',
      recommendedAction: 'Test action',
      ...insight,
    })),
    roi: {
      roiScore: 70,
      performanceScore: 70,
      governanceStabilityScore: 80,
      executionReliabilityScore: 85,
      optimizationSignal: 'STABLE',
      recommendation: 'Test action',
    },
  });
}

describe('Campaign Optimization Intelligence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCampaignLookup();
  });

  it('returns HIGH priority PERFORMANCE insights', async () => {
    setOptimizationInsights([
      { priority: 'HIGH', category: 'PERFORMANCE', headline: 'Campaign performance under target' },
    ]);

    const insights = await generateCampaignOptimizationInsights(campaignId);

    expect(insights).toContainEqual(
      expect.objectContaining({
        campaignId,
        priority: 'HIGH',
        category: 'PERFORMANCE',
        headline: 'Campaign performance under target',
      })
    );
  });

  it('returns MEDIUM priority GOVERNANCE insights', async () => {
    setOptimizationInsights([
      { priority: 'MEDIUM', category: 'GOVERNANCE', headline: 'Governance stability risk detected' },
    ]);

    const insights = await generateCampaignOptimizationInsights(campaignId);

    expect(insights).toContainEqual(
      expect.objectContaining({
        category: 'GOVERNANCE',
        priority: 'MEDIUM',
        headline: 'Governance stability risk detected',
      })
    );
  });

  it('returns HIGH priority EXECUTION insights', async () => {
    setOptimizationInsights([
      { priority: 'HIGH', category: 'EXECUTION', headline: 'Execution reliability risk' },
    ]);

    const insights = await generateCampaignOptimizationInsights(campaignId);

    expect(insights).toContainEqual(
      expect.objectContaining({
        category: 'EXECUTION',
        priority: 'HIGH',
        headline: 'Execution reliability risk',
      })
    );
  });

  it('returns MEDIUM priority CONTENT_STRATEGY insights', async () => {
    setOptimizationInsights([
      { priority: 'MEDIUM', category: 'CONTENT_STRATEGY', headline: 'Content overlap reducing differentiation' },
    ]);

    const insights = await generateCampaignOptimizationInsights(campaignId);

    expect(insights).toContainEqual(
      expect.objectContaining({
        category: 'CONTENT_STRATEGY',
        priority: 'MEDIUM',
        headline: 'Content overlap reducing differentiation',
      })
    );
  });

  it('returns fallback LOW insight when no optimization signals exist', async () => {
    setOptimizationInsights([]);

    const insights = await generateCampaignOptimizationInsights(campaignId);

    expect(insights).toHaveLength(1);
    expect(insights[0]).toMatchObject({
      priority: 'LOW',
      headline: 'Campaign operating within expected range',
    });
  });

  it('returns empty array for empty campaignId', async () => {
    const insights = await generateCampaignOptimizationInsights('');
    expect(insights).toEqual([]);
  });

  it('returns fallback LOW insight on composition failure', async () => {
    (composeDecisionIntelligence as jest.Mock).mockRejectedValue(new Error('composition failed'));

    const insights = await generateCampaignOptimizationInsights(campaignId);

    expect(insights).toHaveLength(1);
    expect(insights[0]).toMatchObject({
      priority: 'LOW',
      headline: 'Campaign operating within optimal range',
    });
  });

  it('does not call insert/update/upsert', async () => {
    setOptimizationInsights([
      { priority: 'LOW', category: 'PERFORMANCE', headline: 'Campaign operating within expected range' },
    ]);

    await generateCampaignOptimizationInsights(campaignId);

    const fromCalls = (supabase.from as jest.Mock).mock.results;
    const chain = fromCalls?.[0]?.value;
    expect(chain?.insert).toBeUndefined();
    expect(chain?.update).toBeUndefined();
    expect(chain?.upsert).toBeUndefined();
  });

  it('API returns 400 when campaignId is missing', async () => {
    const req: any = { method: 'GET', headers: {}, query: {} };
    const res: any = {
      statusCode: 200,
      setHeader: jest.fn(),
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json: jest.fn(),
    };

    await campaignOptimizationHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) })
    );
  });

  it('API returns insights when campaignId is provided', async () => {
    setOptimizationInsights([
      { priority: 'HIGH', category: 'PERFORMANCE', headline: 'Campaign performance under target' },
    ]);

    const req: any = { method: 'GET', headers: {}, query: { campaignId } };
    const res: any = {
      statusCode: 200,
      setHeader: jest.fn(),
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json: jest.fn(),
    };

    await campaignOptimizationHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        insights: expect.arrayContaining([
          expect.objectContaining({
            campaignId,
            category: 'PERFORMANCE',
            headline: 'Campaign performance under target',
          }),
        ]),
      })
    );
  });
});

/**
 * C75: the slot scheduler's model call was attributed to NO company (companyId: null), so an enclosing credit handle
 * for the org could never vouch for it (the guard requires ambient.orgId === call orgId) and the call would be blocked
 * once BILLING_REQUIRE_AI_HANDLE=true. It now carries the owning company passed down from generateFromAI.
 */
const generateCampaignPlan = jest.fn(async () => ({ output: '{"schedule":[]}', metadata: {} }));
jest.mock('../../services/aiGateway', () => ({ generateCampaignPlan: (...a: unknown[]) => (generateCampaignPlan as any)(...a) }));

import { scheduleSlotIntelligently } from '../../services/intelligentSlotScheduler';

const ORG = '11111111-1111-4111-8111-111111111111';

describe('intelligentSlotScheduler attribution', () => {
  beforeEach(() => generateCampaignPlan.mockClear());
  it('passes the owning companyId to the gateway call', async () => {
    await scheduleSlotIntelligently([{ platform: 'linkedin', contentType: 'post' } as any], '2026-11-02', 1, { campaignName: 'C', companyId: ORG });
    expect(generateCampaignPlan).toHaveBeenCalledTimes(1);
    expect((generateCampaignPlan.mock.calls[0] as any)[0].companyId).toBe(ORG);
  });
  it('generateFromAI threads the authoritative companyId into both scheduler calls', () => {
    const fs = require('fs');
    const path = require('path');
    const src: string = fs.readFileSync(path.resolve(__dirname, '../../services/executionPlannerService.ts'), 'utf8');
    expect(src).toContain('const companyId = options?.companyId ?? cam?.company_id ?? undefined;');
    expect(src.match(/brandVoice: cam\?\.brand_voice \?\? undefined,\s*companyId,\s*\}\);/g) ?? []).toHaveLength(2);
  });
});

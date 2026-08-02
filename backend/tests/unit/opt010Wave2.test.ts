/**
 * OPT-010 Wave 2 — batched/parallelized user-action write paths.
 *
 * Route-level coverage (established endpoint-test convention):
 *  W2-1 expand-to-week-plans — 1 prefetch + ≤2 batched writes; inserted/updated counts
 *  W2-2 save-comprehensive-plan — ONE bulk upsert; guard-before-data
 *  W2-4 save-week-daily-plan — one .in() select; parallel updateActivity writes
 *  W2-5 weekly-refinement manualEdit — all updates attempted (no fail-fast prefix)
 *  W2-7 bulk-like — 3 prefetches total; tenant skip identical; executeAction SERIAL
 *  W2-8 detect-leads — 2 batched prefetches; grouping; bounded concurrency ≤ 5
 * (W2-3 / W2-6 share the identical bulk patterns and are covered by typecheck/lint.)
 */
import { createApiRequestMock, createMockRes } from '../utils';

const mockTableResponses: Record<string, { data: any; error: any }> = {};
jest.mock('../../db/supabaseClient', () => {
  const { createSupabaseMock } = require('../utils/createSupabaseMock');
  return {
    supabase: createSupabaseMock(
      (table: string) => mockTableResponses[table] || { data: [], error: null }
    ),
  };
});

// W2-1 deps
jest.mock('../../services/campaignAccessService', () => ({ requireCampaignAccess: jest.fn() }));
jest.mock('../../services/campaignBlueprintService', () => ({ getUnifiedCampaignBlueprint: jest.fn() }));
jest.mock('../../services/campaignBlueprintAdapter', () => ({
  blueprintWeeksToLegacyRefinements: jest.fn(),
  fromLegacyRefinements: jest.fn(),
  fromStructuredPlan: jest.fn(),
}));
jest.mock('../../db/campaignVersionStore', () => ({
  syncCampaignVersionStage: jest.fn().mockResolvedValue(undefined),
  getTrendSnapshots: jest.fn(),
}));
// W2-2 / W2-4 deps
jest.mock('../../security/TenantGuard', () => ({ requireCampaignTenantAccess: jest.fn() }));
jest.mock('../../services/executionPlannerService', () => ({ updateActivity: jest.fn() }));
// W2-7 / W2-8 deps
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: jest.fn(),
  enforceCompanyAccess: jest.fn(),
}));
jest.mock('../../services/rbacService', () => ({ enforceRole: jest.fn(), Role: {} }));
jest.mock('../../services/rbac/communityAiCapabilities', () => ({
  COMMUNITY_AI_CAPABILITIES: { EXECUTE_ACTIONS: ['ADMIN'] },
}));
jest.mock('../../services/communityAiActionExecutor', () => ({ executeAction: jest.fn() }));
jest.mock('../../services/playbooks/playbookService', () => ({ listPlaybooks: jest.fn() }));
jest.mock('../../services/responsePerformanceService', () => ({
  incrementReplyLike: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/leadDetectionService', () => ({ processMessageForLeads: jest.fn() }));
// weekly-refinement authenticates the user (no tenant binding) at the dispatcher.
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn().mockResolvedValue({ user: { id: 'u1' }, error: null }),
}));

import expandHandler from '../../../pages/api/campaigns/[id]/expand-to-week-plans';
import saveComprehensiveHandler from '../../../pages/api/campaigns/save-comprehensive-plan';
import saveWeekDailyHandler from '../../../pages/api/campaigns/save-week-daily-plan';
import weeklyRefinementHandler from '../../../pages/api/campaigns/weekly-refinement';
import bulkLikeHandler from '../../../pages/api/engagement/message/bulk-like';
import detectLeadsHandler from '../../../pages/api/engagement/detect-leads';

import { requireCampaignAccess } from '../../services/campaignAccessService';
import { getUnifiedCampaignBlueprint } from '../../services/campaignBlueprintService';
import { blueprintWeeksToLegacyRefinements } from '../../services/campaignBlueprintAdapter';
import { requireCampaignTenantAccess } from '../../security/TenantGuard';
import { updateActivity } from '../../services/executionPlannerService';
import { resolveUserContext, enforceCompanyAccess } from '../../services/userContextService';
import { enforceRole } from '../../services/rbacService';
import { executeAction } from '../../services/communityAiActionExecutor';
import { listPlaybooks } from '../../services/playbooks/playbookService';
import { processMessageForLeads } from '../../services/leadDetectionService';
import { supabase } from '../../db/supabaseClient';

const fromMock = supabase.from as jest.Mock;
const fromCount = (table: string) =>
  fromMock.mock.calls.filter(([t]: [string]) => t === table).length;

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockTableResponses)) delete mockTableResponses[key];
});

// ── W2-1 ────────────────────────────────────────────────────────────────────

describe('W2-1 expand-to-week-plans — batched prefetch + writes', () => {
  test('mixed new/existing weeks: 3 table calls, exact inserted/updated counts', async () => {
    (requireCampaignAccess as jest.Mock).mockResolvedValue({ companyId: 'c1' });
    (getUnifiedCampaignBlueprint as jest.Mock).mockResolvedValue({ weeks: [1, 2, 3] });
    (blueprintWeeksToLegacyRefinements as jest.Mock).mockReturnValue([
      { campaign_id: 'camp-1', week_number: 1, theme: 't1', focus_area: 'f1' },
      { campaign_id: 'camp-1', week_number: 2, theme: 't2', focus_area: 'f2' },
      { campaign_id: 'camp-1', week_number: 3, theme: 't3', focus_area: 'f3' },
    ]);
    mockTableResponses['campaign_week_plan'] = { data: { id: 'cwp-1' }, error: null };
    // Prefetch says week 2 already exists.
    mockTableResponses['weekly_content_refinements'] = {
      data: [{ id: 'r2', week_number: 2 }],
      error: null,
    };

    const res = createMockRes();
    await expandHandler(createApiRequestMock({ method: 'POST', id: 'camp-1' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, inserted: 2, updated: 1, totalWeeks: 3 });
    // prefetch + bulk insert + bulk upsert = exactly 3 (was 1 select + 1 write per week = 6)
    expect(fromCount('weekly_content_refinements')).toBe(3);
  });

  test('guard-before-data: denied access performs zero table reads', async () => {
    (requireCampaignAccess as jest.Mock).mockResolvedValue(null);
    const res = createMockRes();
    await expandHandler(createApiRequestMock({ method: 'POST', id: 'camp-1' }), res);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

// ── W2-2 ────────────────────────────────────────────────────────────────────

describe('W2-2 save-comprehensive-plan — single bulk upsert', () => {
  const body = {
    campaignId: 'camp-1',
    campaignSummary: { objective: 'o', targetAudience: 'a', keyMessages: 'k', successMetrics: 's' },
    weeklyPlans: [
      { weekNumber: 1, theme: 't1', focusArea: 'f1', marketingChannels: [], existingContent: 'seed', contentNotes: 'n1' },
      { weekNumber: 2, theme: 't2', focusArea: 'f2', marketingChannels: [] },
      { weekNumber: 3, theme: 't3', focusArea: 'f3', marketingChannels: [] },
    ],
  };

  test('3 weeks → ONE weekly_content_refinements call; redundant second loop folded', async () => {
    (requireCampaignTenantAccess as jest.Mock).mockResolvedValue({ companyId: 'c1' });
    const res = createMockRes();
    await saveComprehensiveHandler(createApiRequestMock({ method: 'POST', body }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: 'Campaign plan saved successfully' });
    expect(fromCount('weekly_content_refinements')).toBe(1); // was 3 upserts + 1 content update
    expect(fromCount('campaigns')).toBe(1);
  });

  test('guard-before-data: denied tenant performs zero writes', async () => {
    (requireCampaignTenantAccess as jest.Mock).mockResolvedValue(null);
    const res = createMockRes();
    await saveComprehensiveHandler(createApiRequestMock({ method: 'POST', body }), res);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

// ── W2-4 ────────────────────────────────────────────────────────────────────

describe('W2-4 save-week-daily-plan — one .in() select + parallel writes', () => {
  test('one batched select; updateActivity per valid item; invalid/missing skipped', async () => {
    (requireCampaignTenantAccess as jest.Mock).mockResolvedValue({ companyId: 'c1' });
    (updateActivity as jest.Mock).mockResolvedValue({ updated: true });
    mockTableResponses['campaigns'] = { data: { id: 'camp-1', start_date: '2026-01-05' }, error: null };
    mockTableResponses['daily_content_plans'] = {
      data: [
        { id: 'a', content: JSON.stringify({ topic: 'x' }) },
        { id: 'b', content: 'plain-text' },
      ],
      error: null,
    };

    const res = createMockRes();
    await saveWeekDailyHandler(
      createApiRequestMock({
        method: 'POST',
        body: {
          campaignId: 'camp-1',
          weekNumber: 2,
          items: [
            { id: 'a', dayOfWeek: 'Monday' },
            { id: 'b', dayOfWeek: 'Tuesday' },
            { id: 'c', dayOfWeek: 'NotADay' }, // filtered out, exactly as before
            { id: 'ghost', dayOfWeek: 'Friday' }, // not in DB → skipped
          ],
        },
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(fromCount('daily_content_plans')).toBe(1); // was one select per item
    expect(updateActivity).toHaveBeenCalledTimes(2);
    const aCall = (updateActivity as jest.Mock).mock.calls.find(([id]) => id === 'a');
    expect(JSON.parse(aCall[1].content)).toMatchObject({ topic: 'x', day_name: 'Monday', dayIndex: 1, weekNumber: 2 });
    const bCall = (updateActivity as jest.Mock).mock.calls.find(([id]) => id === 'b');
    expect(bCall[1].content).toBe('plain-text'); // non-JSON content passes through untouched
  });
});

// ── W2-5 ────────────────────────────────────────────────────────────────────

describe('W2-5 weekly-refinement manualEdit — parallel updates, no fail-fast prefix', () => {
  test('a failing update no longer stops the batch: ALL updates attempted, still 500', async () => {
    mockTableResponses['content_plans'] = { data: null, error: { message: 'boom' } };
    const res = createMockRes();
    await weeklyRefinementHandler(
      createApiRequestMock({
        method: 'POST',
        query: { action: 'manual-edit' },
        body: {
          campaignId: 'camp-1',
          weekNumber: 1,
          userId: 'u1',
          editedContent: [
            { id: 'p1', content: 'c1' },
            { id: 'p2', content: 'c2' },
            { id: 'p3', content: 'c3' },
          ],
        },
      }),
      res
    );
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to apply manual edits' });
    // Old fail-fast issued 1 update then threw; the parallel batch issues all 3.
    expect(fromCount('content_plans')).toBe(3);
  });

  test('success path: 3 updates + the refinement upsert; response unchanged', async () => {
    const res = createMockRes();
    await weeklyRefinementHandler(
      createApiRequestMock({
        method: 'POST',
        query: { action: 'manual-edit' },
        body: {
          campaignId: 'camp-1',
          weekNumber: 1,
          userId: 'u1',
          editedContent: [{ id: 'p1', content: 'c1' }, { id: 'p2', content: 'c2' }, { id: 'p3', content: 'c3' }],
        },
      }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Weekly content manually edited successfully' });
    expect(fromCount('content_plans')).toBe(3);
    expect(fromCount('weekly_content_refinements')).toBe(1);
  });
});

// ── W2-7 ────────────────────────────────────────────────────────────────────

describe('W2-7 bulk-like — batched prefetch, serial executeAction, tenant skip', () => {
  test('3 prefetch queries total; foreign-org message skipped; actions strictly serial', async () => {
    (resolveUserContext as jest.Mock).mockResolvedValue({ userId: 'u1', defaultCompanyId: 'org-1' });
    (enforceCompanyAccess as jest.Mock).mockResolvedValue({ userId: 'u1' });
    (enforceRole as jest.Mock).mockResolvedValue({ userId: 'u1' });
    (listPlaybooks as jest.Mock).mockResolvedValue([{ id: 'pb-1', status: 'active' }]);

    mockTableResponses['engagement_messages'] = {
      data: [
        { id: 'm1', thread_id: 't1', platform: 'linkedin', platform_message_id: 'pm1' },
        { id: 'm2', thread_id: 't2', platform: 'linkedin', platform_message_id: 'pm2' },
      ],
      error: null,
    };
    mockTableResponses['engagement_threads'] = {
      data: [
        { id: 't1', organization_id: 'org-1' },
        { id: 't2', organization_id: 'SOMEONE-ELSE' }, // tenant skip target
      ],
      error: null,
    };

    let inFlight = 0;
    let maxInFlight = 0;
    (executeAction as jest.Mock).mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { ok: true };
    });

    const res = createMockRes();
    await bulkLikeHandler(
      createApiRequestMock({
        method: 'POST',
        body: { organization_id: 'org-1', message_ids: ['m1', 'm2'] },
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, liked: 1 }); // m2 skipped (foreign org)
    expect(executeAction).toHaveBeenCalledTimes(1); // never fired for the skipped one
    expect(maxInFlight).toBe(1); // platform actions remained SERIAL
    expect(listPlaybooks).toHaveBeenCalledTimes(1); // loop-invariant, hoisted
    // id-list resolve + full prefetch = 2 message queries; 1 thread query (was 2 per message)
    expect(fromCount('engagement_messages')).toBe(2);
    expect(fromCount('engagement_threads')).toBe(1);
  });
});

// ── W2-8 ────────────────────────────────────────────────────────────────────

describe('W2-8 detect-leads — batched prefetch, grouping, bounded concurrency', () => {
  test('2 batched queries; per-thread context; concurrency >1 but ≤5', async () => {
    (resolveUserContext as jest.Mock).mockResolvedValue({ userId: 'u1', defaultCompanyId: 'org-1' });
    (enforceCompanyAccess as jest.Mock).mockResolvedValue({ userId: 'u1' });

    mockTableResponses['engagement_threads'] = {
      data: [{ id: 't1' }, { id: 't2' }],
      error: null,
    };
    const msgs = [
      ...Array.from({ length: 7 }, (_, i) => ({ id: `t1-m${i}`, thread_id: 't1', content: `alpha${i}`, author_id: 'a' })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `t2-m${i}`, thread_id: 't2', content: `beta${i}`, author_id: 'b' })),
    ];
    mockTableResponses['engagement_messages'] = { data: msgs, error: null };
    mockTableResponses['engagement_message_intelligence'] = {
      data: [{ message_id: 't1-m0', intent: 'buy', sentiment: 'pos' }],
      error: null,
    };

    let inFlight = 0;
    let maxInFlight = 0;
    (processMessageForLeads as jest.Mock).mockImplementation(async (input) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 3));
      inFlight -= 1;
      return { detected: input.message_id === 't1-m0' };
    });

    const res = createMockRes();
    await detectLeadsHandler(
      createApiRequestMock({ method: 'POST', body: { organization_id: 'org-1' } }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      threads_processed: 2,
      messages_processed: 12,
      leads_detected: 1,
    });
    expect(fromCount('engagement_messages')).toBe(1); // was one per thread
    expect(fromCount('engagement_message_intelligence')).toBe(1); // was one per thread
    expect(maxInFlight).toBeGreaterThan(1); // genuinely parallel...
    expect(maxInFlight).toBeLessThanOrEqual(5); // ...but bounded at 5

    // Grouping correctness: t1 messages got a context built ONLY from t1 content.
    const t1Call = (processMessageForLeads as jest.Mock).mock.calls.find(
      ([input]) => input.message_id === 't1-m0'
    );
    expect(t1Call[0].thread_context).toContain('alpha0');
    expect(t1Call[0].thread_context).not.toContain('beta');
    // Intelligence joined from the batched prefetch.
    expect(t1Call[0].intent).toBe('buy');
  });
});

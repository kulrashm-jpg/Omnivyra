/**
 * CHARACTERIZATION SUITE — backend/services/campaignAiOrchestrator.ts
 * (runCampaignAiPlan → runWithContext, the planner's mode dispatcher and
 * generation state machine).
 *
 * This orchestrator is ALREADY heavily decomposed (30 submodules under
 * campaignAiOrchestrator/, several with their own suites: plannerHardening
 * covers budget/heartbeat/salvage/alerting, voiceAdoption covers transforms,
 * topicDifferentiation covers assignment). What had ZERO coverage was the
 * ~1,090-line `runWithContext` core: admission/overload/QA gating order, the
 * drafting phase, and the mode dispatch (generate_plan / refine_day /
 * platform_customize).
 *
 * Seams mocked: the executor's context-prep submodules (scripted minimal
 * contexts), stores/DB, AI planning call, parsers, admission/overload/cost
 * governance, event bus, alerting. Kept REAL: runWithContext itself, its
 * gating order, PlannerBudget, and the QA/admission fallback result builders.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const builder: any = {};
      for (const op of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'update', 'insert']) {
        builder[op] = () => builder;
      }
      builder.maybeSingle = () => builder;
      builder.single = () => builder;
      builder.then = (resolve: any, reject: any) => {
        const out = table === 'campaigns'
          ? { data: { id: 'camp-1', start_date: '2026-07-06', description: 'desc', name: 'Camp' }, error: null }
          : { data: null, error: null };
        return Promise.resolve(out).then(resolve, reject);
      };
      return builder;
    },
  },
}));
jest.mock('../../services/requestContext', () => ({
  getRequestContext: () => ({ requestId: 'req-test' }),
}));
jest.mock('../../db/campaignStore', () => ({
  getCampaignById: jest.fn(async () => ({ id: 'camp-1', name: 'Camp', company_id: 'co-1' })),
}));
jest.mock('../../db/campaignVersionStore', () => ({
  getLatestCampaignVersionByCampaignId: jest.fn(async () => ({
    company_id: 'co-1',
    build_mode: null,
    context_scope: null,
    campaign_types: null,
    campaign_weights: null,
    company_stage: null,
    campaign_snapshot: {},
  })),
}));
jest.mock('../../services/campaignAiOrchestrator/resolveAssistContext', () => ({
  resolveAssistContext: jest.fn(async () => ({
    assistBlogContext: null, assistInsightContext: null, assistTopicContext: null, assistAi: null,
  })),
}));
jest.mock('../../services/campaignAiOrchestrator/runGatherPhaseGate', () => ({
  runGatherPhaseGate: jest.fn(async () => null), // null = gate passes
}));
jest.mock('../../services/campaignAiOrchestrator/resolveExecutionContext', () => ({
  resolveExecutionContext: jest.fn(async () => ({
    ctx: {
      snapshot_hash: 'hash-1',
      omnivyreDecision: { decision: 'proceed', raw: {} },
      qaState: null,
      companyId: 'co-1',
    },
    baselineContext: null,
  })),
}));
jest.mock('../../services/campaignAiOrchestrator/preparePrefilledPlanningState', () => ({
  preparePrefilledPlanningState: jest.fn(async () => ({
    prefilledPlanning: null,
    trustedUtcTodayISO: '2026-07-09',
    qaPrefilledKeys: [],
    deterministicSkeleton: null,
  })),
}));
jest.mock('../../services/campaignAiOrchestrator/prepareRuntimePlanningContext', () => ({
  prepareRuntimePlanningContext: jest.fn(async () => ({
    qaState: null,
    distributionStrategy: null,
    distributionReason: null,
    strategyMemory: null,
    strategyLearningProfile: null,
    strategyLearningFromCache: false,
    campaignContext: null,
  })),
}));
jest.mock('../../services/campaignAiOrchestrator/preparePlanningRunContext', () => ({
  preparePlanningRunContext: jest.fn(async () => ({
    platformContentTypePrefs: {},
    effectivePrefilledPlanning: null,
    deterministicPlanSkeleton: null,
    hasDeterministicPlanSkeleton: false,
    weeklyStrategyIntelligence: null,
    strategy_bias: null,
    previousPerformanceInsights: null,
    durationFromPrefilled: null,
    planningInput: { topic: 'Test topic' },
  })),
}));
jest.mock('../../services/campaignAiOrchestrator/evaluateGeneratedPlan', () => ({
  evaluateGeneratedPlan: jest.fn(async () => ({
    campaign_validation: { status: 'valid' },
    paid_recommendation: null,
  })),
}));
jest.mock('../../services/aiPlanningService', () => ({
  generateCampaignPlanAI: jest.fn(async () => ({ rawOutput: 'RAW-OUTPUT' })),
}));
jest.mock('../../services/aiGateway', () => ({
  generateCampaignPlan: jest.fn(),
  getLlmPoolPressure: jest.fn(() => ({
    pendingAcquires: 0, activeCalls: 0, maxAllowed: 4, recentAvgWaitMs: 0,
  })),
}));
jest.mock('../../services/bullmqOverloadSignals', () => ({
  getBoltQueuePressure: jest.fn(async () => ({
    pressureHigh: false, reasons: [], waiting: 0, delayed: 0, active: 0,
  })),
}));
jest.mock('../../services/plannerAdmissionControl', () => ({
  checkAdmission: jest.fn(async () => ({ admitted: true, priority: 'normal', mode: 'normal' })),
}));
jest.mock('../../services/distributedOverloadCoordinator', () => ({
  getClusterOverloadMode: jest.fn(async () => ({ mode: 'normal', pressureScore: 0 })),
  policyForMode: jest.fn(() => ({})),
}));
jest.mock('../../services/plannerCostGovernance', () => ({
  getCostGuidance: jest.fn(async () => ({ shouldRefine: true, reasons: [] })),
}));
jest.mock('../../services/plannerRolloutMode', () => ({
  applyActiveRolloutMode: jest.fn((x: unknown) => x),
}));
jest.mock('../../services/plannerAlerting', () => ({
  recordPlannerAlertCounter: jest.fn(),
}));
jest.mock('../../services/plannerEventBus', () => ({
  plannerEventBus: { emit: jest.fn() },
}));
jest.mock('../../services/campaignPlanParser', () => ({
  parseAiRefinedDay: jest.fn(async () => ({ day: 3, items: [{ title: 'Refined item' }] })),
  parseAiPlatformCustomization: jest.fn(async () => ({ platform: 'linkedin', content: 'Customized' })),
}));
jest.mock('../../db/campaignPlanStore', () => ({
  saveStructuredCampaignPlanDayUpdate: jest.fn(async () => {}),
  savePlatformCustomizedContent: jest.fn(async () => {}),
}));
jest.mock('../../services/accountContextRefreshService', () => ({
  refreshAccountContext: jest.fn(async () => {}),
}));
jest.mock('../../services/viralityAdvisorService', () => ({
  assessVirality: jest.fn(async () => null),
}));
jest.mock('../../services/viralitySnapshotBuilder', () => ({
  buildCampaignSnapshotWithHash: jest.fn(async () => ({ snapshot: {}, hash: 'h' })),
}));
jest.mock('../../jobs/campaignHealthEvaluationJob', () => ({
  evaluateAndPersistCampaignHealth: jest.fn(async () => {}),
}));
jest.mock('../../services/externalApiService', () => ({
  getPlatformStrategies: jest.fn(async () => []),
}));
jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(async () => null),
}));
jest.mock('../../services/campaignAiOrchestrator/asyncRefinement', () => ({
  enqueueAsyncRefinement: jest.fn(async () => {}),
}));

import { runCampaignAiPlan } from '../../services/campaignAiOrchestrator';
import { generateCampaignPlanAI } from '../../services/aiPlanningService';
import { checkAdmission } from '../../services/plannerAdmissionControl';
import { parseAiRefinedDay, parseAiPlatformCustomization } from '../../services/campaignPlanParser';
import {
  saveStructuredCampaignPlanDayUpdate,
  savePlatformCustomizedContent,
} from '../../db/campaignPlanStore';
import { prepareRuntimePlanningContext } from '../../services/campaignAiOrchestrator/prepareRuntimePlanningContext';

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
});

describe('mode dispatch — refine_day', () => {
  it('drafts, parses the refined day, persists it, and returns the refine_day envelope', async () => {
    const result = await runCampaignAiPlan({
      mode: 'refine_day',
      campaignId: 'camp-1',
      prompt: 'refine day 3',
    } as any);

    expect(generateCampaignPlanAI).toHaveBeenCalledTimes(1);
    expect(parseAiRefinedDay).toHaveBeenCalledWith('RAW-OUTPUT');
    expect(saveStructuredCampaignPlanDayUpdate).toHaveBeenCalledTimes(1);
    expect((saveStructuredCampaignPlanDayUpdate as jest.Mock).mock.calls[0][0]).toMatchObject({
      campaignId: 'camp-1',
    });
    expect(result.mode).toBe('refine_day');
    expect(result.snapshot_hash).toBe('hash-1');
    expect(result).toMatchSnapshot('refine-day-envelope');
  });
});

describe('mode dispatch — platform_customize', () => {
  it('parses the customization and persists it', async () => {
    const result = await runCampaignAiPlan({
      mode: 'platform_customize',
      campaignId: 'camp-1',
      prompt: 'customize for linkedin',
    } as any);

    expect(parseAiPlatformCustomization).toHaveBeenCalledWith('RAW-OUTPUT');
    expect(savePlatformCustomizedContent).toHaveBeenCalledTimes(1);
    expect(result.mode).toBe('platform_customize');
  });
});

describe('generate_plan gates (run BEFORE any LLM call)', () => {
  it('admission rejection short-circuits with a retry message and never drafts', async () => {
    (checkAdmission as jest.Mock).mockResolvedValueOnce({
      admitted: false,
      priority: 'normal',
      mode: 'shed',
      reason: 'planner_overloaded',
      retryAfterMs: 5000,
    });
    const result = await runCampaignAiPlan({
      mode: 'generate_plan',
      campaignId: 'camp-1',
      prompt: 'make a plan',
    } as any);

    expect(generateCampaignPlanAI).not.toHaveBeenCalled();
    expect(result.conversationalResponse).toContain('under heavy load');
    expect((result as any).omnivyre_decision.raw).toMatchObject({
      admission_rejected: true,
      admission_reason: 'planner_overloaded',
    });
  });

  it('QA short-circuit: not ready to generate ⇒ returns the next question, never drafts', async () => {
    // qaState reaches runWithContext via prepareRuntimePlanningContext (the
    // executor's spread order lets it override the execution-context value).
    (prepareRuntimePlanningContext as jest.Mock).mockResolvedValueOnce({
      qaState: {
        readyToGenerate: false,
        allRequiredAnswered: false,
        userConfirmed: false,
        nextQuestion: { question: 'What is your primary campaign goal?' },
      },
      distributionStrategy: null,
      distributionReason: null,
      strategyMemory: null,
      strategyLearningProfile: null,
      strategyLearningFromCache: false,
      campaignContext: null,
    });
    const result = await runCampaignAiPlan({
      mode: 'generate_plan',
      campaignId: 'camp-1',
      prompt: 'make a plan',
    } as any);

    expect(generateCampaignPlanAI).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toContain('What is your primary campaign goal?');
  });

  it('admission is checked ONLY for generate_plan (refine_day bypasses it)', async () => {
    (checkAdmission as jest.Mock).mockClear();
    await runCampaignAiPlan({ mode: 'refine_day', campaignId: 'camp-1', prompt: 'x' } as any);
    expect(checkAdmission).not.toHaveBeenCalled();
  });
});

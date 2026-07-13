/**
 * CSA-005 — the canonical Customer Success Orchestrator.
 *
 * Locks the ONE next-best-action authority: deterministic action generation +
 * canonical states (Available/Blocked/Completed/Dismissed/Deferred),
 * deterministic prioritization + dependencies + explanation, a pure read-model
 * (no execution/persistence), and the observable/fail-safe batch service. No DB —
 * the health/lifecycle authorities are injected.
 */

jest.mock('../../observability/metrics', () => ({
  recordRawCounter: jest.fn(),
  recordRawHistogram: jest.fn(),
}));

import {
  orchestrateCustomerSuccess,
  CUSTOMER_SUCCESS_ACTION_IDS,
  type OrchestratorInputs,
  type ActionArea,
  type ReadinessAreaState,
} from '../../../lib/customerSuccess/nextBestActions';
import {
  buildAllCustomerSuccessPlans,
  buildCustomerSuccessInputs,
} from '../../services/customerSuccess/customerSuccessOrchestratorService';
import type { HealthResult } from '../../services/health/customerHealthService';
import { recordRawCounter } from '../../observability/metrics';

const NOW = '2026-07-14T00:00:00.000Z';

const areas = (s: ReadinessAreaState): Record<ActionArea, ReadinessAreaState> => ({
  COMPANY_PROFILE: s, WEBSITE: s, GOOGLE_ANALYTICS: s, GOOGLE_SEARCH_CONSOLE: s, SOCIAL_INTEGRATIONS: s,
});

function inputs(over: Partial<OrchestratorInputs> = {}): OrchestratorInputs {
  return {
    companyId: 'c1', now: NOW, platformReady: true, lifecycleStage: 'ACTIVATED',
    healthScore: 60, healthState: 'STABLE', trajectory: 'STABLE', inactiveDays: 2,
    areas: areas('NOT_READY'), usageActiveDays: 1, capabilitiesUsed: [], dismissedActionIds: [],
    ...over,
  };
}

const byId = (plan: ReturnType<typeof orchestrateCustomerSuccess>, id: string) =>
  plan.actions.find((a) => a.id === id)!;

describe('CSA-005 §2 — deterministic action generation', () => {
  test('produces the full canonical action catalog for every company', () => {
    const plan = orchestrateCustomerSuccess(inputs());
    expect(plan.actions.map((a) => a.id).sort()).toEqual([...CUSTOMER_SUCCESS_ACTION_IDS].sort());
  });

  test('is deterministic — same inputs yield an identical plan', () => {
    expect(JSON.stringify(orchestrateCustomerSuccess(inputs()))).toBe(JSON.stringify(orchestrateCustomerSuccess(inputs())));
  });
});

describe('CSA-005 §4 — canonical action states', () => {
  test('an already-satisfied action is COMPLETED', () => {
    const plan = orchestrateCustomerSuccess(inputs({ platformReady: true }));
    expect(byId(plan, 'complete_onboarding').state).toBe('COMPLETED');
  });

  test('a growth action is BLOCKED before Platform Ready, with dependency + factors', () => {
    const plan = orchestrateCustomerSuccess(inputs({ platformReady: false, lifecycleStage: 'ONBOARDING' }));
    const ga = byId(plan, 'connect_ga4');
    expect(ga.state).toBe('BLOCKED');
    expect(ga.dependencies).toContain('Complete onboarding');
    expect(ga.blockingFactors).toContain('Onboarding incomplete');
  });

  test('an action whose prereqs are met but not relevant to the stage is DEFERRED', () => {
    // GA4 is relevant to ADOPTING/GROWING/MATURE — at ACTIVATED it is deferred.
    const plan = orchestrateCustomerSuccess(inputs({ lifecycleStage: 'ACTIVATED', platformReady: true }));
    expect(byId(plan, 'connect_ga4').state).toBe('DEFERRED');
  });

  test('a dismissed action reads DISMISSED', () => {
    const plan = orchestrateCustomerSuccess(inputs({ lifecycleStage: 'ACTIVATED', dismissedActionIds: ['generate_first_content'] }));
    expect(byId(plan, 'generate_first_content').state).toBe('DISMISSED');
  });

  test('a relevant, unblocked, non-dismissed, incomplete action is AVAILABLE', () => {
    const plan = orchestrateCustomerSuccess(inputs({ lifecycleStage: 'ACTIVATED', platformReady: true }));
    expect(byId(plan, 'generate_first_content').state).toBe('AVAILABLE');
  });
});

describe('CSA-005 §2/§3 — next best action + prioritization', () => {
  test('onboarding-incomplete → next best action is Complete onboarding (CRITICAL)', () => {
    const plan = orchestrateCustomerSuccess(inputs({ platformReady: false, lifecycleStage: 'ONBOARDING' }));
    expect(plan.nextBestAction?.id).toBe('complete_onboarding');
    expect(plan.nextBestAction?.priorityTier).toBe('CRITICAL');
  });

  test('dormant → Increase activity is recommended and high priority', () => {
    const plan = orchestrateCustomerSuccess(inputs({
      lifecycleStage: 'DORMANT', healthState: 'INACTIVE', usageActiveDays: 0, platformReady: true,
    }));
    const act = byId(plan, 'increase_activity');
    expect(act.state).toBe('AVAILABLE');
    expect(['CRITICAL', 'HIGH']).toContain(act.priorityTier);
    expect(plan.recommendedActions[0].id).toBe('increase_activity');
  });

  test('recommendedActions are AVAILABLE only and sorted by priority desc', () => {
    const plan = orchestrateCustomerSuccess(inputs({ lifecycleStage: 'ACTIVATED', platformReady: true }));
    expect(plan.recommendedActions.every((a) => a.state === 'AVAILABLE')).toBe(true);
    for (let i = 1; i < plan.recommendedActions.length; i++) {
      expect(plan.recommendedActions[i - 1].priorityScore).toBeGreaterThanOrEqual(plan.recommendedActions[i].priorityScore);
    }
  });

  test('every action carries reason, dependencies, expected impact', () => {
    const plan = orchestrateCustomerSuccess(inputs());
    for (const a of plan.actions) {
      expect(a.reason.length).toBeGreaterThan(0);
      expect(a.expectedImpact.length).toBeGreaterThan(0);
      expect(Array.isArray(a.dependencies)).toBe(true);
    }
  });
});

describe('CSA-005 §5 — explanation', () => {
  test('every action explains why / why now / expected outcome / prerequisites', () => {
    const plan = orchestrateCustomerSuccess(inputs({ platformReady: false, lifecycleStage: 'ONBOARDING' }));
    const ga = byId(plan, 'connect_ga4');
    expect(ga.explanation.why.length).toBeGreaterThan(0);
    expect(ga.explanation.whyNow.length).toBeGreaterThan(0);
    expect(ga.explanation.expectedOutcome.length).toBeGreaterThan(0);
    expect(ga.explanation.requiredPrerequisites).toContain('Platform Ready');
  });
});

describe('CSA-005 §1/§8 — orchestrator service (reuses health+lifecycle, observable, fail-safe)', () => {
  function health(companyId: string, over: Partial<HealthResult['inputs']> = {}, score = 60): HealthResult {
    const areasVal = (over.areas as Record<ActionArea, ReadinessAreaState>) ?? areas('NOT_READY');
    return {
      inputs: {
        companyId, now: NOW, platformReady: true, readinessScore: score, readinessBucket: 'PARTIAL',
        tenantStatus: 'ACTIVE', lastActivityAt: '2026-07-13T00:00:00Z', areas: areasVal as never,
        trajectory: 'STABLE', scoreDelta: 0,
        usage: { totalEvents: 1, activeUsers: 1, activeDays: 1, capabilitiesUsed: [] },
        ...over,
      } as never,
      health: {
        companyId, score, state: 'STABLE',
        risk: { level: 'LOW', reasons: [], missingPrerequisites: [], inactiveDays: 1, adoptionGaps: [] },
        contributors: [{ key: 'integration', label: 'Integration coverage', value: 0, weight: 0.2 }],
        explanation: { why: '', majorContributors: [], negativeContributors: [], recommendedImprovements: [] },
        evaluatedAt: NOW,
      } as never,
    };
  }

  test('builds a plan per company reusing injected health+lifecycle and emits observability', async () => {
    (recordRawCounter as jest.Mock).mockClear();
    const healths = [health('c1'), health('c2', { platformReady: false })];
    const plans = await buildAllCustomerSuccessPlans({
      now: NOW,
      buildHealth: async () => healths,
      buildLifecycle: async () => [
        { companyId: 'c1', stage: 'ACTIVATED' } as never,
        { companyId: 'c2', stage: 'ONBOARDING' } as never,
      ],
    });
    expect(plans).toHaveLength(2);
    expect(plans.find((p) => p.companyId === 'c2')!.nextBestAction?.id).toBe('complete_onboarding');
    const names = (recordRawCounter as jest.Mock).mock.calls.map((c) => c[0]);
    expect(names).toEqual(expect.arrayContaining(['csa.cs.next_action', 'csa.cs.recommended', 'csa.cs.blocked']));
  });

  test('fail-safe: a build failure returns [] (never throws)', async () => {
    const plans = await buildAllCustomerSuccessPlans({ now: NOW, buildHealth: async () => { throw new Error('down'); } });
    expect(plans).toEqual([]);
  });

  test('buildCustomerSuccessInputs maps health+lifecycle deterministically', () => {
    const i = buildCustomerSuccessInputs(health('c1', { areas: areas('READY') as never }, 88), 'MATURE', NOW);
    expect(i.platformReady).toBe(true);
    expect(i.healthScore).toBe(88);
    expect(i.lifecycleStage).toBe('MATURE');
    expect(i.areas.GOOGLE_ANALYTICS).toBe('READY');
  });
});

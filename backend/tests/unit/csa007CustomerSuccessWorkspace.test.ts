/**
 * CSA-007 — the canonical Customer Success Workspace (composition layer).
 *
 * Locks that the workspace is PURE composition over the existing authorities
 * (CSA-003 health, CSA-004 lifecycle, CSA-005 orchestrator, CSA-006 playbooks):
 * every section is a projection of an authority output, actions/playbooks carry
 * links to existing surfaces (§6), the service reuses one health build, and the
 * result is deterministic + observable + fail-safe. No DB — authorities injected.
 */

jest.mock('../../observability/metrics', () => ({
  recordRawCounter: jest.fn(),
  recordRawHistogram: jest.fn(),
}));

import { composeCustomerSuccessWorkspace, WORKSPACE_SECTIONS } from '../../../lib/customerSuccess/workspace';
import { orchestrateCustomerSuccess, type ActionArea, type ReadinessAreaState } from '../../../lib/customerSuccess/nextBestActions';
import { buildPlaybookSet } from '../../../lib/customerSuccess/playbooks';
import {
  buildAllCustomerSuccessWorkspaces,
  getCustomerSuccessWorkspace,
} from '../../services/customerSuccess/customerSuccessWorkspaceService';
import type { HealthResult } from '../../services/health/customerHealthService';
import { recordRawCounter } from '../../observability/metrics';

const NOW = '2026-07-14T00:00:00.000Z';

const areas = (s: ReadinessAreaState): Record<ActionArea, ReadinessAreaState> => ({
  COMPANY_PROFILE: s, WEBSITE: s, GOOGLE_ANALYTICS: s, GOOGLE_SEARCH_CONSOLE: s, SOCIAL_INTEGRATIONS: s,
});

function planFor(over: Record<string, unknown> = {}) {
  return orchestrateCustomerSuccess({
    companyId: 'c1', now: NOW, platformReady: false, lifecycleStage: 'ONBOARDING',
    healthScore: 30, healthState: 'AT_RISK', trajectory: 'STABLE', inactiveDays: 2,
    areas: areas('NOT_READY'), usageActiveDays: 0, capabilitiesUsed: [], dismissedActionIds: [],
    ...over,
  });
}

function compose(over: Record<string, unknown> = {}) {
  const plan = planFor(over);
  return composeCustomerSuccessWorkspace({
    companyId: 'c1', now: NOW,
    health: { score: 30, state: 'AT_RISK', riskLevel: 'HIGH', majorContributors: [], recommendedImprovements: ['Complete Website / CMS.'] },
    platformReady: false, readinessScore: 30,
    usage: { totalEvents: 0, activeUsers: 0, activeDays: 0, capabilitiesUsed: [] },
    lifecycle: { stage: 'ONBOARDING', previousStage: null, transitionReason: 'Initial lifecycle classification.', trajectory: 'UNKNOWN', nextMilestone: 'Activated' },
    plan,
    playbookSet: buildPlaybookSet(plan),
  });
}

describe('CSA-007 §1 — composition of all sections', () => {
  test('the workspace exposes every canonical section', () => {
    const w = compose();
    expect(w.sections).toEqual([...WORKSPACE_SECTIONS]);
    expect(w.overview).toBeTruthy();
    expect(w.health).toBeTruthy();
    expect(w.lifecycle).toBeTruthy();
    expect(w.platformReady).toBeTruthy();
    expect(w.usage).toBeTruthy();
    expect(w.playbooks).toBeTruthy();
  });

  test('every value is a projection of an authority output (no new numbers)', () => {
    const w = compose();
    expect(w.health.score).toBe(30);                 // from CSA-003
    expect(w.lifecycle.stage).toBe('ONBOARDING');    // from CSA-004
    expect(w.overview.healthState).toBe('AT_RISK');
    expect(w.platformReady.readinessScore).toBe(30);
  });
});

describe('CSA-007 §4 — next best action', () => {
  test('surfaces the plan next-best action with priority/reason/impact/link', () => {
    const w = compose();
    expect(w.nextBestAction?.id).toBe('complete_onboarding');
    expect(w.nextBestAction?.priorityTier).toBe('CRITICAL');
    expect(w.nextBestAction?.reason.length).toBeGreaterThan(0);
    expect(w.nextBestAction?.expectedImpact.length).toBeGreaterThan(0);
    expect(w.nextBestAction?.href).toBe('/onboarding/journey'); // §6 link
  });

  test('recommendedActions mirror the plan (all with links)', () => {
    const w = compose();
    expect(w.recommendedActions.length).toBeGreaterThan(0);
    expect(w.recommendedActions.every((a) => a.href !== undefined)).toBe(true);
  });
});

describe('CSA-007 §5/§6 — playbooks + navigation links', () => {
  test('recommended playbook matches the next best action and links to a surface', () => {
    const w = compose();
    expect(w.playbooks.recommended?.actionId).toBe('complete_onboarding');
    expect(w.playbooks.recommended?.id).toBe('onboarding_playbook');
    expect(w.playbooks.recommended?.href).toBe('/onboarding/journey');
    expect(w.playbooks.recommended?.steps.length).toBeGreaterThan(0);
    expect(w.playbooks.recommended?.progress.total).toBeGreaterThan(0);
  });

  test('completed action → playbook progress is full', () => {
    const w = compose({ platformReady: true }); // complete_onboarding COMPLETED
    const onb = w.playbooks.all.find((p) => p.actionId === 'complete_onboarding')!;
    expect(onb.status).toBe('COMPLETED');
    expect(onb.progress.completed).toBe(onb.progress.total);
  });
});

describe('CSA-007 §7 — determinism', () => {
  test('same inputs yield an identical workspace', () => {
    expect(JSON.stringify(compose())).toBe(JSON.stringify(compose()));
  });
});

describe('CSA-007 §1/§8 — workspace service (reuses one health build, observable, fail-safe)', () => {
  function health(companyId: string, over: Partial<HealthResult['inputs']> = {}, score = 30): HealthResult {
    return {
      inputs: {
        companyId, now: NOW, platformReady: false, readinessScore: score, readinessBucket: 'AT_RISK',
        tenantStatus: 'ACTIVE', lastActivityAt: '2026-07-13T00:00:00Z', areas: areas('NOT_READY') as never,
        trajectory: 'STABLE', scoreDelta: 0,
        usage: { totalEvents: 0, activeUsers: 0, activeDays: 0, capabilitiesUsed: [] },
        ...over,
      } as never,
      health: {
        companyId, score, state: 'AT_RISK',
        risk: { level: 'HIGH', reasons: [], missingPrerequisites: [], inactiveDays: 2, adoptionGaps: [] },
        contributors: [{ key: 'integration', label: 'Integration coverage', value: 0, weight: 0.2 }],
        explanation: { why: '', majorContributors: [], negativeContributors: [], recommendedImprovements: [] },
        evaluatedAt: NOW,
      } as never,
    };
  }

  test('composes a workspace per company, reusing injected health+lifecycle, and emits observability', async () => {
    (recordRawCounter as jest.Mock).mockClear();
    const healths = [health('c1'), health('c2')];
    const workspaces = await buildAllCustomerSuccessWorkspaces({
      now: NOW,
      buildHealth: async () => healths,
      buildLifecycle: async () => [
        { companyId: 'c1', stage: 'ONBOARDING', transition: { from: null, reason: 'Initial lifecycle classification.', trajectory: 'UNKNOWN' }, explanation: { nextMilestone: 'Activated' } } as never,
        { companyId: 'c2', stage: 'ONBOARDING', transition: { from: null, reason: 'Initial lifecycle classification.', trajectory: 'UNKNOWN' }, explanation: { nextMilestone: 'Activated' } } as never,
      ],
    });
    expect(workspaces).toHaveLength(2);
    expect(workspaces[0].nextBestAction?.id).toBe('complete_onboarding');
    expect((recordRawCounter as jest.Mock).mock.calls.map((c) => c[0])).toContain('csa.workspace.built');
  });

  test('getCustomerSuccessWorkspace returns one company', async () => {
    const w = await getCustomerSuccessWorkspace('c1', {
      now: NOW,
      buildHealth: async () => [health('c1')],
      buildLifecycle: async () => [{ companyId: 'c1', stage: 'ONBOARDING', transition: { from: null, reason: 'x', trajectory: 'UNKNOWN' }, explanation: { nextMilestone: 'Activated' } } as never],
    });
    expect(w?.companyId).toBe('c1');
  });

  test('fail-safe: a build failure returns [] (never throws)', async () => {
    const ws = await buildAllCustomerSuccessWorkspaces({ now: NOW, buildHealth: async () => { throw new Error('down'); } });
    expect(ws).toEqual([]);
  });
});

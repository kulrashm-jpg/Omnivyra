/**
 * CSA-006 — the canonical Customer Success Playbook Engine.
 *
 * Locks the ONE playbook authority: every CSA-005 action maps to exactly one
 * deterministic playbook; playbooks carry the full model (objective, prereqs,
 * steps with required/blockedBy/unlocks, completion criteria, effort/duration)
 * and the live action state; the engine is a pure read-model (no execution); and
 * the service reuses the orchestrator with observability + fail-safe behavior.
 */

jest.mock('../../observability/metrics', () => ({
  recordRawCounter: jest.fn(),
  recordRawHistogram: jest.fn(),
}));

import {
  buildPlaybookSet,
  playbookForAction,
  everyActionMapped,
  PLAYBOOK_BY_ACTION,
  type PlaybookView,
} from '../../../lib/customerSuccess/playbooks';
import {
  orchestrateCustomerSuccess,
  CUSTOMER_SUCCESS_ACTION_IDS,
  type OrchestratorInputs,
  type ActionArea,
  type ReadinessAreaState,
} from '../../../lib/customerSuccess/nextBestActions';
import {
  buildAllCustomerSuccessPlaybooks,
  getCustomerSuccessPlaybooks,
} from '../../services/customerSuccess/customerSuccessPlaybookService';
import { recordRawCounter } from '../../observability/metrics';

const NOW = '2026-07-14T00:00:00.000Z';

const areas = (s: ReadinessAreaState): Record<ActionArea, ReadinessAreaState> => ({
  COMPANY_PROFILE: s, WEBSITE: s, GOOGLE_ANALYTICS: s, GOOGLE_SEARCH_CONSOLE: s, SOCIAL_INTEGRATIONS: s,
});

function planFor(over: Partial<OrchestratorInputs> = {}) {
  return orchestrateCustomerSuccess({
    companyId: 'c1', now: NOW, platformReady: true, lifecycleStage: 'ACTIVATED',
    healthScore: 60, healthState: 'STABLE', trajectory: 'STABLE', inactiveDays: 2,
    areas: areas('NOT_READY'), usageActiveDays: 1, capabilitiesUsed: [], dismissedActionIds: [],
    ...over,
  });
}

const pb = (set: ReturnType<typeof buildPlaybookSet>, id: string): PlaybookView =>
  set.playbooks.find((p) => p.actionId === id)!;

describe('CSA-006 §3 — action → playbook mapping (exactly one each)', () => {
  test('every CSA-005 action maps to exactly one playbook', () => {
    expect(everyActionMapped()).toBe(true);
    expect(PLAYBOOK_BY_ACTION.size).toBe(CUSTOMER_SUCCESS_ACTION_IDS.length);
    // one-to-one: no two actions share a playbook id
    const ids = CUSTOMER_SUCCESS_ACTION_IDS.map((a) => PLAYBOOK_BY_ACTION.get(a)!.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('a plan produces one playbook per action', () => {
    const set = buildPlaybookSet(planFor());
    expect(set.playbooks.map((p) => p.actionId).sort()).toEqual([...CUSTOMER_SUCCESS_ACTION_IDS].sort());
  });

  test('canonical mappings: complete_onboarding→Onboarding, connect_ga4→Analytics, create_first_campaign→Campaign Launch', () => {
    expect(PLAYBOOK_BY_ACTION.get('complete_onboarding')!.title).toBe('Onboarding Playbook');
    expect(PLAYBOOK_BY_ACTION.get('connect_ga4')!.title).toBe('Analytics Playbook');
    expect(PLAYBOOK_BY_ACTION.get('create_first_campaign')!.title).toBe('Campaign Launch Playbook');
  });
});

describe('CSA-006 §2/§4 — playbook model + steps', () => {
  test('every playbook carries the full canonical model', () => {
    for (const p of PLAYBOOK_BY_ACTION.values()) {
      expect(p.id).toBeTruthy();
      expect(p.objective.length).toBeGreaterThan(0);
      expect(Array.isArray(p.prerequisites)).toBe(true);
      expect(p.steps.length).toBeGreaterThan(0);
      expect(p.expectedOutcome.length).toBeGreaterThan(0);
      expect(Array.isArray(p.dependencies)).toBe(true);
      expect(p.completionCriteria.length).toBeGreaterThan(0);
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(p.estimatedEffort);
      expect(p.estimatedDurationMinutes).toBeGreaterThan(0);
    }
  });

  test('every step carries title/description/required + blockedBy/unlocks', () => {
    for (const p of PLAYBOOK_BY_ACTION.values()) {
      for (const s of p.steps) {
        expect(s.title.length).toBeGreaterThan(0);
        expect(s.description.length).toBeGreaterThan(0);
        expect(typeof s.required).toBe('boolean');
        expect(Array.isArray(s.blockedBy)).toBe(true);
        expect(Array.isArray(s.unlocks)).toBe(true);
      }
    }
    // At least one required and one non-required step exist across the catalog.
    const all = [...PLAYBOOK_BY_ACTION.values()].flatMap((p) => p.steps);
    expect(all.some((s) => s.required)).toBe(true);
    expect(all.some((s) => !s.required)).toBe(true);
  });
});

describe('CSA-006 §1/§5 — playbook carries live action state + explanation', () => {
  test('recommended playbook matches the plan next-best action', () => {
    const plan = planFor({ platformReady: false, lifecycleStage: 'ONBOARDING' });
    const set = buildPlaybookSet(plan);
    expect(set.recommendedPlaybook?.actionId).toBe('complete_onboarding');
    expect(set.recommendedPlaybook?.id).toBe('onboarding_playbook');
  });

  test('a blocked action → its playbook status is BLOCKED; completed → COMPLETED', () => {
    const set = buildPlaybookSet(planFor({ platformReady: false, lifecycleStage: 'ONBOARDING' }));
    expect(pb(set, 'connect_ga4').status).toBe('BLOCKED');           // needs onboarding
    expect(pb(set, 'complete_onboarding').status).toBe('AVAILABLE');  // the onboarding action itself
    const ready = buildPlaybookSet(planFor({ platformReady: true }));
    expect(pb(ready, 'complete_onboarding').status).toBe('COMPLETED');
  });

  test('explanation carries why / why now / expected business value / next milestone', () => {
    const set = buildPlaybookSet(planFor({ platformReady: false, lifecycleStage: 'ONBOARDING' }));
    const onb = pb(set, 'complete_onboarding');
    expect(onb.explanation.why.length).toBeGreaterThan(0);
    expect(onb.explanation.whyNow.length).toBeGreaterThan(0);
    expect(onb.explanation.expectedBusinessValue.length).toBeGreaterThan(0);
    expect(onb.explanation.nextMilestone).toBe('Platform Ready');
  });
});

describe('CSA-006 §7 — determinism', () => {
  test('same plan yields an identical playbook set', () => {
    expect(JSON.stringify(buildPlaybookSet(planFor()))).toBe(JSON.stringify(buildPlaybookSet(planFor())));
  });

  test('playbookForAction is a pure projection of the action', () => {
    const plan = planFor();
    const action = plan.actions[0];
    const view = playbookForAction(action)!;
    expect(view.status).toBe(action.state);
    expect(view.priorityScore).toBe(action.priorityScore);
  });
});

describe('CSA-006 §1/§8 — playbook service (reuses orchestrator, observable, fail-safe)', () => {
  test('builds a playbook set per company reusing injected plans + emits observability', async () => {
    (recordRawCounter as jest.Mock).mockClear();
    const plans = [
      planFor({ companyId: 'c1', platformReady: false, lifecycleStage: 'ONBOARDING' }),
      planFor({ companyId: 'c2', lifecycleStage: 'ACTIVATED' }),
    ].map((p, idx) => ({ ...p, companyId: idx === 0 ? 'c1' : 'c2' }));

    const sets = await buildAllCustomerSuccessPlaybooks({ buildPlans: async () => plans });
    expect(sets).toHaveLength(2);
    expect(sets[0].recommendedPlaybook?.id).toBe('onboarding_playbook');
    const names = (recordRawCounter as jest.Mock).mock.calls.map((c) => c[0]);
    expect(names).toEqual(expect.arrayContaining(['csa.playbook.distribution', 'csa.playbook.completion_potential']));
  });

  test('getCustomerSuccessPlaybooks returns one company', async () => {
    const plans = [planFor({ companyId: 'c1' })];
    const set = await getCustomerSuccessPlaybooks('c1', { buildPlans: async () => plans });
    expect(set?.companyId).toBe('c1');
  });

  test('fail-safe: a build failure returns [] (never throws)', async () => {
    const sets = await buildAllCustomerSuccessPlaybooks({ buildPlans: async () => { throw new Error('down'); } });
    expect(sets).toEqual([]);
  });
});

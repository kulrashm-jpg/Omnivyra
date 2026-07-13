/**
 * ONBOARD-001R §1/§8 — company lifecycle derivation + Platform Ready explanation.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../services/onboardingJourneyService', () => {
  const actual = jest.requireActual('../../services/onboardingJourneyService');
  return { ...actual, buildOnboardingJourney: jest.fn() };
});

import {
  canTransition,
  assertTransition,
  resolveCompanyLifecycleState,
  COMPANY_LIFECYCLE_ORDER,
} from '../../services/companyLifecycleService';
import {
  explainPlatformReadiness,
  type JourneyStageView,
  type OnboardingJourney,
} from '../../services/onboardingJourneyService';

const stage = (over: Partial<JourneyStageView>): JourneyStageView => ({
  id: 'social_accounts', title: 'Social', why: 'w', mandatory: false, skippable: true,
  dismissible: true, dependsOn: [], href: '#', status: 'pending', detail: null, ...over,
});

const journeyWith = (stages: JourneyStageView[], platformReady: boolean): OnboardingJourney => ({
  generatedAt: 'now', userId: 'u1', companyId: 'org1', stages,
  currentStep: 'company_review', platformReady,
  readiness: explainPlatformReadiness(stages, platformReady),
});

describe('ONBOARD-001R §1 — lifecycle transitions', () => {
  test('happy path is legal in order; self-transitions legal', () => {
    for (let i = 0; i < COMPANY_LIFECYCLE_ORDER.length - 1; i++) {
      expect(canTransition(COMPANY_LIFECYCLE_ORDER[i], COMPANY_LIFECYCLE_ORDER[i + 1])).toBe(true);
    }
    for (const s of COMPANY_LIFECYCLE_ORDER) expect(canTransition(s, s)).toBe(true);
  });

  test('illegal jumps rejected; ARCHIVED terminal', () => {
    expect(canTransition('DISCOVERED', 'PLATFORM_READY')).toBe(false);
    expect(canTransition('CREATED', 'ACTIVE')).toBe(false);
    expect(canTransition('ARCHIVED', 'ACTIVE')).toBe(false);
    expect(() => assertTransition('CREATED', 'ACTIVE')).toThrow(/ILLEGAL_COMPANY_LIFECYCLE_TRANSITION/);
  });

  test('SUSPENDED can reactivate; ACTIVE can suspend', () => {
    expect(canTransition('SUSPENDED', 'ACTIVE')).toBe(true);
    expect(canTransition('ACTIVE', 'SUSPENDED')).toBe(true);
  });
});

describe('ONBOARD-001R §1 — resolveCompanyLifecycleState (derivation)', () => {
  const base = { status: 'active', profileExists: true, profileEnriched: true, hasActiveMembership: true, journey: null };

  test('archived / suspended win over everything', () => {
    expect(resolveCompanyLifecycleState({ ...base, status: 'archived' }).state).toBe('ARCHIVED');
    expect(resolveCompanyLifecycleState({ ...base, status: 'suspended' }).state).toBe('SUSPENDED');
  });

  test('created shell (no membership, no profile)', () => {
    expect(resolveCompanyLifecycleState({ ...base, profileExists: false, hasActiveMembership: false }).state).toBe('CREATED');
  });

  test('profile enriching vs ready', () => {
    expect(resolveCompanyLifecycleState({ ...base, profileEnriched: false }).state).toBe('PROFILE_ENRICHING');
    expect(resolveCompanyLifecycleState({ ...base, profileEnriched: true }).state).toBe('PROFILE_READY');
  });

  test('onboarding active when an optional stage is touched', () => {
    const journey = journeyWith([
      stage({ id: 'company_review', mandatory: false, status: 'skipped' }),
      stage({ id: 'social_accounts', status: 'pending' }),
    ], false);
    expect(resolveCompanyLifecycleState({ ...base, journey }).state).toBe('ONBOARDING_ACTIVE');
  });

  test('PLATFORM_READY when ready only via skips; ACTIVE when a real integration is live', () => {
    const readyBySkip = journeyWith([
      stage({ id: 'company_review', status: 'skipped' }),
      stage({ id: 'social_accounts', status: 'skipped' }),
    ], true);
    expect(resolveCompanyLifecycleState({ ...base, journey: readyBySkip }).state).toBe('PLATFORM_READY');

    const readyByRealConnect = journeyWith([
      stage({ id: 'company_review', status: 'skipped' }),
      stage({ id: 'social_accounts', status: 'completed' }),
    ], true);
    expect(resolveCompanyLifecycleState({ ...base, journey: readyByRealConnect }).state).toBe('ACTIVE');
  });
});

describe('ONBOARD-001R §8 — Platform Ready explanation', () => {
  test('blocked by a mandatory step', () => {
    const stages = [
      stage({ id: 'profile', mandatory: true, status: 'pending' }),
      stage({ id: 'social_accounts', status: 'pending' }),
    ];
    const r = explainPlatformReadiness(stages, false);
    expect(r.platformReady).toBe(false);
    expect(r.blockingItems.map((b) => b.id)).toContain('profile');
    expect(r.reason).toMatch(/required step/i);
    expect(r.estimatedRemainingSteps).toBe(2);
    expect(r.estimatedRemainingTime).toMatch(/min|h/);
    expect(r.recommendations.length).toBeGreaterThan(0);
  });

  test('optional-only remaining → completion% and remaining items', () => {
    const stages = [
      stage({ id: 'email_verified', mandatory: true, status: 'completed' }),
      stage({ id: 'profile', mandatory: true, status: 'completed' }),
      stage({ id: 'company', mandatory: true, status: 'completed' }),
      stage({ id: 'social_accounts', status: 'pending' }),
    ];
    const r = explainPlatformReadiness(stages, false);
    expect(r.blockingItems).toHaveLength(0);
    expect(r.remainingItems.map((x) => x.id)).toEqual(['social_accounts']);
    expect(r.completionPercentage).toBe(75); // 3/4 resolved
    expect(r.reason).toMatch(/optional step/i);
  });

  test('platform ready → 100% and no blocking/remaining', () => {
    const stages = [
      stage({ id: 'email_verified', mandatory: true, status: 'completed' }),
      stage({ id: 'social_accounts', status: 'skipped' }),
    ];
    const r = explainPlatformReadiness(stages, true);
    expect(r.completionPercentage).toBe(100);
    expect(r.blockingItems).toHaveLength(0);
    expect(r.remainingItems).toHaveLength(0);
    expect(r.reason).toMatch(/complete/i);
  });
});

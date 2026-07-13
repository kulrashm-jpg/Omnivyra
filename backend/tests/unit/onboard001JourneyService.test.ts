/**
 * ONBOARD-001 §1/§6/§11/§12 — canonical onboarding journey authority.
 *
 * Locks: stage derivation over the existing authorities, the single Platform
 * Ready decision, override rules (skip/dismiss can't downgrade completed;
 * mandatory can't be skipped), dependency-blocking, provider-state mapping,
 * current-step resolution, idempotent actions, and deterministic recovery.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../services/activationReadinessService', () => ({
  buildActivationReadiness: jest.fn(),
}));

import { supabase } from '../../db/supabaseClient';
import { buildActivationReadiness } from '../../services/activationReadinessService';
import {
  buildOnboardingJourney,
  applyJourneyStageAction,
  providerJourneyState,
  JOURNEY_STAGES,
} from '../../services/onboardingJourneyService';

const mockFrom = (supabase as any).from as jest.Mock;
const mockActivation = buildActivationReadiness as jest.MockedFunction<typeof buildActivationReadiness>;

/** A chainable, awaitable Supabase-builder mock returning a preset per table. */
function makeChain(data: unknown) {
  const chain: any = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'not', 'upsert', 'update', 'insert']) {
    chain[m] = jest.fn(() => chain);
  }
  chain.maybeSingle = jest.fn(async () => ({ data, error: null }));
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data, error: null });
  return chain;
}

function stub(tables: Record<string, unknown>) {
  mockFrom.mockImplementation((table: string) => makeChain(tables[table] ?? null));
}

function activation(cms: boolean, analytics: boolean) {
  mockActivation.mockResolvedValue({
    companyId: 'org1', generatedAt: 'now', activated: cms && analytics,
    checks: [
      { id: 'cms', label: 'CMS', done: cms, detail: cms ? 'WordPress connected' : 'Not connected yet', nextActionHref: '#', nextActionLabel: 'x' },
      { id: 'analytics', label: 'GA', done: analytics, detail: analytics ? 'GA4 connected' : 'Not connected yet', nextActionHref: '#', nextActionLabel: 'x' },
      { id: 'leads', label: 'Leads', done: false, detail: '', nextActionHref: '#', nextActionLabel: 'x' },
    ],
  });
}

const byId = (j: Awaited<ReturnType<typeof buildOnboardingJourney>>, id: string) =>
  j.stages.find((s) => s.id === id)!;

beforeEach(() => { activation(false, false); });

describe('ONBOARD-001 §1 — stage derivation', () => {
  test('brand-new unverified user: email pending, everything downstream blocked', async () => {
    stub({
      users: { id: 'u1', name: null, is_email_verified: false, active_company_id: null },
      user_company_roles: null,
    });
    const j = await buildOnboardingJourney('u1');
    expect(byId(j, 'email_verified').status).toBe('pending');
    expect(byId(j, 'profile').status).toBe('blocked');       // depends on email_verified
    expect(byId(j, 'company').status).toBe('blocked');
    expect(j.currentStep).toBe('email_verified');
    expect(j.platformReady).toBe(false);
  });

  test('verified + named + company: mandatory stages completed, optionals pending', async () => {
    stub({
      users: { id: 'u1', name: 'Jo', is_email_verified: true, active_company_id: 'org1' },
      user_company_roles: null,
      company_setup_progress: { journey_state: {} },
      social_accounts: [],
      analytics_integrations: [],
    });
    const j = await buildOnboardingJourney('u1');
    expect(byId(j, 'email_verified').status).toBe('completed');
    expect(byId(j, 'profile').status).toBe('completed');
    expect(byId(j, 'company').status).toBe('completed');
    expect(byId(j, 'social_accounts').status).toBe('pending');
    expect(byId(j, 'company_review').status).toBe('pending');
    expect(j.currentStep).toBe('company_review'); // first unresolved in flow order
    expect(j.platformReady).toBe(false);
  });

  test('connected social + GA4 + GSC + CMS reflected as completed', async () => {
    activation(true, true);
    stub({
      users: { id: 'u1', name: 'Jo', is_email_verified: true, active_company_id: 'org1' },
      user_company_roles: null,
      company_setup_progress: { journey_state: {} },
      social_accounts: [{ platform: 'linkedin', is_active: true, connection_state: 'CONNECTED' }],
      analytics_integrations: [
        { provider: 'GA4', status: 'connected', connection_state: 'CONNECTED' },
        { provider: 'GSC', status: 'connected', connection_state: 'CONNECTED' },
      ],
    });
    const j = await buildOnboardingJourney('u1');
    expect(byId(j, 'social_accounts').status).toBe('completed');
    expect(byId(j, 'website_cms').status).toBe('completed');
    expect(byId(j, 'google_analytics').status).toBe('completed');
    expect(byId(j, 'google_search_console').status).toBe('completed');
    // company_review still pending (optional, unresolved) → not platform ready yet
    expect(j.platformReady).toBe(false);
    expect(byId(j, 'company_review').status).toBe('pending');
  });
});

describe('ONBOARD-001 §5/§6 — overrides', () => {
  test('skip/dismiss resolve optional stages; real completion still wins', async () => {
    activation(true, true);
    stub({
      users: { id: 'u1', name: 'Jo', is_email_verified: true, active_company_id: 'org1' },
      user_company_roles: null,
      company_setup_progress: {
        journey_state: {
          company_review: { status: 'dismissed', at: 't', by: 'u1' },
          social_accounts: { status: 'skipped', at: 't', by: 'u1' },
          website_cms: { status: 'skipped', at: 't', by: 'u1' },       // but CMS is live-done
          google_analytics: { status: 'skipped', at: 't', by: 'u1' },  // but GA is live-done
          google_search_console: { status: 'dismissed', at: 't', by: 'u1' },
        },
      },
      social_accounts: [{ platform: 'x', is_active: true, connection_state: 'CONNECTED' }],
      analytics_integrations: [{ provider: 'GA4', status: 'connected', connection_state: 'CONNECTED' }],
    });
    const j = await buildOnboardingJourney('u1');
    // Live-completed stages ignore the skip override:
    expect(byId(j, 'website_cms').status).toBe('completed');
    expect(byId(j, 'google_analytics').status).toBe('completed');
    expect(byId(j, 'social_accounts').status).toBe('completed'); // live connected wins over skip
    // Genuinely-unmet optionals resolved by override:
    expect(byId(j, 'company_review').status).toBe('dismissed');
    expect(byId(j, 'google_search_console').status).toBe('dismissed');
    // §11 — all mandatory completed + all optional resolved → PLATFORM READY.
    expect(j.platformReady).toBe(true);
    expect(j.currentStep).toBe('platform_ready');
  });
});

describe('ONBOARD-001 §11 — Platform Ready is the single decision', () => {
  test('mandatory incomplete → never ready regardless of optionals', async () => {
    stub({
      users: { id: 'u1', name: null, is_email_verified: true, active_company_id: 'org1' }, // no name → profile pending
      user_company_roles: null,
      company_setup_progress: { journey_state: {
        company_review: { status: 'skipped', at: 't', by: 'u1' },
        social_accounts: { status: 'skipped', at: 't', by: 'u1' },
        website_cms: { status: 'skipped', at: 't', by: 'u1' },
        google_analytics: { status: 'skipped', at: 't', by: 'u1' },
        google_search_console: { status: 'skipped', at: 't', by: 'u1' },
      } },
      social_accounts: [],
      analytics_integrations: [],
    });
    const j = await buildOnboardingJourney('u1');
    expect(byId(j, 'profile').status).toBe('pending');
    expect(j.platformReady).toBe(false);
  });
});

describe('ONBOARD-001 §8 — provider state mapping', () => {
  test('9-state connection model maps to journey states', () => {
    expect(providerJourneyState('LIVE_VERIFIED')).toBe('connected');
    expect(providerJourneyState('CONNECTED')).toBe('connected');
    expect(providerJourneyState('TOKEN_EXPIRED')).toBe('expired');
    expect(providerJourneyState('PROVIDER_REAUTH_REQUIRED')).toBe('reconnect_required');
    expect(providerJourneyState('DISCONNECTED')).toBe('failed');
    expect(providerJourneyState('RATE_LIMITED')).toBe('pending');
    expect(providerJourneyState(null)).toBe('pending');
  });

  test('expired social token surfaces reconnect detail but stage stays actionable', async () => {
    stub({
      users: { id: 'u1', name: 'Jo', is_email_verified: true, active_company_id: 'org1' },
      user_company_roles: null,
      company_setup_progress: { journey_state: {} },
      social_accounts: [{ platform: 'linkedin', is_active: true, connection_state: 'TOKEN_EXPIRED' }],
      analytics_integrations: [],
    });
    const j = await buildOnboardingJourney('u1');
    const social = byId(j, 'social_accounts');
    expect(social.providers).toEqual([{ platform: 'linkedin', state: 'expired' }]);
    expect(social.status).toBe('in_progress'); // has a row but none connected
  });
});

describe('ONBOARD-001 §12 — recovery is deterministic', () => {
  test('same inputs → identical journey', async () => {
    stub({
      users: { id: 'u1', name: 'Jo', is_email_verified: true, active_company_id: 'org1' },
      user_company_roles: null,
      company_setup_progress: { journey_state: {} },
      social_accounts: [],
      analytics_integrations: [],
    });
    const a = await buildOnboardingJourney('u1');
    const b = await buildOnboardingJourney('u1');
    expect(a.stages.map((s) => [s.id, s.status])).toEqual(b.stages.map((s) => [s.id, s.status]));
    expect(a.platformReady).toBe(b.platformReady);
    expect(a.currentStep).toBe(b.currentStep);
  });

  test('company via active membership when active_company_id is null', async () => {
    stub({
      users: { id: 'u1', name: 'Jo', is_email_verified: true, active_company_id: null },
      user_company_roles: { company_id: 'org-from-role' },
      company_setup_progress: { journey_state: {} },
      social_accounts: [],
      analytics_integrations: [],
    });
    const j = await buildOnboardingJourney('u1');
    expect(j.companyId).toBe('org-from-role');
    expect(byId(j, 'company').status).toBe('completed');
  });
});

describe('ONBOARD-001 §5/§6 — stage actions', () => {
  test('mandatory stage cannot be skipped or dismissed', async () => {
    stub({ company_setup_progress: { journey_state: {} } });
    const r1 = await applyJourneyStageAction({ companyId: 'org1', userId: 'u1', stage: 'profile', action: 'skip' });
    expect(r1.ok).toBe(false);
    expect(r1.code).toBe('ACTION_NOT_ALLOWED');
    const r2 = await applyJourneyStageAction({ companyId: 'org1', userId: 'u1', stage: 'company', action: 'dismiss' });
    expect(r2.ok).toBe(false);
  });

  test('unknown stage rejected; optional skip accepted (idempotent write)', async () => {
    stub({ company_setup_progress: { journey_state: {} } });
    const bad = await applyJourneyStageAction({ companyId: 'org1', userId: 'u1', stage: 'nope', action: 'skip' });
    expect(bad.code).toBe('UNKNOWN_STAGE');

    const ok = await applyJourneyStageAction({ companyId: 'org1', userId: 'u1', stage: 'social_accounts', action: 'skip' });
    expect(ok.ok).toBe(true);
  });

  test('every stage definition is internally consistent (mandatory ⇒ not skippable/dismissible)', () => {
    for (const s of JOURNEY_STAGES) {
      if (s.mandatory) {
        expect(s.skippable).toBe(false);
        expect(s.dismissible).toBe(false);
      }
    }
  });
});

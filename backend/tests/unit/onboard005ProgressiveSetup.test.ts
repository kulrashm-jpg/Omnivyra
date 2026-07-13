/**
 * ONBOARD-005 — progressive setup experience (server-derived).
 *
 * Locks the additive progressive-setup derivation on the ONE authority:
 * canonical ordering, dependency sequencing (GA4/GSC → Website), per-stage
 * guidance + estimates + resolved dependencies, CMS detection (connected
 * integration only — the crawl never fingerprints CMS), social "detected" vs
 * "connected", Platform Ready as the single completion decision, deterministic
 * resume/refresh, and backward-compatible fields. No new endpoint/API.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../services/activationReadinessService', () => ({
  buildActivationReadiness: jest.fn(),
}));

import { supabase } from '../../db/supabaseClient';
import { buildActivationReadiness } from '../../services/activationReadinessService';
import {
  buildOnboardingJourney,
  JOURNEY_STAGES,
} from '../../services/onboardingJourneyService';

const mockFrom = (supabase as any).from as jest.Mock;
const mockActivation = buildActivationReadiness as jest.MockedFunction<typeof buildActivationReadiness>;

function makeChain(data: unknown) {
  const chain: any = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'not', 'in', 'upsert', 'update', 'insert']) {
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
      { id: 'cms', label: 'CMS', done: cms, detail: cms ? 'A CMS integration is connected.' : 'Not connected yet', nextActionHref: '#', nextActionLabel: 'x' },
      { id: 'analytics', label: 'GA', done: analytics, detail: analytics ? 'GA4 connected' : 'Not connected yet', nextActionHref: '#', nextActionLabel: 'x' },
      { id: 'leads', label: 'Leads', done: false, detail: '', nextActionHref: '#', nextActionLabel: 'x' },
    ],
  });
}

const byId = (j: Awaited<ReturnType<typeof buildOnboardingJourney>>, id: string) =>
  j.stages.find((s) => s.id === id)!;

/** A fully set-up-so-far user (mandatory complete), optionals unresolved. */
function activeUser(extra: Record<string, unknown> = {}) {
  return {
    users: { id: 'u1', name: 'Jo', is_email_verified: true, active_company_id: 'org1' },
    user_company_roles: null,
    company_setup_progress: { journey_state: {} },
    social_accounts: [],
    analytics_integrations: [],
    company_profiles: null,
    company_integrations: [],
    ...extra,
  };
}

beforeEach(() => { activation(false, false); });

describe('ONBOARD-005 §1 — canonical setup ordering', () => {
  test('stages are the single canonical sequence in flow order', () => {
    expect(JOURNEY_STAGES.map((s) => s.id)).toEqual([
      'email_verified', 'profile', 'company', 'company_review',
      'social_accounts', 'website_cms', 'google_analytics', 'google_search_console',
    ]);
  });

  test('currentStep is the first unresolved stage in flow order', async () => {
    stub(activeUser());
    const j = await buildOnboardingJourney('u1');
    expect(j.currentStep).toBe('company_review');
  });
});

describe('ONBOARD-005 §3 — dependency sequencing (GA4/GSC depend on Website)', () => {
  test('GA4 & GSC declare Website / CMS as their dependency', () => {
    expect(byIdDef('google_analytics').dependsOn).toEqual(['website_cms']);
    expect(byIdDef('google_search_console').dependsOn).toEqual(['website_cms']);
  });

  test('GA4/GSC are BLOCKED while Website is unresolved', async () => {
    stub(activeUser());
    const j = await buildOnboardingJourney('u1');
    expect(byId(j, 'website_cms').status).toBe('pending');
    expect(byId(j, 'google_analytics').status).toBe('blocked');
    expect(byId(j, 'google_search_console').status).toBe('blocked');
    // Dependency is surfaced with a human title + met=false.
    expect(byId(j, 'google_analytics').dependencies).toEqual([
      { id: 'website_cms', title: 'Connect your website / CMS', met: false },
    ]);
  });

  test('skipping Website resolves the dependency and unblocks GA4/GSC', async () => {
    stub(activeUser({
      company_setup_progress: { journey_state: { website_cms: { status: 'skipped', at: 't', by: 'u1' } } },
    }));
    const j = await buildOnboardingJourney('u1');
    expect(byId(j, 'website_cms').status).toBe('skipped');
    expect(byId(j, 'google_analytics').status).not.toBe('blocked');
    expect(byId(j, 'google_analytics').dependencies[0].met).toBe(true);
  });
});

describe('ONBOARD-005 §2/§4 — every stage carries guidance + estimate + deps', () => {
  test('each stage has unlocks/blockedWithout guidance and an estimate', async () => {
    stub(activeUser());
    const j = await buildOnboardingJourney('u1');
    for (const s of j.stages) {
      expect(typeof s.guidance.unlocks).toBe('string');
      expect(s.guidance.unlocks.length).toBeGreaterThan(0);
      expect(typeof s.guidance.blockedWithout).toBe('string');
      expect(s.estimatedMinutes).toBeGreaterThan(0);
      expect(Array.isArray(s.dependencies)).toBe(true);
    }
  });
});

describe('ONBOARD-005 §5 — CMS detection (connected integration only)', () => {
  test('a connected CMS integration surfaces its platform name', async () => {
    activation(true, false);
    stub(activeUser({ company_integrations: [{ type: 'wordpress', name: null, status: 'connected' }] }));
    const j = await buildOnboardingJourney('u1');
    const cms = byId(j, 'website_cms');
    expect(cms.status).toBe('completed');
    expect(cms.detail).toBe('WordPress connected');
  });

  test('no CMS integration → generic website copy (never fabricates a platform)', async () => {
    stub(activeUser());
    const j = await buildOnboardingJourney('u1');
    const cms = byId(j, 'website_cms');
    expect(cms.detail).not.toMatch(/WordPress|Shopify|Joomla/);
  });
});

describe('ONBOARD-005 §6 — social status: connected vs detected', () => {
  test('a crawl-discovered social URL with no account reads as "detected", not connected', async () => {
    stub(activeUser({ company_profiles: { linkedin_url: 'https://linkedin.com/company/acme' } }));
    const j = await buildOnboardingJourney('u1');
    const social = byId(j, 'social_accounts');
    expect(social.status).toBe('pending'); // detected never satisfies the stage
    expect(social.providers).toContainEqual({ platform: 'linkedin', state: 'detected' });
    expect(social.detail).toMatch(/Detected/);
  });

  test('a connected account reads as connected; detected-only others still listed', async () => {
    stub(activeUser({
      social_accounts: [{ platform: 'x', is_active: true, connection_state: 'CONNECTED' }],
      company_profiles: { linkedin_url: 'https://linkedin.com/company/acme' },
    }));
    const j = await buildOnboardingJourney('u1');
    const social = byId(j, 'social_accounts');
    expect(social.status).toBe('completed');
    expect(social.providers).toContainEqual({ platform: 'x', state: 'connected' });
    expect(social.providers).toContainEqual({ platform: 'linkedin', state: 'detected' });
  });

  test('a connected platform is never also double-listed as detected', async () => {
    stub(activeUser({
      social_accounts: [{ platform: 'linkedin', is_active: true, connection_state: 'CONNECTED' }],
      company_profiles: { linkedin_url: 'https://linkedin.com/company/acme' },
    }));
    const j = await buildOnboardingJourney('u1');
    const social = byId(j, 'social_accounts');
    const linkedin = social.providers!.filter((p) => p.platform === 'linkedin');
    expect(linkedin).toEqual([{ platform: 'linkedin', state: 'connected' }]);
  });
});

describe('ONBOARD-005 §7 — Platform Ready is the single completion authority', () => {
  test('all mandatory complete + all optional resolved → platformReady', async () => {
    activation(true, true);
    stub(activeUser({
      company_setup_progress: { journey_state: {
        company_review: { status: 'skipped', at: 't', by: 'u1' },
        social_accounts: { status: 'skipped', at: 't', by: 'u1' },
        google_search_console: { status: 'dismissed', at: 't', by: 'u1' },
      } },
      social_accounts: [],
      analytics_integrations: [{ provider: 'GA4', status: 'connected', connection_state: 'CONNECTED' }],
    }));
    const j = await buildOnboardingJourney('u1');
    expect(j.platformReady).toBe(true);
    expect(j.currentStep).toBe('platform_ready');
  });
});

describe('ONBOARD-005 §8 — resume/refresh are deterministic', () => {
  test('identical inputs produce identical journeys including the new fields', async () => {
    stub(activeUser({ company_profiles: { linkedin_url: 'https://l/acme' } }));
    const a = await buildOnboardingJourney('u1');
    const b = await buildOnboardingJourney('u1');
    const shape = (j: typeof a) => j.stages.map((s) => [s.id, s.status, s.estimatedMinutes, JSON.stringify(s.dependencies), JSON.stringify(s.providers ?? null)]);
    expect(shape(a)).toEqual(shape(b));
  });
});

describe('ONBOARD-005 §9 — backward compatibility (additive only)', () => {
  test('the original stage contract fields are all still present', async () => {
    stub(activeUser());
    const j = await buildOnboardingJourney('u1');
    const s = byId(j, 'website_cms');
    for (const k of ['id', 'title', 'why', 'mandatory', 'skippable', 'dismissible', 'dependsOn', 'href', 'status', 'detail']) {
      expect(s).toHaveProperty(k);
    }
    // The readiness contract is unchanged.
    expect(j.readiness).toHaveProperty('completionPercentage');
    expect(j.readiness).toHaveProperty('recommendations');
  });
});

function byIdDef(id: string) {
  return JOURNEY_STAGES.find((s) => s.id === id)!;
}

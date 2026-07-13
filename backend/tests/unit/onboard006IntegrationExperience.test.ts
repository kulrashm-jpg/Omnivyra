/**
 * ONBOARD-006 — the canonical Integration Experience read-model.
 *
 * Locks that the experience is a PURE composition over the onboarding journey
 * (the single status + dependency + Platform Ready authority): status is
 * relabelled from the authority (never inferred), dependencies come from the
 * journey stage, providers are reused (never fabricated), ordering + Platform
 * Ready are read from the authority, and resume/refresh are deterministic.
 */

import { buildIntegrationExperience } from '../../../lib/integrations/integrationExperience';
import { INTEGRATION_CATALOG, CATEGORY_ORDER } from '../../../lib/integrations/integrationCatalog';
import type { OnboardingJourney, JourneyStage } from '../../../hooks/useOnboardingJourney';

/** Minimal journey stage factory. */
function stage(over: Partial<JourneyStage> & { id: string }): JourneyStage {
  return {
    id: over.id, title: over.title ?? over.id, why: '', mandatory: false,
    skippable: true, dismissible: true, dependsOn: [], href: '#',
    status: over.status ?? 'pending', detail: over.detail ?? null,
    providers: over.providers, estimatedMinutes: over.estimatedMinutes ?? 3,
    dependencies: over.dependencies ?? [], guidance: over.guidance ?? { unlocks: 'x', blockedWithout: 'y' },
  };
}

function journey(over: Partial<OnboardingJourney> = {}): OnboardingJourney {
  const stages = over.stages ?? [
    stage({ id: 'social_accounts', status: 'pending', dependencies: [{ id: 'company', title: 'Set up your company', met: true }] }),
    stage({ id: 'website_cms', status: 'pending', dependencies: [{ id: 'company', title: 'Set up your company', met: true }] }),
    stage({ id: 'google_analytics', status: 'blocked', dependencies: [{ id: 'website_cms', title: 'Connect your website / CMS', met: false }] }),
    stage({ id: 'google_search_console', status: 'blocked', dependencies: [{ id: 'website_cms', title: 'Connect your website / CMS', met: false }] }),
  ];
  return {
    companyId: 'org1', stages, currentStep: 'social_accounts', platformReady: false,
    readiness: {
      platformReady: false, reason: '', blockingItems: [], remainingItems: [],
      completionPercentage: 42, estimatedRemainingTime: '~10 min',
      recommendations: over.readiness?.recommendations ?? [
        { id: 'website_cms', title: 'Website', why: '', href: '#' },
        { id: 'social_accounts', title: 'Social', why: '', href: '#' },
      ],
    },
    ...over,
  };
}

const find = (exp: ReturnType<typeof buildIntegrationExperience>, id: string) =>
  exp.categories.flatMap((c) => c.integrations).find((i) => i.id === id)!;

describe('ONBOARD-006 §3 — status comes from the authority (relabelled, never inferred)', () => {
  test('connected / pending / blocked stage statuses map to canonical statuses', () => {
    const exp = buildIntegrationExperience(journey({
      stages: [
        stage({ id: 'social_accounts', status: 'pending' }),
        stage({ id: 'website_cms', status: 'completed', providers: [{ platform: 'WordPress', state: 'connected' }] }),
        stage({ id: 'google_analytics', status: 'in_progress', dependencies: [{ id: 'website_cms', title: 'W', met: true }] }),
        stage({ id: 'google_search_console', status: 'blocked', dependencies: [{ id: 'website_cms', title: 'W', met: false }] }),
      ],
    }));
    expect(find(exp, 'website_cms').status).toBe('connected');
    expect(find(exp, 'website_cms').connectedProvider).toBe('WordPress');
    expect(find(exp, 'google_analytics').status).toBe('pending');
    expect(find(exp, 'google_search_console').status).toBe('blocked');
  });

  test('social per-platform status is read from the stage providers[] (connected/detected/expired)', () => {
    const exp = buildIntegrationExperience(journey({
      stages: [
        stage({ id: 'social_accounts', status: 'in_progress', providers: [
          { platform: 'linkedin', state: 'connected' },
          { platform: 'x', state: 'detected' },
          { platform: 'facebook', state: 'expired' },
        ] }),
        stage({ id: 'website_cms', status: 'pending' }),
        stage({ id: 'google_analytics', status: 'blocked', dependencies: [{ id: 'website_cms', title: 'W', met: false }] }),
        stage({ id: 'google_search_console', status: 'blocked', dependencies: [{ id: 'website_cms', title: 'W', met: false }] }),
      ],
    }));
    expect(find(exp, 'social_linkedin').status).toBe('connected');
    expect(find(exp, 'social_x').status).toBe('detected');
    expect(find(exp, 'social_facebook').status).toBe('expired');
    // A social platform with no provider entry and an actionable stage → available.
    expect(find(exp, 'social_youtube').status).toBe('available');
  });

  test('catalog-only integrations (no authority signal) read as Available', () => {
    const exp = buildIntegrationExperience(journey());
    expect(find(exp, 'hubspot').status).toBe('available');
    expect(find(exp, 'mailchimp').status).toBe('available');
    expect(find(exp, 'google_ads').status).toBe('available');
  });

  test('a null journey degrades to all-Available and platformReady false', () => {
    const exp = buildIntegrationExperience(null);
    expect(exp.platformReady).toBe(false);
    expect(exp.categories.flatMap((c) => c.integrations).every((i) => i.status === 'available')).toBe(true);
  });
});

describe('ONBOARD-006 §4 — dependencies come from the journey stage (one authority)', () => {
  test('depends-on / unlocks / blocked-by are surfaced from the stage', () => {
    const exp = buildIntegrationExperience(journey());
    const ga = find(exp, 'google_analytics');
    expect(ga.dependsOn).toEqual(['Connect your website / CMS']);
    expect(ga.blockedBy).toEqual(['Connect your website / CMS']);
    expect(ga.unlocks).toBe('x');
  });
});

describe('ONBOARD-006 §2/§6 — categories & provider metadata', () => {
  test('every category group is in canonical order and non-empty', () => {
    const exp = buildIntegrationExperience(journey());
    const cats = exp.categories.map((c) => c.category);
    // Order is a subsequence of CATEGORY_ORDER.
    const idx = cats.map((c) => CATEGORY_ORDER.indexOf(c));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(cats).toEqual(expect.arrayContaining(['CMS', 'Analytics', 'Search', 'Social', 'Advertising', 'CRM', 'Communication']));
  });

  test('providers are reused from the catalog, never fabricated', () => {
    const exp = buildIntegrationExperience(journey());
    const ids = exp.categories.flatMap((c) => c.integrations).map((i) => i.id).sort();
    expect(ids).toEqual(INTEGRATION_CATALOG.map((d) => d.id).sort());
    expect(find(exp, 'website_cms').supportedProviders).toEqual(expect.arrayContaining(['WordPress', 'Shopify']));
  });
});

describe('ONBOARD-006 §5 — progressive experience (ordering from the authority)', () => {
  test('nextRecommended follows the authority recommendation order, one per stage', () => {
    const exp = buildIntegrationExperience(journey({
      readiness: {
        platformReady: false, reason: '', blockingItems: [], remainingItems: [],
        completionPercentage: 0, estimatedRemainingTime: '',
        recommendations: [
          { id: 'website_cms', title: 'W', why: '', href: '#' },
          { id: 'social_accounts', title: 'S', why: '', href: '#' },
        ],
      },
    }));
    expect(exp.nextRecommended[0].id).toBe('website_cms');
    expect(exp.nextRecommended.some((i) => i.category === 'Social')).toBe(true);
  });

  test('recentlyConnected lists connected integrations; remaining excludes them', () => {
    const exp = buildIntegrationExperience(journey({
      stages: [
        stage({ id: 'social_accounts', status: 'completed', providers: [{ platform: 'linkedin', state: 'connected' }] }),
        stage({ id: 'website_cms', status: 'completed', providers: [{ platform: 'WordPress', state: 'connected' }] }),
        stage({ id: 'google_analytics', status: 'pending', dependencies: [{ id: 'website_cms', title: 'W', met: true }] }),
        stage({ id: 'google_search_console', status: 'pending', dependencies: [{ id: 'website_cms', title: 'W', met: true }] }),
      ],
    }));
    const connectedIds = exp.recentlyConnected.map((i) => i.id);
    expect(connectedIds).toContain('website_cms');
    expect(connectedIds).toContain('social_linkedin');
    expect(exp.remaining.every((i) => i.status !== 'connected')).toBe(true);
  });

  test('platform benefits are deterministic and non-empty (no AI)', () => {
    const a = buildIntegrationExperience(journey()).platformBenefits;
    const b = buildIntegrationExperience(journey()).platformBenefits;
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe('ONBOARD-006 §7 — Platform Ready is read from the authority, never computed', () => {
  test('platformReady + completion mirror the journey exactly', () => {
    const exp = buildIntegrationExperience(journey({ platformReady: true }));
    expect(exp.platformReady).toBe(true);
    expect(exp.completionPercentage).toBe(42);
  });
});

describe('ONBOARD-006 §8 — resume/refresh are deterministic', () => {
  test('identical journeys yield identical experiences', () => {
    const shape = (e: ReturnType<typeof buildIntegrationExperience>) =>
      JSON.stringify(e.categories.flatMap((c) => c.integrations).map((i) => [i.id, i.status, i.dependsOn, i.blockedBy]));
    expect(shape(buildIntegrationExperience(journey()))).toBe(shape(buildIntegrationExperience(journey())));
  });
});

describe('ONBOARD-006 §9 — backward compatibility', () => {
  test('the read-model is pure — it never mutates the journey', () => {
    const j = journey();
    const snapshot = JSON.stringify(j);
    buildIntegrationExperience(j);
    expect(JSON.stringify(j)).toBe(snapshot);
  });
});

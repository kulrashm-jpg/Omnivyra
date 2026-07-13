/**
 * ONBOARD-007 — the canonical Platform Activation read-model.
 *
 * Locks that activation is a PURE composition over the existing authorities
 * (onboarding journey + integration experience): capability availability derives
 * only from existing integration/onboarding signals, unavailable capabilities
 * explain their missing prerequisite + what they unlock, Platform Ready is read
 * (never recomputed), optional improvements never block, and the model is
 * deterministic and non-mutating.
 */

import { buildPlatformActivation } from '../../../lib/activation/platformActivation';
import { CAPABILITY_CATALOG } from '../../../lib/activation/capabilityCatalog';
import type { OnboardingJourney, JourneyStage } from '../../../hooks/useOnboardingJourney';

function stage(over: Partial<JourneyStage> & { id: string }): JourneyStage {
  return {
    id: over.id, title: over.title ?? over.id, why: '', mandatory: false,
    skippable: true, dismissible: true, dependsOn: [], href: '#',
    status: over.status ?? 'pending', detail: over.detail ?? null,
    providers: over.providers, estimatedMinutes: over.estimatedMinutes ?? 3,
    dependencies: over.dependencies ?? [], guidance: over.guidance ?? { unlocks: 'x', blockedWithout: 'y' },
  };
}

/** Journey with company complete; integrations tunable via stage overrides. */
function journey(stages: JourneyStage[], over: Partial<OnboardingJourney> = {}): OnboardingJourney {
  return {
    companyId: 'org1',
    stages: [
      stage({ id: 'email_verified', status: 'completed' }),
      stage({ id: 'profile', status: 'completed' }),
      stage({ id: 'company', status: 'completed' }),
      ...stages,
    ],
    currentStep: 'company_review', platformReady: false,
    readiness: {
      platformReady: false, reason: '', blockingItems: [], remainingItems: [],
      completionPercentage: 55, estimatedRemainingTime: '~8 min',
      recommendations: over.readiness?.recommendations ?? [],
    },
    ...over,
  };
}

const INTEGRATION_STAGES_UNSET = [
  stage({ id: 'company_review', status: 'pending' }),
  stage({ id: 'social_accounts', status: 'pending' }),
  stage({ id: 'website_cms', status: 'pending' }),
  stage({ id: 'google_analytics', status: 'blocked', dependencies: [{ id: 'website_cms', title: 'Connect your website / CMS', met: false }] }),
  stage({ id: 'google_search_console', status: 'blocked', dependencies: [{ id: 'website_cms', title: 'Connect your website / CMS', met: false }] }),
];

const cap = (a: ReturnType<typeof buildPlatformActivation>, id: string) => a.capabilities.find((c) => c.id === id)!;

describe('ONBOARD-007 §2 — capability availability from existing signals', () => {
  test('with company only: core capabilities available, integration-gated ones need setup', () => {
    const a = buildPlatformActivation(journey(INTEGRATION_STAGES_UNSET));
    // Company-only capabilities are available.
    expect(cap(a, 'content_writer').status).toBe('available');
    expect(cap(a, 'competitor_intelligence').status).toBe('available');
    // Publishing needs a channel → requires setup.
    expect(cap(a, 'publishing').status).toBe('requires_setup');
    // Analytics requires GA4, which is blocked (website not done) → unavailable.
    expect(cap(a, 'analytics').status).toBe('unavailable');
    // Growth Intelligence works but analytics enhances → limited.
    expect(cap(a, 'growth_intelligence').status).toBe('limited');
  });

  test('connecting a channel makes Publishing available and Campaign Planning full', () => {
    const a = buildPlatformActivation(journey([
      stage({ id: 'company_review', status: 'pending' }),
      stage({ id: 'social_accounts', status: 'completed', providers: [{ platform: 'linkedin', state: 'connected' }] }),
      stage({ id: 'website_cms', status: 'pending' }),
      stage({ id: 'google_analytics', status: 'pending' }),
      stage({ id: 'google_search_console', status: 'pending' }),
    ]));
    expect(cap(a, 'publishing').status).toBe('available');
    expect(cap(a, 'campaign_planning').status).toBe('available');
  });

  test('connecting GA4 makes Analytics available and Growth Intelligence full', () => {
    const a = buildPlatformActivation(journey([
      stage({ id: 'company_review', status: 'completed' }),
      stage({ id: 'social_accounts', status: 'completed', providers: [{ platform: 'x', state: 'connected' }] }),
      stage({ id: 'website_cms', status: 'completed', providers: [{ platform: 'WordPress', state: 'connected' }] }),
      stage({ id: 'google_analytics', status: 'completed' }),
      stage({ id: 'google_search_console', status: 'completed' }),
    ]));
    expect(cap(a, 'analytics').status).toBe('available');
    expect(cap(a, 'growth_intelligence').status).toBe('available');
    expect(cap(a, 'seo').status).toBe('available');
  });

  test('before company exists, capabilities require setup (not fabricated available)', () => {
    const a = buildPlatformActivation({
      companyId: null,
      stages: [stage({ id: 'email_verified', status: 'completed' }), stage({ id: 'profile', status: 'pending' }), stage({ id: 'company', status: 'pending' })],
      currentStep: 'company', platformReady: false,
      readiness: { platformReady: false, reason: '', blockingItems: [], remainingItems: [], completionPercentage: 10, estimatedRemainingTime: '', recommendations: [] },
    });
    expect(cap(a, 'content_writer').status).toBe('requires_setup');
    expect(a.capabilities.every((c) => c.status !== 'available')).toBe(true);
  });
});

describe('ONBOARD-007 §4 — unlock explanations', () => {
  test('an unavailable capability names its missing prerequisite and what it unlocks', () => {
    const a = buildPlatformActivation(journey(INTEGRATION_STAGES_UNSET));
    const analytics = cap(a, 'analytics');
    expect(analytics.missingPrerequisites).toContain('Google Analytics (GA4)');
    expect(analytics.unlocks).toMatch(/GA4|traffic|performance/i);
    expect(analytics.actionHref).toBeTruthy();
  });
});

describe('ONBOARD-007 §2 — Recommended overlay follows the authority', () => {
  test('a not-yet-available capability whose prerequisite is authority-recommended reads Recommended', () => {
    const a = buildPlatformActivation(journey([
      stage({ id: 'company_review', status: 'pending' }),
      stage({ id: 'social_accounts', status: 'pending' }),
      stage({ id: 'website_cms', status: 'pending' }),
      stage({ id: 'google_analytics', status: 'pending' }),
      stage({ id: 'google_search_console', status: 'pending' }),
    ], { readiness: {
      platformReady: false, reason: '', blockingItems: [], remainingItems: [], completionPercentage: 0, estimatedRemainingTime: '',
      recommendations: [{ id: 'google_analytics', title: 'GA4', why: '', href: '#' }],
    } }));
    expect(cap(a, 'analytics').status).toBe('recommended');
    expect(cap(a, 'analytics').recommended).toBe(true);
  });
});

describe('ONBOARD-007 §5 — optional improvements (never blocking)', () => {
  test('surfaces connect-more + profile/brand improvements, none marked blocking', () => {
    const a = buildPlatformActivation(journey(INTEGRATION_STAGES_UNSET));
    const ids = a.optionalImprovements.map((o) => o.id);
    expect(ids).toContain('improve_company_profile');
    expect(ids).toContain('upload_brand_assets');
    expect(ids.some((i) => i.startsWith('connect_'))).toBe(true);
    // Optional improvements are a separate list — they never appear as capabilities.
    expect(a.capabilities.some((c) => c.id === 'improve_company_profile')).toBe(false);
  });
});

describe('ONBOARD-007 §3 — dashboard sections', () => {
  test('recentlyUnlocked lists operational capabilities; nextRecommended is authority-ordered', () => {
    const a = buildPlatformActivation(journey(INTEGRATION_STAGES_UNSET, {
      readiness: { platformReady: false, reason: '', blockingItems: [], remainingItems: [], completionPercentage: 0, estimatedRemainingTime: '',
        recommendations: [{ id: 'website_cms', title: 'W', why: '', href: '#' }] },
    }));
    expect(a.recentlyUnlocked.every((c) => c.status === 'available' || c.status === 'limited')).toBe(true);
    expect(a.recentlyUnlocked.length).toBeGreaterThan(0);
    expect(a.nextRecommended[0]?.integrationId).toBe('website_cms');
  });
});

describe('ONBOARD-007 §6/§7 — Platform Ready pass-through, purity', () => {
  test('platformReady + completion mirror the journey; nothing is recomputed', () => {
    const a = buildPlatformActivation(journey(INTEGRATION_STAGES_UNSET, { platformReady: true }));
    expect(a.platformReady).toBe(true);
    expect(a.completionPercentage).toBe(55);
  });

  test('the read-model never mutates the journey', () => {
    const j = journey(INTEGRATION_STAGES_UNSET);
    const snap = JSON.stringify(j);
    buildPlatformActivation(j);
    expect(JSON.stringify(j)).toBe(snap);
  });

  test('null journey → all capabilities require setup, platformReady false', () => {
    const a = buildPlatformActivation(null);
    expect(a.platformReady).toBe(false);
    expect(a.capabilities).toHaveLength(CAPABILITY_CATALOG.length);
    expect(a.capabilities.every((c) => c.status === 'requires_setup')).toBe(true);
  });
});

describe('ONBOARD-007 §7/§9 — determinism & backward compatibility', () => {
  test('identical journeys yield identical activation', () => {
    const shape = (a: ReturnType<typeof buildPlatformActivation>) =>
      JSON.stringify(a.capabilities.map((c) => [c.id, c.status, c.missingPrerequisites]));
    expect(shape(buildPlatformActivation(journey(INTEGRATION_STAGES_UNSET))))
      .toBe(shape(buildPlatformActivation(journey(INTEGRATION_STAGES_UNSET))));
  });
});

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js edge middleware — routing rules only, no auth blocking.
 *
 * Auth enforcement lives in individual API route handlers via
 * getSupabaseUserFromRequest(). We cannot enforce Bearer-token auth here
 * because many pages use plain fetch() (sessions are in localStorage, not
 * cookies) and updating every call site is a separate migration.
 *
 * What this middleware DOES handle:
 *   • Content-Architect session: scoped to allowed API prefixes only
 *   • OAuth routes: always pass-through (browser navigates without auth headers)
 *   • Everything else: pass-through (routes self-protect)
 */

const CONTENT_ARCHITECT_API_PREFIXES = [
  '/api/company-profile',
  '/api/campaigns',
  '/api/recommendations/',
  '/api/activity-workspace/',
  '/api/content-architect/',
  '/api/content/',
  '/api/intelligence/',
  '/api/executive/',
];

type CompatibilityBridgeObservation = {
  bridge: '/content-creation' | '/content-studio' | '/command-center/bolt-text-strategy';
  canonical: '/posts/create' | '/command-center/bolt-text';
  key: 'content_creation' | 'content_studio' | 'bolt_text_strategy';
  retirementPhase: 'soft-retirement';
};

const COMPATIBILITY_BRIDGE_OBSERVABILITY: CompatibilityBridgeObservation[] = [
  {
    bridge: '/content-creation',
    canonical: '/posts/create',
    key: 'content_creation',
    retirementPhase: 'soft-retirement',
  },
  {
    bridge: '/content-studio',
    canonical: '/posts/create',
    key: 'content_studio',
    retirementPhase: 'soft-retirement',
  },
  {
    bridge: '/command-center/bolt-text-strategy',
    canonical: '/command-center/bolt-text',
    key: 'bolt_text_strategy',
    retirementPhase: 'soft-retirement',
  },
];

const COMPATIBILITY_ARRIVAL_COOKIE = 'compat_bridge_pending_arrival';

function allowContentArchitectPath(pathname: string): boolean {
  return CONTENT_ARCHITECT_API_PREFIXES.some((prefix) => {
    const base = prefix.replace(/\/$/, '');
    return pathname === base || pathname.startsWith(base + '/');
  });
}

function findCompatibilityBridge(pathname: string): CompatibilityBridgeObservation | null {
  return COMPATIBILITY_BRIDGE_OBSERVABILITY.find((bridge) => {
    if (pathname === bridge.bridge) return true;
    return bridge.bridge === '/content-studio' && pathname.startsWith('/content-studio/');
  }) || null;
}

function observeCompatibilityBridge(request: NextRequest, bridge: CompatibilityBridgeObservation) {
  const referrer = request.headers.get('referer') || '';
  const hasExternalReferrer = Boolean(referrer) && !referrer.includes(request.nextUrl.host);
  const hasReferrer = Boolean(referrer);
  const hasCampaignContinuation = request.nextUrl.searchParams.has('campaignId');
  const hasOnboardingContinuation = request.nextUrl.searchParams.has('onboarding') || request.nextUrl.searchParams.has('source');
  const hasQueryContinuation = request.nextUrl.searchParams.size > 0;
  const hasRuntimeRestoration = request.cookies.has('content_architect_session')
    || request.cookies.has('bolt-text-strategy-state');
  const bridgeUsageCookie = `compat_bridge_hits_${bridge.key}`;
  const repeatedUsageCount = Number(request.cookies.get(bridgeUsageCookie)?.value || '0');
  const nextRepeatedUsageCount = Number.isFinite(repeatedUsageCount) ? repeatedUsageCount + 1 : 1;
  const staleBookmarkClassification = hasReferrer ? 'referrer-present' : 'direct-or-bookmark';
  const externalReferrerClassification = hasExternalReferrer
    ? 'external-referrer'
    : hasReferrer
      ? 'internal-referrer'
      : 'no-referrer';
  const bridgeDependencyScore = [
    hasCampaignContinuation,
    hasOnboardingContinuation,
    hasRuntimeRestoration,
    hasExternalReferrer,
    nextRepeatedUsageCount > 1,
  ].filter(Boolean).length;
  const retirementConfidenceScore = Math.max(0, 100 - bridgeDependencyScore * 20);
  const inactivityWindowScore = hasRuntimeRestoration || nextRepeatedUsageCount > 1 ? 50 : 80;

  console.info('[compatibility-bridge-observed]', {
    bridge: bridge.bridge,
    canonical: bridge.canonical,
    redirectSource: request.nextUrl.pathname,
    redirectTarget: bridge.canonical,
    path: request.nextUrl.pathname,
    phase: bridge.retirementPhase,
    hasQueryContinuation,
    hasCampaignContinuation,
    hasOnboardingContinuation,
    hasRuntimeRestoration,
    hasExternalReferrer,
    externalReferrerClassification,
    staleBookmarkClassification,
    repeatedBridgeUsage: nextRepeatedUsageCount > 1,
    repeatedUsageCount: nextRepeatedUsageCount,
    retirementConfidenceScore,
    inactivityWindowScore,
    bridgeDependencyScore,
    referrerHost: (() => {
      try {
        return referrer ? new URL(referrer).host : null;
      } catch {
        return null;
      }
    })(),
  });

  return {
    hasCampaignContinuation,
    hasOnboardingContinuation,
    hasQueryContinuation,
    hasRuntimeRestoration,
    hasExternalReferrer,
    externalReferrerClassification,
    staleBookmarkClassification,
    repeatedUsageCount: nextRepeatedUsageCount,
    repeatedBridgeUsage: nextRepeatedUsageCount > 1,
    retirementConfidenceScore,
    inactivityWindowScore,
    bridgeDependencyScore,
    bridgeUsageCookie,
  };
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const pendingArrival = request.cookies.get(COMPATIBILITY_ARRIVAL_COOKIE)?.value;
  if (pendingArrival && (pathname === '/posts/create' || pathname === '/command-center/bolt-text')) {
    console.info('[compatibility-bridge-canonical-arrival]', {
      canonical: pathname,
      pendingArrival,
      arrivalSuccess: true,
    });
    const response = NextResponse.next();
    response.cookies.delete(COMPATIBILITY_ARRIVAL_COOKIE);
    response.headers.set('x-compatibility-canonical-arrival', 'true');
    return response;
  }

  const compatibilityBridge = findCompatibilityBridge(pathname);
  if (compatibilityBridge) {
    const observation = observeCompatibilityBridge(request, compatibilityBridge);
    const destination = request.nextUrl.clone();
    destination.pathname = compatibilityBridge.canonical;
    const response = NextResponse.redirect(destination);
    response.headers.set('x-compatibility-bridge', compatibilityBridge.bridge);
    response.headers.set('x-compatibility-bridge-phase', compatibilityBridge.retirementPhase);
    response.headers.set('x-compatibility-canonical-route', compatibilityBridge.canonical);
    response.headers.set('x-compatibility-redirect-source', pathname);
    response.headers.set('x-compatibility-redirect-target', compatibilityBridge.canonical);
    response.headers.set('x-compatibility-query-continuation', String(observation.hasQueryContinuation));
    response.headers.set('x-compatibility-external-referrer', observation.externalReferrerClassification);
    response.headers.set('x-compatibility-stale-bookmark', observation.staleBookmarkClassification);
    response.headers.set('x-compatibility-onboarding-continuation', String(observation.hasOnboardingContinuation));
    response.headers.set('x-compatibility-runtime-restoration', String(observation.hasRuntimeRestoration));
    response.headers.set('x-compatibility-repeated-usage-count', String(observation.repeatedUsageCount));
    response.headers.set('x-compatibility-retirement-confidence', String(observation.retirementConfidenceScore));
    response.headers.set('x-compatibility-inactivity-window-score', String(observation.inactivityWindowScore));
    response.headers.set('x-compatibility-dependency-score', String(observation.bridgeDependencyScore));
    response.cookies.set(observation.bridgeUsageCookie, String(observation.repeatedUsageCount), {
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
      sameSite: 'lax',
    });
    response.cookies.set(
      COMPATIBILITY_ARRIVAL_COOKIE,
      `${compatibilityBridge.key}:${compatibilityBridge.canonical}:${Date.now()}`,
      {
        maxAge: 60,
        path: '/',
        sameSite: 'lax',
      },
    );
    return response;
  }

  if (!pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  // Content Architect session: restrict to scoped APIs only.
  // This is the one case where middleware must actively block.
  const contentArchitectSession = request.cookies.get('content_architect_session');
  if (contentArchitectSession?.value === '1') {
    if (allowContentArchitectPath(pathname)) return NextResponse.next();
    if (pathname === '/api/super-admin/companies') return NextResponse.next();
    if (pathname === '/api/super-admin/login' || pathname === '/api/super-admin/content-architect-login') {
      return NextResponse.next();
    }
    // Block Content Architect from everything else
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // All other requests pass through — API routes handle their own auth.
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/:path*',
    '/content-creation',
    '/content-studio',
    '/content-studio/:path*',
    '/command-center/bolt-text-strategy',
    '/posts/create',
    '/command-center/bolt-text',
  ],
};

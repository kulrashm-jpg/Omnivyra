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

function allowContentArchitectPath(pathname: string): boolean {
  return CONTENT_ARCHITECT_API_PREFIXES.some((prefix) => {
    const base = prefix.replace(/\/$/, '');
    return pathname === base || pathname.startsWith(base + '/');
  });
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

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
  matcher: ['/api/:path*'],
};

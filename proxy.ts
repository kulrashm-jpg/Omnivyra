import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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
  if (!request.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.next();
  }
  const pathname = request.nextUrl.pathname;
  // Login endpoints: no session required
  if (pathname === '/api/super-admin/login' || pathname === '/api/super-admin/content-architect-login') {
    return NextResponse.next();
  }
  // Public blog: listing, article by slug, RSS, sitemap — no auth required
  if (pathname === '/api/blog' || pathname.startsWith('/api/blog/')) {
    return NextResponse.next();
  }
  // Super admin first: if legacy super-admin cookie is set, allow super-admin APIs and all external-apis (catalog, test, presets, etc.)
  const superAdminSession = request.cookies.get('super_admin_session');
  if (superAdminSession?.value === '1') {
    if (pathname.startsWith('/api/super-admin/')) return NextResponse.next();
    if (pathname === '/api/admin/audit-logs') return NextResponse.next();
    if (pathname.startsWith('/api/admin/blog')) return NextResponse.next();
    if (pathname === '/api/external-apis' || pathname.startsWith('/api/external-apis/'))
      return NextResponse.next();
  }
  // Content Architect: allow scoped APIs + /api/super-admin/companies (handler grants them access)
  const contentArchitectSession = request.cookies.get('content_architect_session');
  if (contentArchitectSession?.value === '1') {
    if (allowContentArchitectPath(pathname)) return NextResponse.next();
    if (pathname === '/api/super-admin/companies') return NextResponse.next();
    // Content Architect must not access other super-admin APIs
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const cookieToken = request.cookies.get('sb-access-token');
  const authHeader = request.headers.get('authorization') || '';
  const hasBearerToken = authHeader.startsWith('Bearer ') && authHeader.slice(7).trim().length > 0;
  if (!cookieToken && !hasBearerToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};

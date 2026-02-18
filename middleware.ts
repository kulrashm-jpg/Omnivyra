import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.next();
  }
  // Super admin: login is credential-based (no session yet); other routes use super_admin_session cookie
  if (request.nextUrl.pathname === '/api/super-admin/login') {
    return NextResponse.next();
  }
  const superAdminSession = request.cookies.get('super_admin_session');
  if (superAdminSession?.value === '1') {
    if (request.nextUrl.pathname.startsWith('/api/super-admin/')) return NextResponse.next();
    if (request.nextUrl.pathname === '/api/admin/audit-logs') return NextResponse.next();
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

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isSuperAdminRoute = pathname.startsWith('/super-admin');
  const isSuperAdminLogin = pathname === '/super-admin/login';

  if (isSuperAdminRoute && !isSuperAdminLogin) {
    const hasSession = req.cookies.get('super_admin_session')?.value === '1';
    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = '/super-admin/login';
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/super-admin/:path*'],
};

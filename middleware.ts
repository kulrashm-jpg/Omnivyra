import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.next();
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

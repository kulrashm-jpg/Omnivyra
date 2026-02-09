import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isPlatformSuperAdmin } from './backend/services/rbacService';

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const extractAccessTokenFromCookies = (req: NextRequest): string | null => {
  const directToken = req.cookies.get('sb-access-token')?.value;
  if (directToken) return directToken;

  const cookies = typeof req.cookies.getAll === 'function' ? req.cookies.getAll() : [];
  for (const { name, value } of cookies) {
    if (!name.startsWith('sb-') || !name.endsWith('-auth-token')) {
      continue;
    }
    try {
      const parsed = JSON.parse(value);
      if (parsed?.access_token) {
        return String(parsed.access_token);
      }
    } catch {
      // ignore malformed cookie
    }
  }

  return null;
};

const extractAccessToken = (req: NextRequest): string | null => {
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) return token;
  }
  return extractAccessTokenFromCookies(req);
};

const getSupabaseUserId = async (req: NextRequest): Promise<string | null> => {
  const token = extractAccessToken(req);
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return null;
  }
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data?.id || null;
  } catch {
    return null;
  }
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isSuperAdminRoute = pathname.startsWith('/super-admin');
  const isSuperAdminLogin = pathname === '/super-admin/login';

  if (isSuperAdminRoute && !isSuperAdminLogin) {
    const userId = await getSupabaseUserId(req);
    if (userId) {
      const isAdmin = await isPlatformSuperAdmin(userId);
      if (isAdmin) {
        return NextResponse.next();
      }
      const url = req.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }

    const hasSession = req.cookies.get('super_admin_session')?.value === '1';
    if (hasSession) {
      console.debug('SUPER_ADMIN_LEGACY_SESSION', { path: pathname });
      return NextResponse.next();
    }

    const url = req.nextUrl.clone();
    url.pathname = '/super-admin/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/super-admin/:path*'],
};

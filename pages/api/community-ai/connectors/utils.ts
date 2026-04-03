import type { NextApiRequest, NextApiResponse } from 'next';
import { createServerClient } from '@supabase/ssr';
import { getUserRole } from '../../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../../backend/services/rbac/communityAiCapabilities';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { supabase } from '../../../../backend/db/supabaseClient';

/**
 * Returns the OAuth callback URL for a Community AI connector.
 * Used by auth.ts and callback.ts for all platforms (facebook, twitter, reddit, instagram, linkedin).
 *
 * Priority: request host (actual origin) → NEXT_PUBLIC_APP_URL → NEXT_PUBLIC_BASE_URL → http://localhost:3000
 *
 * Deriving from the request host ensures local dev (localhost:3000) and production
 * both get the correct callback URL automatically, even when NEXT_PUBLIC_APP_URL
 * is set to the production domain in .env.local.
 */
export function getCommunityAiConnectorCallbackUrl(platform: string, req?: import('next').NextApiRequest): string {
  let baseUrl: string;

  if (req) {
    // Prefer the actual request origin so local dev and prod both work without env changes
    const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || 'http';
    const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host || 'localhost:3000';
    baseUrl = `${proto}://${host}`;
  } else {
    baseUrl = (
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  return `${baseUrl}/api/community-ai/connectors/${platform}/callback`;
}

export const requireManageConnectors = async (
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string
): Promise<{ userId: string; role: string } | null> => {
  const { user, error } = await getSupabaseUserFromRequest(req);
  let resolvedUser: { id: string } | null = (!error && user?.id) ? { id: user.id } : null;

  // Fallback: read Supabase session from SSR cookies (browser navigation has no Bearer header)
  if (!resolvedUser) {
    try {
      const ssrClient = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll: () =>
              Object.entries(req.cookies).map(([name, value]) => ({ name, value: value ?? '' })),
            setAll: () => {},
          },
        }
      );
      const { data: { user: ssrUser } } = await ssrClient.auth.getUser();
      if (ssrUser?.id) {
        const { data: row } = await supabase
          .from('users')
          .select('id')
          .eq('supabase_uid', ssrUser.id)
          .maybeSingle();
        if (row?.id) resolvedUser = { id: row.id };
      }
    } catch {
      // SSR cookie path failed — fall through to UNAUTHORIZED
    }
  }

  if (!resolvedUser?.id) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  const { role, error: roleError } = await getUserRole(resolvedUser.id, companyId);
  if (roleError || !role) {
    const err = roleError === 'COMPANY_ACCESS_DENIED' ? 'COMPANY_ACCESS_DENIED' : 'FORBIDDEN_ROLE';
    res.status(403).json({ error: err });
    return null;
  }
  // Community-AI connectors are NOT Virality External APIs.
  // Connector OAuth does NOT imply access to the Virality API catalog.
  // Capabilities are isolated by domain.
  if (!hasCommunityAiCapability(role, 'MANAGE_CONNECTORS')) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  return { userId: resolvedUser.id, role };
};

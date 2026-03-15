import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getUserRole } from '../../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../../backend/services/rbac/communityAiCapabilities';
import { extractAccessToken } from '../../../../backend/services/supabaseAuthService';

/**
 * Returns the OAuth callback URL for a Community AI connector.
 * Used by auth.ts and callback.ts for all platforms (facebook, twitter, reddit, instagram, linkedin).
 */
export function getCommunityAiConnectorCallbackUrl(platform: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';
  return `${baseUrl}/api/community-ai/connectors/${platform}/callback`;
}

export const requireManageConnectors = async (
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string
): Promise<{ userId: string; role: string } | null> => {
  const token = extractAccessToken(req);
  if (!token) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  const { role, error: roleError } = await getUserRole(data.user.id, companyId);
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
  return { userId: data.user.id, role };
};

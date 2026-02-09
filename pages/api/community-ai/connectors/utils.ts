import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getUserRole } from '../../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../../backend/services/rbac/communityAiCapabilities';

const extractAccessToken = (req: NextApiRequest): string | null => {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) return token;
  }
  const cookieEntries = Object.entries(req.cookies || {});
  const directToken = req.cookies?.['sb-access-token'];
  if (directToken) return directToken;
  for (const [name, value] of cookieEntries) {
    if (!name.startsWith('sb-') || !name.endsWith('-auth-token')) continue;
    try {
      const parsed = JSON.parse(value);
      if (parsed?.access_token) return String(parsed.access_token);
    } catch {
      // ignore malformed cookie
    }
  }
  return null;
};

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
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
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

import type { NextApiRequest } from 'next';

export const LEGACY_SUPER_ADMIN_USER_ID = 'super_admin_session';

export const getLegacySuperAdminSession = (req: NextApiRequest) => {
  const hasSession = req.cookies?.super_admin_session === '1';
  if (!hasSession) return null;
  return { userId: LEGACY_SUPER_ADMIN_USER_ID };
};

import type { NextApiRequest } from 'next';

export const LEGACY_SUPER_ADMIN_USER_ID = 'super_admin_session';

export const getLegacySuperAdminSession = (req: NextApiRequest) => {
  return req.cookies?.super_admin_session === '1'
    ? { userId: LEGACY_SUPER_ADMIN_USER_ID, role: 'SUPER_ADMIN' as const }
    : null;
};

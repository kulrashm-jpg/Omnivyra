/**
 * Super-admin users API — route shell.
 *
 * Agent-B split (behavior-preserving): helpers → usersShared, GET/PATCH →
 * usersRead, POST/DELETE → usersMutations — all under backend/apiHandlers/superAdmin,
 * kept out of pages/api so Next.js does not register them as routes. Each handler keeps its own method guard and
 * returns falsy when it did not handle the request, so dispatch order and the
 * final 405 are identical to the original single-file handler.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { withIdempotency } from '../../../backend/middleware/withIdempotency';
import { requireSuperAdminAccess } from '../../../backend/apiHandlers/superAdmin/usersShared';
import { handleUsersGet, handleUsersPatch } from '../../../backend/apiHandlers/superAdmin/usersRead';
import { handleUsersPost, handleUsersDelete } from '../../../backend/apiHandlers/superAdmin/usersMutations';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:users', 30, 60))) return;
  const topGuard = await requireSuperAdminAccess(req, res);
  if (!topGuard) return;

  if (await handleUsersGet(req, res)) return;
  if (await handleUsersPost(req, res)) return;
  if (await handleUsersPatch(req, res)) return;
  if (await handleUsersDelete(req, res)) return;

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withIdempotency(handler, { scope: 'super-admin-users', methods: ['POST', 'PATCH', 'DELETE'] });

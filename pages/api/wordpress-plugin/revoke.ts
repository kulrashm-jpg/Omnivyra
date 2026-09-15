import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import {
  authenticateWordPressPluginToken,
  revokeWordPressPlugin,
} from '../../../backend/services/wordpressPluginService';

function bearer(req: NextApiRequest): string {
  const header = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { company_id, registration_id, reason } = req.body || {};
  const revokeReason = typeof reason === 'string' ? reason : null;

  // SEC-91A (STEP 3AH-91, A4) — plugin self-disconnect. The WordPress plugin
  // (class-omnivera-client.php disconnect()) calls this route with ONLY its own
  // registration bearer token (`ovwp_…`) — it has no Omnivyra user session —
  // so its disconnect used to fail with 401 and leave the registration live.
  // The token proves possession of exactly one registration; this path can
  // revoke that registration and nothing else (a body registration_id naming a
  // different one is refused), so it grants no cross-registration power.
  const pluginToken = bearer(req);
  if (pluginToken.startsWith('ovwp_')) {
    const plugin = await authenticateWordPressPluginToken(pluginToken);
    if (!plugin) return res.status(401).json({ error: 'Invalid plugin token' });
    if (registration_id && String(registration_id) !== plugin.registrationId) {
      return res.status(403).json({ error: 'Plugin token does not match registration_id' });
    }
    await revokeWordPressPlugin({ registrationId: plugin.registrationId, reason: revokeReason, actorUserId: null });
    return res.status(200).json({ ok: true });
  }

  if (!company_id || !registration_id) return res.status(400).json({ error: 'company_id and registration_id are required' });
  const companyId = String(company_id);
  const registrationId = String(registration_id);
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const role = await enforceRole({ req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
  if (!role) return;

  // SEC-91A (STEP 3AH-91, A4) — the registration must belong to the company
  // the caller was just authorized for. revokeWordPressPlugin() updates by
  // registration id alone, so an admin of company A used to be able to revoke
  // (null the token of, and disconnect) ANY tenant's WordPress plugin by
  // passing their own company_id with another tenant's registration_id. A
  // foreign id and an unknown id get the same 404.
  const { data: registration, error: registrationError } = await supabase
    .from('wordpress_plugin_registrations')
    .select('id')
    .eq('id', registrationId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (registrationError) return res.status(503).json({ error: 'Registration lookup failed. Please try again.' });
  if (!registration) return res.status(404).json({ error: 'Registration not found' });

  await revokeWordPressPlugin({
    registrationId,
    reason: revokeReason,
    actorUserId: role.userId,
  });
  return res.status(200).json({ ok: true });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/wordpress-plugin/revoke' });

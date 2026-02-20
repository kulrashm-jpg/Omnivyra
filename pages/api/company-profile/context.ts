import { NextApiRequest, NextApiResponse } from 'next';
import { getProfile } from '../../../backend/services/companyProfileService';
import {
  buildCompanyContext,
  buildForcedCompanyContext,
  computeCompanyContextCompletion,
  FORCED_CONTEXT_FIELD_LABELS,
} from '../../../backend/services/companyContextService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getUserRole, isSuperAdmin } from '../../../backend/services/rbacService';

const resolveCompanyAccess = async (
  req: NextApiRequest,
  res: NextApiResponse,
  companyId?: string | null
) => {
  if (!companyId) {
    res.status(400).json({ error: 'companyId required' });
    return null;
  }
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  if (await isSuperAdmin(user.id)) {
    return { userId: user.id, role: 'SUPER_ADMIN' };
  }
  const { role, error: roleError } = await getUserRole(user.id, companyId);
  if (roleError || !role) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  return { userId: user.id, role };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = req.query.companyId as string;
  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  const profile = await getProfile(companyId, { autoRefine: false });
  const companyContext = buildCompanyContext(profile);

  const forcedContextFields = profile?.forced_context_fields ?? null;
  const { forced_context, forced_context_enabled_fields } = buildForcedCompanyContext(
    companyContext,
    forcedContextFields
  );

  const company_context_completion = computeCompanyContextCompletion(companyContext);

  const forced_context_active_labels = forced_context_enabled_fields.map(
    (key) => FORCED_CONTEXT_FIELD_LABELS[key] || key.replace(/_/g, ' ')
  );

  return res.status(200).json({
    company_context: companyContext,
    company_context_completion,
    forced_context_enabled_fields,
    forced_context_active_labels,
    forced_context: Object.keys(forced_context).length > 0 ? forced_context : null,
  });
}

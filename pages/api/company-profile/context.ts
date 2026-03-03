import { NextApiRequest, NextApiResponse } from 'next';
import { getProfile } from '../../../backend/services/companyProfileService';
import {
  buildCompanyContext,
  buildLimitedCompanyContext,
  buildForcedCompanyContext,
  computeCompanyContextCompletion,
  FORCED_CONTEXT_FIELD_LABELS,
} from '../../../backend/services/companyContextService';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = req.query.companyId as string;
  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  const profile = await getProfile(companyId, { autoRefine: false });
  const isCompanyAdminOnly = access.role === 'COMPANY_ADMIN';
  const companyContext = isCompanyAdminOnly
    ? buildLimitedCompanyContext(profile)
    : buildCompanyContext(profile);

  const forcedContextFields = profile?.forced_context_fields ?? null;
  const { forced_context, forced_context_enabled_fields } = buildForcedCompanyContext(
    companyContext,
    isCompanyAdminOnly ? null : forcedContextFields
  );

  const company_context_completion = computeCompanyContextCompletion(companyContext);

  const forced_context_active_labels = isCompanyAdminOnly
    ? []
    : forced_context_enabled_fields.map(
        (key) => FORCED_CONTEXT_FIELD_LABELS[key] || key.replace(/_/g, ' ')
      );

  return res.status(200).json({
    company_context: companyContext,
    company_context_completion: isCompanyAdminOnly ? 0 : company_context_completion,
    forced_context_enabled_fields: isCompanyAdminOnly ? [] : forced_context_enabled_fields,
    forced_context_active_labels,
    forced_context: isCompanyAdminOnly ? null : (Object.keys(forced_context).length > 0 ? forced_context : null),
  });
}

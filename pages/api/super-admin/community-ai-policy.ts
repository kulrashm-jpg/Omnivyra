import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { getLegacySuperAdminSession } from '../../../backend/services/superAdminSession';
import { requireCapability } from '../../../backend/security/requireCapability';
import { INTELLIGENCE_OVERRIDE_MANAGE } from '../../../shared/contracts/security';

type PolicyInput = {
  execution_enabled?: boolean;
  auto_rules_enabled?: boolean;
  require_human_approval?: boolean;
};

// READ guard: bridge accepted via centralized helper (signature-validated +
// dry-run-aware). Mutations gate separately on `requireCapability`.
const requireSuperAdminRead = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<{ userId: string; email: string | null } | null> => {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id) {
    const isAdmin = await isPlatformSuperAdmin(user.id);
    if (isAdmin) return { userId: user.id, email: user.email || null };
  }
  const legacy = getLegacySuperAdminSession(req);
  if (legacy) {
    return { userId: legacy.userId, email: 'superadmin' };
  }
  res.status(401).json({ error: 'UNAUTHORIZED' });
  return null;
};

const fetchCurrentPolicy = async () => {
  const { data, error } = await supabase
    .from('community_ai_platform_policy')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return { policy: null, error };
  }
  return { policy: data || null, error: null };
};

const resolveUpdatedByEmail = async (userId?: string | null) => {
  if (!userId) return null;
  const { data, error } = await supabase.from('users').select('email').eq('id', userId).maybeSingle();
  if (error) return null;
  return data?.email || null;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const admin = await requireSuperAdminRead(req, res);
    if (!admin) return;
    const { policy, error } = await fetchCurrentPolicy();
    if (error) {
      // Table may not exist yet — return null policy rather than 500
      console.warn('[community-ai-policy] DB error (table may not be migrated):', error?.message);
      return res.status(200).json({ policy: null, updated_by_email: null });
    }
    const updatedByEmail = await resolveUpdatedByEmail(policy?.updated_by);
    return res.status(200).json({
      policy: policy || null,
      updated_by_email: updatedByEmail,
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Phase 2 mutation gate. INTELLIGENCE_OVERRIDE_MANAGE is held only by
  // canonical SUPER_ADMIN; bridge principals receive 403
  // CAPABILITY_NOT_HELD.
  const guard = await requireCapability(req, res, {
    capability: INTELLIGENCE_OVERRIDE_MANAGE,
    reason: 'community-AI platform policy mutation',
  });
  if (guard.ok !== true) return;
  const admin = { userId: guard.principal.userId, email: guard.principal.email || null };

  const input = (req.body || {}) as PolicyInput;
  const allowedKeys = ['execution_enabled', 'auto_rules_enabled', 'require_human_approval'];
  const hasUnknownKey = Object.keys(input).some((key) => !allowedKeys.includes(key));
  if (hasUnknownKey) {
    return res.status(400).json({ error: 'INVALID_FIELDS' });
  }
  const hasValidValue = Object.values(input).some((value) => typeof value === 'boolean');
  if (!hasValidValue) {
    return res.status(400).json({ error: 'NO_VALID_FIELDS' });
  }

  const { policy: existing, error: loadError } = await fetchCurrentPolicy();
  if (loadError) {
    return res.status(500).json({ error: 'FAILED_TO_LOAD_POLICY' });
  }

  const nextPolicy = {
    execution_enabled:
      typeof input.execution_enabled === 'boolean'
        ? input.execution_enabled
        : existing?.execution_enabled ?? true,
    auto_rules_enabled:
      typeof input.auto_rules_enabled === 'boolean'
        ? input.auto_rules_enabled
        : existing?.auto_rules_enabled ?? true,
    require_human_approval:
      typeof input.require_human_approval === 'boolean'
        ? input.require_human_approval
        : existing?.require_human_approval ?? false,
  };

  const updatedBy = admin.userId === 'super_admin_session' ? null : admin.userId;
  let savedPolicy = null;
  if (existing?.id) {
    const { data, error } = await supabase
      .from('community_ai_platform_policy')
      .update({
        ...nextPolicy,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy,
      })
      .eq('id', existing.id)
      .select('*')
      .maybeSingle();
    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_UPDATE_POLICY' });
    }
    savedPolicy = data;
  } else {
    const { data, error } = await supabase
      .from('community_ai_platform_policy')
      .insert({
        ...nextPolicy,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy,
      })
      .select('*')
      .maybeSingle();
    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_CREATE_POLICY' });
    }
    savedPolicy = data;
  }

  await supabase.from('audit_logs').insert({
    actor_user_id: updatedBy,
    action: 'UPDATE_COMMUNITY_AI_PLATFORM_POLICY',
    metadata: {
      previous: existing || null,
      next: savedPolicy || null,
    },
    created_at: new Date().toISOString(),
  });

  await supabase.from('super_admin_audit_logs').insert({
    username: admin.email || admin.userId,
    action: 'update_policy',
    ip_address:
      (req.headers['x-forwarded-for'] as string | undefined) || req.socket?.remoteAddress || null,
    user_agent: req.headers['user-agent'] || null,
    created_at: new Date().toISOString(),
  });

  const updatedByEmail = await resolveUpdatedByEmail(savedPolicy?.updated_by);
  return res.status(200).json({ policy: savedPolicy, updated_by_email: updatedByEmail });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/community-ai-policy' });

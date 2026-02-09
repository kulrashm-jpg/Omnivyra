import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import {
  getUserRole,
  isPlatformSuperAdmin,
  isSuperAdmin,
  Role,
} from '../../../../backend/services/rbacService';

const requirePlaybookAccess = async (
  req: NextApiRequest,
  res: NextApiResponse,
  companyId?: string
): Promise<{ userId: string; role: Role | 'SUPER_ADMIN' } | null> => {
  if (!companyId) {
    res.status(400).json({ error: 'companyId required' });
    return null;
  }
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  if (await isPlatformSuperAdmin(user.id)) {
    return { userId: user.id, role: 'SUPER_ADMIN' };
  }
  if (await isSuperAdmin(user.id)) {
    console.debug('SUPER_ADMIN_FALLBACK', {
      path: req.url,
      userId: user.id,
      source: 'rbacService.isSuperAdmin',
    });
    return { userId: user.id, role: 'SUPER_ADMIN' };
  }
  const { role, error: roleError } = await getUserRole(user.id, companyId);
  if (roleError || !role) {
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  return { userId: user.id, role };
};

const canManagePlaybooks = (role: Role | 'SUPER_ADMIN') =>
  role === 'SUPER_ADMIN' || role === Role.COMPANY_ADMIN;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined);

  if (req.method === 'GET') {
    const access = await requirePlaybookAccess(req, res, companyId);
    if (!access) return;
    const { data, error } = await supabase
      .from('virality_playbooks')
      .select('*')
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false });
    if (error) {
      return res.status(500).json({ error: 'Failed to load playbooks' });
    }
    return res.status(200).json({ playbooks: data || [] });
  }

  if (req.method === 'POST') {
    const access = await requirePlaybookAccess(req, res, companyId);
    if (!access) return;
    if (!canManagePlaybooks(access.role)) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }
    const {
      name,
      objective,
      platforms,
      content_types,
      api_inputs,
      tone_guidelines,
      cadence_guidelines,
      success_metrics,
      status,
    } = req.body || {};
    if (!name || !objective || !platforms || !content_types) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const payload = {
      company_id: companyId,
      name,
      objective,
      platforms,
      content_types,
      api_inputs: api_inputs || [],
      tone_guidelines: tone_guidelines || null,
      cadence_guidelines: cadence_guidelines || null,
      success_metrics: success_metrics || {},
      status: status || 'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from('virality_playbooks')
      .insert(payload)
      .select('*')
      .single();
    if (error) {
      return res.status(500).json({ error: 'Failed to create playbook' });
    }
    return res.status(201).json({ playbook: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default handler;

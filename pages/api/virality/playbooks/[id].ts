import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import {
  getUserRole,
  isPlatformSuperAdmin,
  isSuperAdmin,
  Role,
} from '../../../../backend/services/rbacService';

const canManagePlaybooks = (role: Role | 'SUPER_ADMIN') =>
  role === 'SUPER_ADMIN' || role === Role.COMPANY_ADMIN;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Playbook ID is required' });
  }

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const { data: playbook, error: playbookError } = await supabase
    .from('virality_playbooks')
    .select('*')
    .eq('id', id)
    .single();

  if (playbookError || !playbook) {
    return res.status(404).json({ error: 'Playbook not found' });
  }

  let role: Role | 'SUPER_ADMIN' | null = null;
  if (await isPlatformSuperAdmin(user.id)) {
    role = 'SUPER_ADMIN';
  } else if (await isSuperAdmin(user.id)) {
    console.debug('SUPER_ADMIN_FALLBACK', {
      path: req.url,
      userId: user.id,
      source: 'rbacService.isSuperAdmin',
    });
    role = 'SUPER_ADMIN';
  } else {
    const { role: companyRole, error: roleError } = await getUserRole(
      user.id,
      playbook.company_id
    );
    if (roleError || !companyRole) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }
    role = companyRole;
  }

  if (req.method === 'PUT') {
    if (!role || !canManagePlaybooks(role)) {
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
    const payload = {
      name: name ?? playbook.name,
      objective: objective ?? playbook.objective,
      platforms: platforms ?? playbook.platforms,
      content_types: content_types ?? playbook.content_types,
      api_inputs: api_inputs ?? playbook.api_inputs ?? [],
      tone_guidelines: tone_guidelines ?? playbook.tone_guidelines ?? null,
      cadence_guidelines: cadence_guidelines ?? playbook.cadence_guidelines ?? null,
      success_metrics: success_metrics ?? playbook.success_metrics ?? {},
      status: status ?? playbook.status ?? 'draft',
      updated_at: new Date().toISOString(),
    };
    const { data, error: updateError } = await supabase
      .from('virality_playbooks')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();
    if (updateError) {
      return res.status(500).json({ error: 'Failed to update playbook' });
    }
    return res.status(200).json({ playbook: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

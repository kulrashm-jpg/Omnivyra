import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { getUserRole, isSuperAdmin, Role, getCompanyRoleIncludingInvited } from '@/backend/services/rbacService';

async function ensureCompanyAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string,
): Promise<{ userId: string; role: Role | null } | null> {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) { res.status(401).json({ error: 'UNAUTHORIZED' }); return null; }

  if (await isSuperAdmin(user.id)) return { userId: user.id, role: Role.SUPER_ADMIN };

  let { role, error: roleError } = await getUserRole(user.id, companyId);
  if (!role && (roleError === 'COMPANY_ACCESS_DENIED' || roleError === null)) {
    const fallback = await getCompanyRoleIncludingInvited(user.id, companyId);
    if (([Role.COMPANY_ADMIN, Role.ADMIN, Role.SUPER_ADMIN] as Role[]).includes(fallback as Role)) {
      role = fallback; roleError = null;
    }
  }
  if (roleError) { res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' }); return null; }
  if (!role)     { res.status(403).json({ error: 'FORBIDDEN_ROLE' });        return null; }
  return { userId: user.id, role };
}

const VALID_TYPES = new Set(['related', 'prerequisite', 'continuation']);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const company_id = (req.query.company_id ?? req.body?.company_id) as string | undefined;
  if (!company_id) return res.status(400).json({ error: 'company_id is required' });

  const auth = await ensureCompanyAccess(req, res, company_id);
  if (!auth) return;

  // POST — create relationship
  if (req.method === 'POST') {
    const { source_blog_id, target_blog_id, relationship_type = 'related' } = req.body ?? {};

    if (!source_blog_id || !target_blog_id)
      return res.status(400).json({ error: 'source_blog_id and target_blog_id required' });
    if (source_blog_id === target_blog_id)
      return res.status(400).json({ error: 'source and target must differ' });
    if (!VALID_TYPES.has(relationship_type))
      return res.status(400).json({ error: 'Invalid relationship_type' });

    const { data, error } = await supabase
      .from('company_blog_relationships')
      .insert({ company_id, source_blog_id, target_blog_id, relationship_type })
      .select('id, source_blog_id, target_blog_id, relationship_type')
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Relationship already exists' });
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json(data);
  }

  // DELETE — remove relationship
  if (req.method === 'DELETE') {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: 'id required' });

    const { error } = await supabase
      .from('company_blog_relationships')
      .delete()
      .eq('id', id)
      .eq('company_id', company_id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

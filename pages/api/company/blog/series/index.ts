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

function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 80);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const company_id = (req.query.company_id ?? req.body?.company_id) as string | undefined;
  if (!company_id) return res.status(400).json({ error: 'company_id is required' });

  const auth = await ensureCompanyAccess(req, res, company_id);
  if (!auth) return;

  // GET — list series with post counts
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('company_blog_series')
      .select(`id, title, slug, description, cover_url, created_at, company_blog_series_posts(blog_id, position)`)
      .eq('company_id', company_id)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ series: data ?? [] });
  }

  // POST — create series
  if (req.method === 'POST') {
    const body = req.body ?? {};
    const title = body.title?.trim();
    if (!title) return res.status(400).json({ error: 'title is required' });

    const slug = body.slug?.trim() || slugify(title);
    const description = body.description?.trim() || null;

    const { data, error } = await supabase
      .from('company_blog_series')
      .insert({ company_id, title, slug, description })
      .select('id, title, slug, description, created_at')
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Slug already exists' });
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

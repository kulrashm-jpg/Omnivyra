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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = req.query.id as string;
  if (!id?.trim()) return res.status(400).json({ error: 'id required' });

  // company_id for auth check — read from body or query
  const company_id = (req.query.company_id ?? req.body?.company_id) as string | undefined;
  if (!company_id) return res.status(400).json({ error: 'company_id is required' });

  const auth = await ensureCompanyAccess(req, res, company_id);
  if (!auth) return;

  // GET — series detail with posts
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('company_blog_series')
      .select(`id, title, slug, description, cover_url, created_at, company_blog_series_posts(blog_id, position)`)
      .eq('id', id)
      .eq('company_id', company_id)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: 'Not found' });

    const postIds = (data.company_blog_series_posts as { blog_id: string; position: number }[]).map(p => p.blog_id);
    let blogDetails: { id: string; title: string; slug: string; status: string }[] = [];
    if (postIds.length > 0) {
      const { data: blogs } = await supabase.from('blogs').select('id, title, slug, status').in('id', postIds);
      blogDetails = blogs ?? [];
    }

    const posts = (data.company_blog_series_posts as { blog_id: string; position: number }[])
      .map(sp => {
        const blog = blogDetails.find(b => b.id === sp.blog_id);
        return { ...sp, title: blog?.title ?? '', slug: blog?.slug ?? '', status: blog?.status ?? '' };
      })
      .sort((a, b) => a.position - b.position);

    return res.status(200).json({ ...data, company_blog_series_posts: posts });
  }

  // PATCH — update metadata + replace post list
  if (req.method === 'PATCH') {
    const body = req.body ?? {};
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.title !== undefined)       updates.title       = body.title?.trim() ?? '';
    if (body.description !== undefined) updates.description = body.description?.trim() || null;
    if (body.cover_url !== undefined)   updates.cover_url   = body.cover_url?.trim() || null;

    const { error: updateErr } = await supabase
      .from('company_blog_series')
      .update(updates)
      .eq('id', id)
      .eq('company_id', company_id);

    if (updateErr) return res.status(500).json({ error: updateErr.message });

    if (Array.isArray(body.posts)) {
      await supabase.from('company_blog_series_posts').delete().eq('series_id', id);
      const rows = (body.posts as { blog_id: string; position: number }[]).map(p => ({
        series_id: id, blog_id: p.blog_id, position: p.position ?? 0,
      }));
      if (rows.length > 0) {
        const { error: insertErr } = await supabase.from('company_blog_series_posts').insert(rows);
        if (insertErr) return res.status(500).json({ error: insertErr.message });
      }
    }

    return res.status(200).json({ ok: true });
  }

  // DELETE
  if (req.method === 'DELETE') {
    const { error } = await supabase
      .from('company_blog_series')
      .delete()
      .eq('id', id)
      .eq('company_id', company_id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

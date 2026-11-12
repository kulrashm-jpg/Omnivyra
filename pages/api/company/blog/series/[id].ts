import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { enforceCompanyAccess } from '@/backend/services/userContextService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = req.query.id as string;
  if (!id?.trim()) return res.status(400).json({ error: 'id required' });

  // company_id for auth check — read from body or query
  const company_id = (req.query.company_id ?? req.body?.company_id) as string | undefined;
  if (!company_id) return res.status(400).json({ error: 'company_id is required' });

  const auth = await enforceCompanyAccess({ req, res, companyId: company_id });
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
      // Company-scoped (SECURITY, 2026-11-11): a series row may reference another
      // tenant's blog id (it used to be insertable via PATCH), and this lookup
      // returned that blog's title/slug/status. Only this company's blogs now.
      const { data: blogs, error: blogsErr } = await supabase
        .from('blogs')
        .select('id, title, slug, status')
        .eq('company_id', company_id)
        .in('id', postIds);
      if (blogsErr) return res.status(500).json({ error: blogsErr.message });
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

    // Tenant isolation (SECURITY, 2026-11-11): prove the series is THIS
    // company's before any write. The scoped metadata update below matches 0
    // rows on a foreign id WITHOUT failing, and the post-list replace used to
    // run anyway - a member of any company could wipe and rewrite another
    // tenant's series posts by id.
    const { data: owned, error: ownErr } = await supabase
      .from('company_blog_series')
      .select('id')
      .eq('id', id)
      .eq('company_id', company_id)
      .maybeSingle();
    if (ownErr) return res.status(500).json({ error: ownErr.message });
    if (!owned) return res.status(404).json({ error: 'Not found' });

    // Every referenced blog must be this company's own: a foreign blog id would
    // otherwise be readable back through the GET above.
    if (Array.isArray(body.posts) && body.posts.length > 0) {
      const raw = (body.posts as { blog_id?: unknown }[]).map((p) => p?.blog_id);
      if (!raw.every((b) => typeof b === 'string' && b.trim() !== '')) {
        return res.status(400).json({ error: 'every post needs a blog_id' });
      }
      // Compared as a SET of normalised ids (05/e9 2026-11-12): a repeated id - or the same id
      // with surrounding whitespace - is one blog, never misreported as a foreign reference.
      const wanted = [...new Set((raw as string[]).map((b) => b.trim()))];
      const { data: mine, error: mineErr } = await supabase
        .from('blogs')
        .select('id')
        .eq('company_id', company_id)
        .in('id', wanted as string[]);
      if (mineErr || !Array.isArray(mine)) return res.status(500).json({ error: mineErr?.message ?? 'blog lookup failed' });
      if (mine.length !== wanted.length) {
        return res.status(400).json({ error: "a post references a blog that is not this company's" });
      }
    }
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
      // The delete's error used to be ignored; a failed clear must not be followed
      // by an insert that silently duplicates or half-replaces the list.
      const { error: clearErr } = await supabase.from('company_blog_series_posts').delete().eq('series_id', id);
      if (clearErr) return res.status(500).json({ error: clearErr.message });
      const rows = (body.posts as { blog_id: string; position: number }[]).map(p => ({
        series_id: id, blog_id: String(p.blog_id).trim(), position: p.position ?? 0,
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/company/blog/series/:id' });

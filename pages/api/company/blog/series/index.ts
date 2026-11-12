import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { tenantChildTable, tenantContextFor, tenantTable, type TenantContext } from '@/backend/db/tenantTable';

type SeriesPost = { blog_id: string; position: number };
/** A series' posts, read through the seam (child of company_blog_series, S1 f285c998a). */
async function postsOf(tenant: TenantContext, seriesId: string): Promise<SeriesPost[]> {
  const posts = await tenantChildTable('company_blog_series_posts', tenant, seriesId);
  const { data, error } = await posts.select('blog_id, position');
  if (error) throw new Error(`series posts read failed: ${error.message}`);
  return (data ?? []) as SeriesPost[];
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 80);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const company_id = (req.query.company_id ?? req.body?.company_id) as string | undefined;
  if (!company_id) return res.status(400).json({ error: 'company_id is required' });

  const auth = await enforceCompanyAccess({ req, res, companyId: company_id });
  if (!auth) return;
  // S2: every read and write below is pinned to the company the access check resolved.
  const tenant = tenantContextFor(auth, company_id);

  // GET — list series with post counts
  if (req.method === 'GET') {
    // No embed through the seam (S1): the series, then each one's posts as a child of it.
    const { data, error } = await tenantTable('company_blog_series', tenant)
      .select('id, title, slug, description, cover_url, created_at')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    try {
      const series = await Promise.all(((data ?? []) as Array<{ id: string }>).map(async (s) => ({
        ...s, company_blog_series_posts: await postsOf(tenant, s.id),
      })));
      return res.status(200).json({ series });
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message });
    }
  }

  // POST — create series
  if (req.method === 'POST') {
    const body = req.body ?? {};
    const title = body.title?.trim();
    if (!title) return res.status(400).json({ error: 'title is required' });

    const slug = body.slug?.trim() || slugify(title);
    const description = body.description?.trim() || null;

    const { data, error } = await tenantTable('company_blog_series', tenant)
      .insert({ title, slug, description })
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/company/blog/series' });

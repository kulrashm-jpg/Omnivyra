import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { enforceCompanyAccess } from '@/backend/services/userContextService';

function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 80);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const company_id = (req.query.company_id ?? req.body?.company_id) as string | undefined;
  if (!company_id) return res.status(400).json({ error: 'company_id is required' });

  const auth = await enforceCompanyAccess({ req, res, companyId: company_id });
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/company/blog/series' });

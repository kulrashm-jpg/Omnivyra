import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../../backend/db/supabaseClient';
import { requireCapability } from '../../../../../backend/security/requireCapability';
import { BLOG_PUBLISH_MANAGE, SUPER_ADMIN_DASHBOARD_VIEW } from '../../../../../shared/contracts/security';

function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 80);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const cap = req.method === 'GET' ? SUPER_ADMIN_DASHBOARD_VIEW : BLOG_PUBLISH_MANAGE;
  const guard = await requireCapability(req, res, {
    capability: cap,
    reason: `blog series (${req.method})`,
  });
  if (guard.ok !== true) return;

  // ── GET — list all series with post counts ─────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('blog_series')
      .select(`
        id, title, slug, description, cover_url, created_at,
        blog_series_posts(blog_id, position)
      `)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ series: data ?? [] });
  }

  // ── POST — create series ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body ?? {};
    const title = body.title?.trim();
    if (!title) return res.status(400).json({ error: 'title is required' });

    const slug = body.slug?.trim() || slugify(title);
    const description = body.description?.trim() || null;

    const { data, error } = await supabase
      .from('blog_series')
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
export default __createApiRoute(handler, { route: '/api/admin/blog/series' });

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { extractBlogContext } from '../../../lib/blog/blockExtractor';

/**
 * GET /api/campaigns/blog-context
 *
 * Returns published blog posts with enriched metadata for the
 * Campaign Assist Panel.
 *
 * Response:
 * {
 *   company_blogs: BlogContextItem[],   — company's own published blogs
 *   omnivyra_blogs: BlogContextItem[]   — platform knowledge library (public_blogs)
 * }
 *
 * Each item includes: key_insights, summary, h2_headings, source.
 * Optional query param: ?q=<search> — filters by title, tags, category across both sources.
 */

interface BlogContextItem {
  id:           string;
  title:        string;
  slug:         string;
  tags:         string[];
  category:     string;
  excerpt:      string;
  key_insights: string[];
  summary:      string;
  h2_headings:  string[];
  views_count:  number;
  likes_count:  number;
  source:       'company' | 'omnivyra';
}

function applySearch(blogs: BlogContextItem[], search: string): BlogContextItem[] {
  if (!search) return blogs;
  return blogs.filter(
    (b) =>
      b.title.toLowerCase().includes(search) ||
      b.tags.some((t) => t.toLowerCase().includes(search)) ||
      b.category.toLowerCase().includes(search),
  );
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const search = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

  // Resolve companyId from RBAC-enriched request or session
  const { data: { user } } = await supabase.auth.getUser();
  let companyId: string | null = (req as any).companyId ?? null;

  if (!companyId && user) {
    const { data: membership } = await supabase
      .from('user_companies')
      .select('company_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();
    companyId = membership?.company_id ?? null;
  }

  // ── 1. Company blogs ──────────────────────────────────────────────────────
  const companyBlogsRaw: BlogContextItem[] = [];

  if (companyId) {
    const { data: cBlogs } = await supabase
      .from('blogs')
      .select('id, title, slug, tags, category, excerpt, content_blocks, views_count')
      .eq('company_id', companyId)
      .eq('status', 'published')
      .order('updated_at', { ascending: false })
      .limit(50);

    for (const b of cBlogs ?? []) {
      const { key_insights, summary, h2_headings } = extractBlogContext(b.content_blocks);
      companyBlogsRaw.push({
        id:           b.id,
        title:        b.title        ?? '',
        slug:         b.slug         ?? '',
        tags:         b.tags         ?? [],
        category:     b.category     ?? '',
        excerpt:      b.excerpt      ?? '',
        key_insights,
        summary,
        h2_headings,
        views_count:  b.views_count  ?? 0,
        likes_count:  0,
        source:       'company',
      });
    }
  }

  // ── 2. Omnivyra platform blogs (public_blogs — unchanged) ─────────────────
  const { data: pBlogs, error: pError } = await supabase
    .from('public_blogs')
    .select('id, title, slug, tags, category, excerpt, content_blocks, views_count, likes_count')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(50);

  if (pError) return res.status(500).json({ error: pError.message });

  const omnivyraBlogs: BlogContextItem[] = (pBlogs ?? []).map((b) => {
    const { key_insights, summary, h2_headings } = extractBlogContext(b.content_blocks);
    return {
      id:           b.id,
      title:        b.title        ?? '',
      slug:         b.slug         ?? '',
      tags:         b.tags         ?? [],
      category:     b.category     ?? '',
      excerpt:      b.excerpt      ?? '',
      key_insights,
      summary,
      h2_headings,
      views_count:  b.views_count  ?? 0,
      likes_count:  b.likes_count  ?? 0,
      source:       'omnivyra',
    };
  });

  return res.status(200).json({
    company_blogs:  applySearch(companyBlogsRaw, search),
    omnivyra_blogs: applySearch(omnivyraBlogs,   search),
  });
}

export default withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN, Role.COMPANY_ADMIN]);

import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '@/backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { enforceCompanyAccess } from '@/backend/services/userContextService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const company_id = (req.query.company_id || req.body?.company_id) as string | undefined;

  if (!company_id) {
    return res.status(400).json({ error: 'company_id is required' });
  }

  const auth = await enforceCompanyAccess({ req, res, companyId: company_id });
  if (!auth) return;

  try {
    // â”€â”€ 1. All posts with block-level metadata â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const { data: posts, error: postsErr } = await supabase
      .from('blogs')
      .select('id, title, slug, category, tags, status, views_count, likes_count, published_at, created_at, content_blocks, angle_type')
      .eq('company_id', company_id)
      .order('published_at', { ascending: false, nullsFirst: false });

    if (postsErr) return res.status(500).json({ error: postsErr.message });

    // â”€â”€ 2. Series (company_blog_series â€” FK â†’ blogs(id)) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const { data: seriesRows } = await supabase
      .from('company_blog_series')
      .select(`id, title, slug, description, cover_url, created_at, company_blog_series_posts(blog_id, position)`)
      .eq('company_id', company_id)
      .order('created_at', { ascending: false });

    // â”€â”€ 3. Relationships (company_blog_relationships â€” FK â†’ blogs(id)) â”€â”€â”€â”€
    const { data: relRows } = await supabase
      .from('company_blog_relationships')
      .select('id, source_blog_id, target_blog_id, relationship_type, created_at')
      .eq('company_id', company_id)
      .order('created_at', { ascending: false });

    // â”€â”€ 4. Performance summaries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // company_blog_performance_summary view includes company_id â€” no IN filter needed
    const { data: perfRows } = await supabase
      .from('company_blog_performance_summary')
      .select('blog_id, session_count, avg_time_seconds, avg_scroll_depth, completion_rate')
      .eq('company_id', company_id);

    const perfMap = new Map<string, {
      session_count:   number;
      avg_time_seconds: number;
      avg_scroll_depth: number;
      completion_rate:  number;
    }>();
    for (const p of perfRows ?? []) {
      perfMap.set(p.blog_id, {
        session_count:    Number(p.session_count)    || 0,
        avg_time_seconds: Number(p.avg_time_seconds) || 0,
        avg_scroll_depth: Number(p.avg_scroll_depth) || 0,
        completion_rate:  Number(p.completion_rate)  || 0,
      });
    }

    // â”€â”€ 5. Comment counts per blog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const postIds = (posts ?? []).map((p) => p.id);
    let commentMap = new Map<string, number>();

    if (postIds.length > 0) {
      const { data: commentRows } = await supabase
        .from('company_blog_comments')
        .select('blog_id')
        .in('blog_id', postIds);

      for (const row of commentRows ?? []) {
        commentMap.set(row.blog_id, (commentMap.get(row.blog_id) ?? 0) + 1);
      }
    }

    // â”€â”€ 6. Annotate posts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const annotated = (posts ?? []).map((p) => {
      const blocks: { type: string; body?: string; slug?: string; items?: { title: string; url: string }[] }[] =
        Array.isArray(p.content_blocks) ? p.content_blocks : [];

      const has_summary = blocks.some(
        (b) => b.type === 'summary' && (b.body ?? '').trim().length > 0,
      );
      const internal_links = blocks.filter(
        (b) => b.type === 'internal_link' && (b.slug ?? '').trim(),
      ).length;
      const refs_block = blocks.find((b) => b.type === 'references') as
        | { items?: { title: string; url: string }[] }
        | undefined;
      const references_count = refs_block?.items?.filter((r) => r.title || r.url).length ?? 0;

      const perf = perfMap.get(p.id) ?? {
        session_count: 0, avg_time_seconds: 0, avg_scroll_depth: 0, completion_rate: 0,
      };

      return {
        id:               p.id,
        title:            p.title,
        slug:             p.slug,
        category:         p.category,
        tags:             Array.isArray(p.tags) ? p.tags : [],
        status:           p.status,
        views_count:      p.views_count ?? 0,
        likes_count:      p.likes_count ?? 0,
        comments_count:   commentMap.get(p.id) ?? 0,
        published_at:     p.published_at,
        created_at:       p.created_at,
        angle_type:       p.angle_type || null,
        has_summary,
        internal_links,
        references_count,
        ...perf,
      };
    });

    return res.status(200).json({
      posts:         annotated,
      series:        seriesRows ?? [],
      relationships: relRows ?? [],
    });
  } catch (err: unknown) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
})(handler);


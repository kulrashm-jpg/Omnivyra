import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getCanonicalAppUrl } from '../../../backend/config/getCanonicalAppUrl';

// Sitemap is submitted to search engines; URLs become canonical references in
// the index. The previous chain — NEXT_PUBLIC_APP_URL → VERCEL_URL → literal
// 'https://omnivera.com' (typo, dead domain) — could leak preview hostnames
// into Google Search Console and pin a misspelled domain as canonical when
// the env was unset. Resolve through the single canonical helper instead.
const SITE_URL = getCanonicalAppUrl();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).end();
  }

  try {
    const { data: posts, error } = await supabase
      .from('public_blogs')
      .select('slug, updated_at, published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false });

    if (error) {
      return res.status(500).end();
    }

    const base = SITE_URL.replace(/\/$/, '');
    const lastmod = (date: string | null) => {
      if (!date) return new Date().toISOString().slice(0, 10);
      return new Date(date).toISOString().slice(0, 10);
    };

    const urls = [
      `<url><loc>${base}/blog</loc><lastmod>${lastmod(null)}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
      ...(posts || []).map((p) =>
        `<url><loc>${base}/blog/${encodeURIComponent(p.slug)}</loc><lastmod>${lastmod(p.updated_at || p.published_at)}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`
      ),
    ].join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate');
    res.status(200).send(xml);
  } catch {
    res.status(500).end();
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
// AUTH-ENFORCEMENT Phase 1 (Task 3b Batch 2a): declarative policy, observation-only.
export default __createApiRoute(handler, {
  route: '/api/blog/sitemap',
  policy: {
    v: 1,
    category: 'public',
    justification:
      'Purpose: SEO sitemap submitted to search engines. Exposure: slugs and dates of published marketing-blog posts only (public_blogs, status=published). Rationale: exists to be crawled; shared-cache directive is intentional and INV-6-legal only under this category. Contract: Search Engine Content.',
  },
});

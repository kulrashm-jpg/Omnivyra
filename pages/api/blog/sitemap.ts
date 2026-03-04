import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
  'https://omnivera.com';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

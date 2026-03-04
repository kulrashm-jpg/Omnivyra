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
      .select('title, slug, excerpt, published_at, updated_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(50);

    if (error) {
      return res.status(500).end();
    }

    const base = SITE_URL.replace(/\/$/, '');
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>The Marketing Intelligence Journal by Omnivera</title>
    <link>${base}/blog</link>
    <description>Strategic insight on AI-driven campaign architecture, execution intelligence, and momentum modeling.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${base}/blog/rss.xml" rel="self" type="application/rss+xml"/>
    ${(posts || []).map((p) => {
      const link = `${base}/blog/${encodeURIComponent(p.slug)}`;
      const pubDate = p.published_at ? new Date(p.published_at).toUTCString() : new Date().toUTCString();
      const title = escapeXml(p.title);
      const desc = escapeXml(p.excerpt || p.title);
      return `<item><title>${title}</title><link>${link}</link><description>${desc}</description><pubDate>${pubDate}</pubDate><guid isPermaLink="true">${link}</guid></item>`;
    }).join('\n    ')}
  </channel>
</rss>`;

    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate');
    res.status(200).send(rss);
  } catch {
    res.status(500).end();
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Public blog read functions for build-time / ISR rendering (OPT-006 Phase B).
 *
 * These mirror the EXACT queries of the public API routes so the static pages
 * and the API can never disagree on what is publicly visible:
 *  - listPublishedBlogPosts  ⇄  pages/api/blog/index.ts     (status='published',
 *    optional is_featured, published_at desc nullsFirst:false, same columns)
 *  - getPublishedBlogPost    ⇄  pages/api/blog/[slug]/index.ts (status='published',
 *    slug match, maybeSingle) — WITHOUT the views_count increment: per-view
 *    counting stays a runtime concern (the page keeps its client-side ping to
 *    the API route), because ISR regeneration must never mutate data.
 *
 * Server-only: imported exclusively via dynamic import() inside getStaticProps /
 * getStaticPaths so the service-role client can never reach a client bundle.
 */

import { supabase } from '../../db/supabaseClient';

export interface PublicBlogListItem {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  featured_image_url: string | null;
  category: string | null;
  tags: string[] | null;
  status: string;
  is_featured: boolean;
  published_at: string | null;
  views_count: number | null;
}

const LIST_COLUMNS =
  'id, title, slug, excerpt, featured_image_url, category, tags, status, is_featured, published_at, views_count';

export async function listPublishedBlogPosts(opts: {
  limit: number;
  featuredOnly?: boolean;
}): Promise<PublicBlogListItem[]> {
  let query = supabase
    .from('public_blogs')
    .select(LIST_COLUMNS)
    .eq('status', 'published');

  if (opts.featuredOnly) {
    query = query.eq('is_featured', true);
  }

  const { data, error } = await query
    .order('published_at', { ascending: false, nullsFirst: false })
    .range(0, Math.max(1, opts.limit) - 1);

  if (error) {
    // Throw so an ISR revalidation failure keeps serving the last good page
    // (and a build-time failure fails the build loudly instead of baking an
    // empty journal).
    throw new Error(`publicBlogRead.list failed: ${error.message}`);
  }
  return (data ?? []) as PublicBlogListItem[];
}

/** Full row (select *) for the article page; null when not published/found. */
export async function getPublishedBlogPost(slug: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('public_blogs')
    .select('*')
    .eq('status', 'published')
    .eq('slug', slug.trim())
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`publicBlogRead.get failed: ${error.message}`);
  }
  return data ?? null;
}

/** Recent published slugs for getStaticPaths prebuild (the rest use fallback: 'blocking'). */
export async function listRecentPublishedSlugs(limit: number): Promise<string[]> {
  const { data, error } = await supabase
    .from('public_blogs')
    .select('slug')
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .range(0, Math.max(1, limit) - 1);

  if (error) {
    throw new Error(`publicBlogRead.slugs failed: ${error.message}`);
  }
  return (data ?? []).map((r: { slug: string }) => r.slug).filter(Boolean);
}

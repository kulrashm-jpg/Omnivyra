/**
 * Campaign Knowledge Graph Service
 *
 * Bridges the campaign continuity engine with:
 *   1. blog_relationships — related/continuation/prerequisite blog connections
 *   2. intelligence_graph_edges — topic_similarity signal edges
 *   3. public_blogs — blog posts matching topic keywords
 *
 * All functions are async and use the server-side supabase client.
 */

import { supabase } from '../db/supabaseClient';

// ---------------------------------------------------------------------------
// In-memory cache for getBlogsForTopic results (TTL: 5 minutes per key)
// ---------------------------------------------------------------------------

const _blogTopicCache = new Map<string, { result: BlogSignal[]; expiresAt: number }>();
const BLOG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TopicGraphResult {
  current_topic: string;
  related_topics: string[];
  related_blog_ids: string[];
  /** Source of each related topic: 'blog_graph' | 'signal_graph' | 'tag_match' */
  sources: Array<{ topic: string; source: string }>;
}

export interface BlogSignal {
  id:    string;
  title: string;
  slug:  string;
  tags:  string[];
  excerpt: string | null;
  similarity_score: number;
  /** Which table this blog came from. 'omnivyra' = public_blogs, 'company' = blogs. */
  source?: 'omnivyra' | 'company';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
}

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// 1. Topic graph from blog relationships
// ---------------------------------------------------------------------------

/**
 * Fetches related blog titles (as topic proxies) via the blog_relationships table.
 * Walks one hop from any blog whose title matches the topic.
 */
async function getRelatedTopicsFromBlogGraph(topic: string): Promise<{
  topics: string[];
  blog_ids: string[];
}> {
  const tokens = tokenize(topic);
  if (tokens.length === 0) return { topics: [], blog_ids: [] };

  // Find source blogs matching the topic by title/tag keywords
  const { data: sourceBlogs } = await supabase
    .from('public_blogs')
    .select('id, title, tags')
    .eq('status', 'published')
    .limit(40);

  if (!sourceBlogs || sourceBlogs.length === 0) return { topics: [], blog_ids: [] };

  // Score each blog against the topic
  const matched = sourceBlogs
    .map((b) => {
      const titleTokens = tokenize(b.title ?? '');
      const tagTokens = (b.tags ?? []).flatMap((t: string) => tokenize(t));
      const score = jaccardSimilarity(tokens, [...titleTokens, ...tagTokens]);
      return { id: b.id, title: b.title, score };
    })
    .filter((b) => b.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (matched.length === 0) return { topics: [], blog_ids: [] };

  const sourceIds = matched.map((b) => b.id);

  // Follow relationships outward (related + continuation)
  const { data: relationships } = await supabase
    .from('blog_relationships')
    .select('source_blog_id, target_blog_id, relationship_type')
    .in('source_blog_id', sourceIds)
    .in('relationship_type', ['related', 'continuation']);

  if (!relationships || relationships.length === 0) return { topics: [], blog_ids: [] };

  const targetIds = [...new Set(relationships.map((r: any) => r.target_blog_id))].filter(
    (id) => !sourceIds.includes(id)
  );

  if (targetIds.length === 0) return { topics: [], blog_ids: [] };

  const { data: targetBlogs } = await supabase
    .from('public_blogs')
    .select('id, title')
    .in('id', targetIds)
    .eq('status', 'published');

  const topics = (targetBlogs ?? []).map((b: any) => b.title as string).filter(Boolean);
  const blog_ids = (targetBlogs ?? []).map((b: any) => b.id as string);

  return { topics, blog_ids };
}

// ---------------------------------------------------------------------------
// 2. Topic graph from intelligence signal edges
// ---------------------------------------------------------------------------

async function getRelatedTopicsFromSignalGraph(topic: string): Promise<string[]> {
  const tokens = tokenize(topic);
  if (tokens.length === 0) return [];

  // Find signals that match the topic
  const { data: signals } = await supabase
    .from('market_intelligence_signals')
    .select('id, topic')
    .not('topic', 'is', null)
    .limit(100);

  if (!signals || signals.length === 0) return [];

  const matched = signals
    .filter((s: any) => {
      const st = tokenize(s.topic ?? '');
      return jaccardSimilarity(tokens, st) > 0.2;
    })
    .map((s: any) => s.id as string)
    .slice(0, 10);

  if (matched.length === 0) return [];

  const { data: edges } = await supabase
    .from('intelligence_graph_edges')
    .select('source_signal_id, target_signal_id, edge_strength')
    .in('source_signal_id', matched)
    .eq('edge_type', 'topic_similarity')
    .gte('edge_strength', 0.25)
    .order('edge_strength', { ascending: false })
    .limit(20);

  if (!edges || edges.length === 0) return [];

  const targetIds = [...new Set((edges as any[]).map((e) => e.target_signal_id))];

  const { data: targetSignals } = await supabase
    .from('market_intelligence_signals')
    .select('topic')
    .in('id', targetIds)
    .not('topic', 'is', null);

  return [...new Set((targetSignals ?? []).map((s: any) => s.topic as string).filter(Boolean))].slice(0, 8);
}

// ---------------------------------------------------------------------------
// 3. Blogs matching a topic
// ---------------------------------------------------------------------------

export async function getBlogsForTopic(topic: string, limit = 5, companyId?: string | null): Promise<BlogSignal[]> {
  const cacheKey = `${topic}::${limit}::${companyId ?? ''}`;
  const cached = _blogTopicCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const tokens = tokenize(topic);
  if (tokens.length === 0) return [];

  const [publicResult, companyResult] = await Promise.allSettled([
    supabase
      .from('public_blogs')
      .select('id, title, slug, tags, excerpt')
      .eq('status', 'published')
      .limit(60),
    companyId
      ? supabase
          .from('blogs')
          .select('id, title, slug, tags, excerpt')
          .eq('status', 'published')
          .eq('company_id', companyId)
          .limit(30)
      : Promise.resolve({ data: null, error: null }),
  ]);

  const publicBlogs: any[] = publicResult.status === 'fulfilled' ? (publicResult.value.data ?? []) : [];
  const companyBlogs: any[] = companyResult.status === 'fulfilled' ? (companyResult.value.data ?? []) : [];

  const allBlogs = [
    ...publicBlogs.map((b) => ({ ...b, _source: 'omnivyra' as const })),
    ...companyBlogs.map((b) => ({ ...b, _source: 'company' as const })),
  ];

  if (allBlogs.length === 0) return [];

  const seen = new Set<string>();
  const ranked = allBlogs
    .map((b: any) => {
      const titleTokens = tokenize(b.title ?? '');
      const tagTokens = (b.tags ?? []).flatMap((t: string) => tokenize(t));
      const excerptTokens = tokenize(b.excerpt ?? '');
      const score = jaccardSimilarity(tokens, [...titleTokens, ...tagTokens, ...excerptTokens]);
      return {
        id: b.id,
        title: b.title ?? '',
        slug: b.slug ?? '',
        tags: b.tags ?? [],
        excerpt: b.excerpt ?? null,
        similarity_score: Math.round(score * 100) / 100,
        source: b._source as 'omnivyra' | 'company',
      };
    })
    .filter((b) => b.similarity_score > 0.1 && !seen.has(b.id) && (seen.add(b.id), true))
    .sort((a, b) => b.similarity_score - a.similarity_score)
    .slice(0, limit);

  _blogTopicCache.set(cacheKey, { result: ranked, expiresAt: Date.now() + BLOG_CACHE_TTL_MS });
  return ranked;
}

// ---------------------------------------------------------------------------
// 4. Build complete topic graph (combines both sources)
// ---------------------------------------------------------------------------

export async function buildTopicGraph(topic: string): Promise<TopicGraphResult> {
  const [blogGraph, signalTopics] = await Promise.allSettled([
    getRelatedTopicsFromBlogGraph(topic),
    getRelatedTopicsFromSignalGraph(topic),
  ]);

  const blogResult = blogGraph.status === 'fulfilled' ? blogGraph.value : { topics: [], blog_ids: [] };
  const signalResult = signalTopics.status === 'fulfilled' ? signalTopics.value : [];

  // Merge and deduplicate topics
  const seen = new Set<string>([topic.toLowerCase()]);
  const allTopics: string[] = [];
  const sources: Array<{ topic: string; source: string }> = [];

  for (const t of blogResult.topics) {
    if (!seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      allTopics.push(t);
      sources.push({ topic: t, source: 'blog_graph' });
    }
  }
  for (const t of signalResult) {
    if (!seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      allTopics.push(t);
      sources.push({ topic: t, source: 'signal_graph' });
    }
  }

  return {
    current_topic: topic,
    related_topics: allTopics.slice(0, 10),
    related_blog_ids: blogResult.blog_ids.slice(0, 5),
    sources,
  };
}

// ---------------------------------------------------------------------------
// 5. Upsert topic map for a campaign
// ---------------------------------------------------------------------------

export async function upsertCampaignTopicMap(
  campaignId: string,
  companyId: string,
  topic: string,
  graph: TopicGraphResult
): Promise<void> {
  await supabase
    .from('campaign_topic_map')
    .upsert(
      {
        campaign_id:    campaignId,
        company_id:     companyId,
        topic,
        related_topics: graph.related_topics,
        blog_ids:       graph.related_blog_ids,
        updated_at:     new Date().toISOString(),
      },
      { onConflict: 'campaign_id' }
    );
}

// ---------------------------------------------------------------------------
// 6. Read cached topic map
// ---------------------------------------------------------------------------

export async function getCampaignTopicMap(campaignId: string): Promise<{
  topic: string;
  related_topics: string[];
  blog_ids: string[];
} | null> {
  const { data } = await supabase
    .from('campaign_topic_map')
    .select('topic, related_topics, blog_ids')
    .eq('campaign_id', campaignId)
    .maybeSingle();

  if (!data) return null;
  return {
    topic:          data.topic ?? '',
    related_topics: data.related_topics ?? [],
    blog_ids:       data.blog_ids ?? [],
  };
}

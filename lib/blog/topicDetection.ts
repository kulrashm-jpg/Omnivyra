/**
 * Topic detection, duplication checking, and content gap analysis.
 * Pure functions — no DB calls, no side effects, no React imports.
 */

import type { ContentBlock } from './blockTypes';

// ── Stop words ────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'this','that','with','from','they','will','been','have','what','your',
  'when','more','about','into','than','then','some','also','which','there',
  'their','were','does','each','make','like','time','just','know','take',
  'people','year','good','very','through','before','after','because','should',
  'could','would','using','used','help','need','want','much','well','even',
  'also','only','still','over','back','every','most','both','those','these',
]);

// ── Text utilities ─────────────────────────────────────────────────────────────

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

// ── Topic extraction from blocks ──────────────────────────────────────────────

export interface ExtractedTopics {
  primaryTopic:    string;
  secondaryTopics: string[];
  keywords:        string[];
}

export function extractTopicsFromBlocks(
  title: string,
  blocks: ContentBlock[],
  tags:   string[],
): ExtractedTopics {
  const titleTokens = tokenize(title);
  const primaryTopic = titleTokens.slice(0, 4).join(' ');

  // H2 headings → secondary topics
  const secondaryTopics = blocks
    .filter((b) => b.type === 'heading' && (b as { level: number }).level === 2)
    .map((b) => (b as { text: string }).text)
    .filter(Boolean)
    .slice(0, 5);

  // Key Insights items → keyword signals
  const insightTokens = blocks
    .filter((b) => b.type === 'key_insights')
    .flatMap((b) => (b as { items: string[] }).items)
    .filter(Boolean)
    .flatMap(tokenize);

  const keywords = [...new Set([
    ...tags,
    ...titleTokens,
    ...insightTokens,
  ])].slice(0, 20);

  return { primaryTopic, secondaryTopics, keywords };
}

// ── Duplication detection ─────────────────────────────────────────────────────

export type DuplicationStatus = 'new' | 'partial' | 'duplicate';

export interface DuplicationResult {
  status:        DuplicationStatus;
  similarity:    number; // 0–1
  matchedTitles: { title: string; slug: string; sim: number }[];
}

export interface ExistingPostMeta {
  id:       string;
  title:    string;
  slug:     string;
  tags:     string[];
  category: string;
}

export function checkDuplication(
  newTitle:      string,
  newTags:       string[],
  existingPosts: ExistingPostMeta[],
): DuplicationResult {
  const newTokens = tokenize(newTitle);
  const newKw = [...new Set([...newTokens, ...newTags.flatMap(tokenize)])];

  let maxSim = 0;
  const matchedTitles: { title: string; slug: string; sim: number }[] = [];

  for (const post of existingPosts) {
    const postTokens = tokenize(post.title);
    const postKw = [...new Set([...postTokens, ...post.tags.flatMap(tokenize)])];

    const titleSim = jaccardSimilarity(newTokens, postTokens);
    const kwSim    = jaccardSimilarity(newKw, postKw);
    const combined = titleSim * 0.65 + kwSim * 0.35;

    if (combined > maxSim) maxSim = combined;
    if (combined >= 0.28) {
      matchedTitles.push({ title: post.title, slug: post.slug, sim: combined });
    }
  }

  matchedTitles.sort((a, b) => b.sim - a.sim);

  const status: DuplicationStatus =
    maxSim >= 0.55 ? 'duplicate' :
    maxSim >= 0.28 ? 'partial'   :
    'new';

  return { status, similarity: maxSim, matchedTitles: matchedTitles.slice(0, 3) };
}

// ── Topic cluster analysis ─────────────────────────────────────────────────────

export interface TopicCluster {
  name:     string;
  slug:     string;
  posts:    number;
  titles:   string[];
  coverage: number; // 0–100, caps at 5 posts = 100%
}

export function buildTopicClusters(
  posts: { title: string; tags: string[]; category: string | null }[],
): TopicCluster[] {
  const map = new Map<string, { posts: number; titles: string[] }>();

  function add(key: string, title: string) {
    if (!key.trim()) return;
    const norm = key.toLowerCase().trim();
    if (!map.has(norm)) map.set(norm, { posts: 0, titles: [] });
    const entry = map.get(norm)!;
    entry.posts++;
    if (!entry.titles.includes(title)) entry.titles.push(title);
  }

  for (const post of posts) {
    if (post.category) add(post.category, post.title);
    for (const tag of post.tags) add(tag, post.title);
  }

  return [...map.entries()]
    .map(([name, { posts, titles }]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      slug: name.replace(/\s+/g, '-'),
      posts,
      titles,
      coverage: Math.min(100, Math.round((posts / 5) * 100)),
    }))
    .filter((c) => c.posts >= 1)
    .sort((a, b) => b.posts - a.posts);
}

// ── Content gap analysis ───────────────────────────────────────────────────────

const PILLAR_TOPICS = [
  { name: 'AI Marketing Strategy',      slug: 'ai-marketing-strategy' },
  { name: 'Campaign Execution',         slug: 'campaign-execution' },
  { name: 'Content Distribution',       slug: 'content-distribution' },
  { name: 'Brand Positioning',          slug: 'brand-positioning' },
  { name: 'Marketing Automation',       slug: 'marketing-automation' },
  { name: 'Conversion Optimization',    slug: 'conversion-optimization' },
  { name: 'Audience Intelligence',      slug: 'audience-intelligence' },
  { name: 'Marketing Measurement',      slug: 'marketing-measurement' },
  { name: 'Thought Leadership',         slug: 'thought-leadership' },
  { name: 'Content Systems',            slug: 'content-systems' },
  { name: 'Momentum Modeling',          slug: 'momentum-modeling' },
  { name: 'Distribution Strategy',      slug: 'distribution-strategy' },
];

export type GapPriority = 'high' | 'medium' | 'low';

export interface ContentGap {
  topic:    string;
  slug:     string;
  priority: GapPriority;
  reason:   string;
  relatedTo: string[];
}

export function detectContentGaps(
  clusters:     TopicCluster[],
  existingPosts: ExistingPostMeta[],
): ContentGap[] {
  const coveredTerms = new Set(
    clusters.flatMap((c) => tokenize(c.name)),
  );

  const gaps: ContentGap[] = [];

  for (const pillar of PILLAR_TOPICS) {
    const tokens = tokenize(pillar.name);
    const overlap = tokens.filter((t) => coveredTerms.has(t)).length;
    const isCovered = overlap >= Math.ceil(tokens.length * 0.5);

    if (!isCovered) {
      // Find related existing posts (partial keyword overlap)
      const related = existingPosts
        .filter((p) => {
          const pTokens = tokenize(p.title + ' ' + p.tags.join(' '));
          return tokens.some((t) => pTokens.includes(t));
        })
        .map((p) => p.title)
        .slice(0, 2);

      gaps.push({
        topic:    pillar.name,
        slug:     pillar.slug,
        priority: related.length > 0 ? 'medium' : 'high',
        reason:   related.length > 0
          ? `Partially covered — deepen coverage to build authority`
          : `No content on this pillar topic — high authority opportunity`,
        relatedTo: related,
      });
    }
  }

  // Flag under-covered clusters (1 post only)
  clusters
    .filter((c) => c.posts === 1)
    .slice(0, 4)
    .forEach((c) => {
      gaps.push({
        topic:    `More on ${c.name}`,
        slug:     `${c.slug}-depth`,
        priority: 'low',
        reason:   `Only 1 article — series of 3+ builds topical authority`,
        relatedTo: c.titles,
      });
    });

  return gaps.slice(0, 10);
}

// ── Writing recommendations ────────────────────────────────────────────────────

export interface Recommendation {
  type:        'write' | 'optimize' | 'link' | 'series';
  priority:    GapPriority;
  action:      string;
  reason:      string;
  targetSlug?: string;
}

export function generateRecommendations(
  gaps:          ContentGap[],
  clusters:      TopicCluster[],
  existingPosts: (ExistingPostMeta & {
    views_count: number;
    has_summary: boolean;
    internal_links: number;
    references_count: number;
  })[],
): Recommendation[] {
  const recs: Recommendation[] = [];

  // Write recommendations from gaps
  for (const gap of gaps.slice(0, 3)) {
    recs.push({
      type:     'write',
      priority: gap.priority,
      action:   `Write: "${gap.topic}"`,
      reason:   gap.reason,
    });
  }

  // Optimize: posts missing summary
  existingPosts
    .filter((p) => !p.has_summary)
    .slice(0, 2)
    .forEach((p) => {
      recs.push({
        type:       'optimize',
        priority:   'medium',
        action:     `Add Summary to "${p.title}"`,
        reason:     'Missing summary reduces GEO readiness and reader retention',
        targetSlug: p.slug,
      });
    });

  // Link: posts with 0 internal links
  existingPosts
    .filter((p) => p.internal_links === 0)
    .slice(0, 2)
    .forEach((p) => {
      recs.push({
        type:       'link',
        priority:   'low',
        action:     `Add internal links to "${p.title}"`,
        reason:     'No internal links — hurts SEO and graph connectivity',
        targetSlug: p.slug,
      });
    });

  // Series: clusters with 3+ posts
  clusters
    .filter((c) => c.posts >= 3)
    .slice(0, 1)
    .forEach((c) => {
      recs.push({
        type:     'series',
        priority: 'medium',
        action:   `Create a series for "${c.name}"`,
        reason:   `${c.posts} articles on this topic — organise into a reading path`,
      });
    });

  return recs;
}

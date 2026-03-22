/**
 * Performance intelligence engine.
 * Pure functions — no DB calls, no React imports.
 * Operates on aggregated metrics returned by the intelligence API.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PostPerformance {
  id:              string;
  title:           string;
  slug:            string;
  category:        string | null;
  tags:            string[];
  status:          string;
  views_count:     number;
  likes_count:     number;
  comments_count:  number;
  // from blog_performance_summary
  session_count:   number;
  avg_time_seconds: number;
  avg_scroll_depth: number;
  completion_rate:  number;  // 0–100
  // from block analysis
  has_summary:     boolean;
  internal_links:  number;
  references_count: number;
  published_at:    string | null;
}

export interface PostMetrics extends PostPerformance {
  engagement_score: number;  // 0–100
  visibility_score: number;  // 0–100
  health:           'excellent' | 'good' | 'fair' | 'poor';
}

export type InsightSeverity = 'info' | 'warning' | 'critical';
export type InsightCategory = 'engagement' | 'visibility' | 'depth' | 'distribution' | 'structure';

export interface PerformanceInsight {
  severity:   InsightSeverity;
  category:   InsightCategory;
  message:    string;
  action:     string;
  targetSlug?: string;
  targetTitle?: string;
}

export interface TopicPerformance {
  category:        string;
  posts:           number;
  avg_views:       number;
  avg_engagement:  number;
  avg_completion:  number;
  top_post:        string;
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Engagement score (0–100).
 * Weights: like rate 35, completion 30, time 20, comment rate 15.
 */
export function computeEngagementScore(p: PostPerformance): number {
  if (p.views_count === 0) return 0;

  // Like rate: 5% = full 35 pts
  const likeRate  = p.likes_count / p.views_count;
  const likeScore = Math.min(likeRate / 0.05, 1) * 35;

  // Completion: direct %, max 30 pts
  const completionScore = (p.completion_rate / 100) * 30;

  // Avg time: 3 min target, max 20 pts
  const timeScore = p.session_count > 0
    ? Math.min(p.avg_time_seconds / 180, 1) * 20
    : 0;

  // Comment rate: 1% = full 15 pts
  const commentRate  = p.comments_count / p.views_count;
  const commentScore = Math.min(commentRate / 0.01, 1) * 15;

  return Math.round(likeScore + completionScore + timeScore + commentScore);
}

/**
 * Visibility score (0–100).
 * How well-discovered is this article relative to the corpus?
 * Weights: views percentile 60, in-series 20, has outgoing links 20.
 */
export function computeVisibilityScore(
  p:          PostPerformance,
  allViews:   number[],  // sorted ascending
  isInSeries: boolean,
): number {
  const rank = allViews.filter((v) => v <= p.views_count).length;
  const pct  = allViews.length > 1 ? rank / allViews.length : 0.5;
  const viewScore   = pct * 60;
  const seriesScore = isInSeries ? 20 : 0;
  const linkScore   = p.internal_links > 0 ? 20 : 0;
  return Math.round(viewScore + seriesScore + linkScore);
}

/**
 * Overall health label.
 */
export function computeHealth(engagementScore: number, visibilityScore: number): PostMetrics['health'] {
  const avg = (engagementScore + visibilityScore) / 2;
  if (avg >= 70) return 'excellent';
  if (avg >= 45) return 'good';
  if (avg >= 25) return 'fair';
  return 'poor';
}

// ── Full metrics computation ───────────────────────────────────────────────────

export function computeAllMetrics(
  posts:         PostPerformance[],
  seriesPostIds: Set<string>,  // blog IDs that are in at least one series
): PostMetrics[] {
  const publishedViews = posts
    .filter((p) => p.status === 'published')
    .map((p) => p.views_count)
    .sort((a, b) => a - b);

  return posts.map((p) => {
    const engagement_score = computeEngagementScore(p);
    const visibility_score = computeVisibilityScore(p, publishedViews, seriesPostIds.has(p.id));
    const health           = computeHealth(engagement_score, visibility_score);
    return { ...p, engagement_score, visibility_score, health };
  });
}

// ── Topic performance ─────────────────────────────────────────────────────────

export function computeTopicPerformance(metrics: PostMetrics[]): TopicPerformance[] {
  const grouped = new Map<string, PostMetrics[]>();

  for (const m of metrics.filter((m) => m.status === 'published')) {
    const cat = m.category ?? 'Uncategorised';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(m);
  }

  return [...grouped.entries()]
    .map(([category, posts]) => {
      const avg_views      = Math.round(posts.reduce((s, p) => s + p.views_count, 0) / posts.length);
      const avg_engagement = Math.round(posts.reduce((s, p) => s + p.engagement_score, 0) / posts.length);
      const avg_completion = Math.round(posts.reduce((s, p) => s + p.completion_rate, 0) / posts.length);
      const top_post       = [...posts].sort((a, b) => b.engagement_score - a.engagement_score)[0]?.title ?? '';
      return { category, posts: posts.length, avg_views, avg_engagement, avg_completion, top_post };
    })
    .sort((a, b) => b.avg_engagement - a.avg_engagement);
}

// ── Insight generation ────────────────────────────────────────────────────────

export function generatePerformanceInsights(
  metrics:       PostMetrics[],
  seriesPostIds: Set<string>,
): PerformanceInsight[] {
  const insights: PerformanceInsight[] = [];
  const published = metrics.filter((m) => m.status === 'published');

  for (const p of published) {
    // ── Visibility gaps ────────────────────────────────────────────────────
    if (p.views_count < 10 && p.internal_links === 0 && !seriesPostIds.has(p.id)) {
      insights.push({
        severity:   'warning',
        category:   'visibility',
        message:    `"${p.title}" has low visibility`,
        action:     'Add internal links from related articles or add to a series',
        targetSlug:  p.slug,
        targetTitle: p.title,
      });
    }

    // ── High views, low engagement ─────────────────────────────────────────
    if (p.views_count > 50 && p.engagement_score < 20) {
      insights.push({
        severity:   'warning',
        category:   'engagement',
        message:    `"${p.title}" gets traffic but low engagement`,
        action:     'Strengthen the hook, add a question at the end, or restructure Key Insights',
        targetSlug:  p.slug,
        targetTitle: p.title,
      });
    }

    // ── High drop-off (scroll depth < 35%) ────────────────────────────────
    if (p.session_count >= 5 && p.avg_scroll_depth < 35) {
      insights.push({
        severity:   'critical',
        category:   'engagement',
        message:    `"${p.title}" loses readers early (avg scroll: ${p.avg_scroll_depth}%)`,
        action:     'Rewrite the intro — move Key Insights to the top and tighten the first paragraph',
        targetSlug:  p.slug,
        targetTitle: p.title,
      });
    }

    // ── Low completion despite decent scroll ───────────────────────────────
    if (p.session_count >= 5 && p.avg_scroll_depth > 60 && p.completion_rate < 25) {
      insights.push({
        severity:   'warning',
        category:   'engagement',
        message:    `"${p.title}" stalls near the end (${p.avg_scroll_depth}% scroll, ${p.completion_rate}% complete)`,
        action:     'Strengthen the final third — add a Summary block or clearer conclusion',
        targetSlug:  p.slug,
        targetTitle: p.title,
      });
    }

    // ── No comments ────────────────────────────────────────────────────────
    if (p.views_count > 30 && p.comments_count === 0) {
      insights.push({
        severity:   'info',
        category:   'engagement',
        message:    `"${p.title}" has 0 comments`,
        action:     'End with an open question to invite discussion',
        targetSlug:  p.slug,
        targetTitle: p.title,
      });
    }

    // ── Missing summary ────────────────────────────────────────────────────
    if (!p.has_summary && p.views_count > 20) {
      insights.push({
        severity:   'warning',
        category:   'structure',
        message:    `"${p.title}" has no Summary block`,
        action:     'Add a Summary — improves GEO readiness and reader retention',
        targetSlug:  p.slug,
        targetTitle: p.title,
      });
    }

    // ── High performer — distribute ────────────────────────────────────────
    if (p.engagement_score >= 65 && p.views_count < 100) {
      insights.push({
        severity:   'info',
        category:   'distribution',
        message:    `"${p.title}" is high quality but under-reached`,
        action:     'Promote on LinkedIn, convert into a thread, or add to the newsletter',
        targetSlug:  p.slug,
        targetTitle: p.title,
      });
    }
  }

  // Sort: critical → warning → info
  const order: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return insights.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 20);
}

// ── Distribution queue ────────────────────────────────────────────────────────

export interface DistributionItem {
  slug:     string;
  title:    string;
  action:   string;
  channel:  string;
  reason:   string;
}

export function buildDistributionQueue(metrics: PostMetrics[]): DistributionItem[] {
  const queue: DistributionItem[] = [];

  for (const p of metrics.filter((m) => m.status === 'published')) {
    if (p.completion_rate >= 60 && p.views_count < 80) {
      queue.push({
        slug:    p.slug,
        title:   p.title,
        action:  'Promote',
        channel: 'LinkedIn',
        reason:  `${p.completion_rate}% completion — highly readable content`,
      });
    }
    if (p.avg_time_seconds > 120 && p.avg_scroll_depth > 70) {
      queue.push({
        slug:    p.slug,
        title:   p.title,
        action:  'Repurpose',
        channel: 'Twitter/X Thread',
        reason:  'Deep engagement — converts well to a multi-point thread',
      });
    }
    if (p.engagement_score >= 50 && p.likes_count >= 3) {
      queue.push({
        slug:    p.slug,
        title:   p.title,
        action:  'Include',
        channel: 'Newsletter',
        reason:  `Strong engagement score (${p.engagement_score}/100) — validated content`,
      });
    }
  }

  // Deduplicate by slug (keep first)
  const seen = new Set<string>();
  return queue.filter((d) => {
    const key = `${d.slug}:${d.channel}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

// ── Combined topic × performance narrative ────────────────────────────────────

export interface TopicNarrative {
  category: string;
  verdict:  'scale' | 'improve' | 'deprioritize';
  message:  string;
}

export function generateTopicNarratives(topics: TopicPerformance[]): TopicNarrative[] {
  return topics.map((t) => {
    if (t.avg_engagement >= 50 && t.posts >= 2) {
      return {
        category: t.category,
        verdict:  'scale',
        message:  `${t.category} is your strongest cluster (avg engagement ${t.avg_engagement}/100) — write more`,
      };
    }
    if (t.avg_engagement < 25 && t.avg_views > 30) {
      return {
        category: t.category,
        verdict:  'improve',
        message:  `${t.category} gets traffic but low engagement (${t.avg_engagement}/100) — improve structure and hooks`,
      };
    }
    return {
      category: t.category,
      verdict:  'deprioritize',
      message:  `${t.category} has low reach and engagement — validate demand before investing more`,
    };
  });
}

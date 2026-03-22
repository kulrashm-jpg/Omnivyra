/**
 * Content Growth Engine
 * Classifies post performance, generates amplification/recovery actions,
 * and models the authority-building loop.
 * Pure functions — no DB calls, no React imports.
 */

import type { PostMetrics } from './performanceEngine';

// ── Performance classification ─────────────────────────────────────────────────

export type PerformanceClass = 'high' | 'medium' | 'low';

export function classifyPost(m: PostMetrics): PerformanceClass {
  if (m.engagement_score >= 60 && m.visibility_score >= 35) return 'high';
  if (m.engagement_score >= 28 || m.visibility_score >= 18) return 'medium';
  return 'low';
}

// ── Growth actions (shared type for amplification + recovery) ─────────────────

export interface GrowthAction {
  type:     string;
  priority: 'critical' | 'high' | 'medium';
  label:    string;
  reason:   string;
  icon:     string;
}

// ── Amplification (high/medium performers) ────────────────────────────────────

export function getAmplificationActions(
  m: PostMetrics,
  isInSeries: boolean,
): GrowthAction[] {
  const actions: GrowthAction[] = [];

  if (m.engagement_score >= 55) {
    actions.push({
      type: 'promote_linkedin', priority: 'high',
      label: 'Promote on LinkedIn',
      reason: `Engagement score ${Math.round(m.engagement_score)}/100 — this resonates with professional audiences`,
      icon: '💼',
    });
  }

  if (m.completion_rate >= 55) {
    actions.push({
      type: 'promote_newsletter', priority: 'high',
      label: 'Feature in newsletter',
      reason: `${Math.round(m.completion_rate)}% of readers finish it — newsletter subscribers will engage strongly`,
      icon: '📧',
    });
  }

  if (m.engagement_score >= 40) {
    actions.push({
      type: 'promote_twitter', priority: 'medium',
      label: 'Convert to Twitter/X thread',
      reason: 'Strong engagement — key insights translate naturally to a thread format',
      icon: '🐦',
    });
  }

  if (!isInSeries && m.engagement_score >= 45) {
    actions.push({
      type: 'add_to_series', priority: 'medium',
      label: 'Add to a reading series',
      reason: 'Strong standalone piece — placing it in a series compounds authority over time',
      icon: '📚',
    });
  }

  if (m.views_count >= 200 || m.engagement_score >= 65) {
    actions.push({
      type: 'follow_up', priority: 'high',
      label: 'Write a follow-up article',
      reason: 'High-performing content signals reader demand — a deeper sequel extends your authority',
      icon: '✍️',
    });
  }

  if (m.engagement_score >= 60) {
    actions.push({
      type: 'republish', priority: 'medium',
      label: 'Refresh & republish',
      reason: 'Top-performing evergreen content benefits from periodic re-promotion to new audiences',
      icon: '🔄',
    });
  }

  return actions;
}

// ── Recovery (underperforming posts) ──────────────────────────────────────────

export function getRecoveryActions(m: PostMetrics): GrowthAction[] {
  const actions: GrowthAction[] = [];

  if (m.views_count < 50) {
    actions.push({
      type: 'improve_title', priority: 'critical',
      label: 'Rewrite the title',
      reason: 'Very low views suggest the title isn\'t compelling enough to drive clicks from search or social',
      icon: '📝',
    });
    actions.push({
      type: 'improve_seo', priority: 'critical',
      label: 'Update SEO meta description',
      reason: 'A strong meta description improves search CTR and surfaces this in AI-generated answers',
      icon: '🔍',
    });
  }

  if (m.avg_scroll_depth < 30 && m.session_count >= 3) {
    actions.push({
      type: 'improve_intro', priority: 'critical',
      label: 'Rewrite the opening paragraph',
      reason: `Avg scroll depth ${Math.round(m.avg_scroll_depth)}% — readers leave before the body starts`,
      icon: '🚦',
    });
  }

  if (!m.has_summary) {
    actions.push({
      type: 'add_summary', priority: 'high',
      label: 'Add a TL;DR summary block',
      reason: 'Summaries improve skimmability and completion rate — especially for longer posts',
      icon: '💡',
    });
  }

  if (m.internal_links === 0) {
    actions.push({
      type: 'add_internal_links', priority: 'high',
      label: 'Add internal links',
      reason: 'No internal links — missed opportunity to retain readers and strengthen topic cluster authority',
      icon: '🔗',
    });
  }

  if (m.references_count === 0) {
    actions.push({
      type: 'add_references', priority: 'high',
      label: 'Add source references',
      reason: 'No references reduces credibility and lowers AI citation (GEO) potential',
      icon: '📋',
    });
  }

  if (m.completion_rate < 20 && m.avg_scroll_depth >= 45) {
    actions.push({
      type: 'strengthen_conclusion', priority: 'medium',
      label: 'Strengthen the conclusion',
      reason: 'Readers scroll through the body but don\'t complete — the ending may feel unresolved',
      icon: '🎯',
    });
  }

  if (m.likes_count === 0 && m.views_count >= 30) {
    actions.push({
      type: 'add_cta', priority: 'medium',
      label: 'Add a clear call-to-action',
      reason: 'Readers visit but don\'t engage — a CTA prompts likes, shares, and further reading',
      icon: '👆',
    });
  }

  return actions;
}

// ── Authority building loop ────────────────────────────────────────────────────

export type LoopStage = 'write' | 'optimize' | 'repurpose' | 'distribute' | 'engage' | 'expand';

export interface AuthorityStage {
  stage:       LoopStage;
  label:       string;
  description: string;
  status:      'done' | 'ready' | 'pending';
}

export function buildAuthorityLoop(
  m: PostMetrics,
  isInSeries: boolean,
): AuthorityStage[] {
  const published   = m.status === 'published';
  const optimized   = m.has_summary && m.internal_links > 0 && m.references_count >= 2;
  const distributed = m.views_count >= 80;
  const engaged     = m.engagement_score >= 30;
  const expanded    = isInSeries || m.engagement_score >= 65;

  return [
    {
      stage: 'write',
      label: 'Write',
      description: 'Publish a high-quality, structured blog post',
      status: published ? 'done' : 'ready',
    },
    {
      stage: 'optimize',
      label: 'Optimize',
      description: 'Add summary, internal links, references, SEO meta',
      status: optimized ? 'done' : published ? 'ready' : 'pending',
    },
    {
      stage: 'repurpose',
      label: 'Repurpose',
      description: 'Convert into LinkedIn posts, Twitter thread, email',
      status: optimized ? 'ready' : 'pending',
    },
    {
      stage: 'distribute',
      label: 'Distribute',
      description: 'Share across channels and send to newsletter',
      status: distributed ? 'done' : optimized ? 'ready' : 'pending',
    },
    {
      stage: 'engage',
      label: 'Engage',
      description: 'Track metrics, respond to comments, measure ROI',
      status: engaged ? 'done' : distributed ? 'ready' : 'pending',
    },
    {
      stage: 'expand',
      label: 'Expand',
      description: 'Write follow-up, join series, identify new topic gaps',
      status: expanded ? 'done' : engaged ? 'ready' : 'pending',
    },
  ];
}

// ── Portfolio summary ─────────────────────────────────────────────────────────

export interface GrowthSummary {
  highCount:     number;
  mediumCount:   number;
  lowCount:      number;
  avgEngagement: number;
  topPost:       PostMetrics | null;
  quickWins:     PostMetrics[];
}

export function buildGrowthSummary(
  metrics: PostMetrics[],
): GrowthSummary {
  let highCount = 0, mediumCount = 0, lowCount = 0;
  let topPost: PostMetrics | null = null;
  const quickWins: PostMetrics[] = [];

  for (const m of metrics) {
    const cls = classifyPost(m);
    if (cls === 'high') {
      highCount++;
    } else if (cls === 'medium') {
      mediumCount++;
      if (m.engagement_score >= 44 || m.completion_rate >= 38) quickWins.push(m);
    } else {
      lowCount++;
    }
    if (!topPost || m.engagement_score > topPost.engagement_score) topPost = m;
  }

  const avgEngagement = metrics.length
    ? Math.round(metrics.reduce((s, m) => s + m.engagement_score, 0) / metrics.length)
    : 0;

  return {
    highCount, mediumCount, lowCount, avgEngagement, topPost,
    quickWins: quickWins.sort((a, b) => b.engagement_score - a.engagement_score).slice(0, 3),
  };
}

import type { CompanyBlogIntelligenceResult, PostIntelligence } from '../../lib/blog/companyBlogIntelligenceService';
import {
  buildExpectedUpside,
  classifyPriorityType,
  comparePriorityType,
  describePriorityType,
  type PriorityType,
} from './actionPriorityService';

type ReportType = 'snapshot' | 'performance' | 'growth';

type ReportViewInsight = {
  text: string;
  icon: 'alert' | 'trend';
  whyItMatters: string;
  businessImpact: string;
};

type ReportViewMetric = {
  label: string;
  score: number;
  color: string;
};

type ReportViewOpportunity = {
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  priority: string;
};

type ReportViewNextStep = {
  action: string;
  description: string;
  steps: string[];
  reasoning: string;
  tactics: string[];
  focusPage: string;
  timeline: {
    short: string;
    mid: string;
    long: string;
  };
  priority: 'high' | 'medium' | 'low';
  impact: 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
  confidence: number;
  expectedOutcome: string;
  expectedUpside: string;
  impactScore: number;
  effortLevel: 'low' | 'medium' | 'high';
  priorityType: PriorityType;
  priorityWhy: string;
};

type ReportViewTopPriority = {
  title: string;
  whyNow: string;
  expectedOutcome: string;
  expectedUpside: string;
  effortLevel: 'low' | 'medium' | 'high';
  priorityType: PriorityType;
  priorityWhy: string;
  impactScore: number;
  confidenceScore: number;
  impactLabel: string;
  timeToImpact: string;
};

function sortReportActions<T extends { priorityType: PriorityType; impactScore: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => comparePriorityType(left, right));
}

function normalizeImpact(impactScore?: number): 'high' | 'medium' | 'low' {
  const value = Number(impactScore ?? 0);
  if (value >= 75) return 'high';
  if (value >= 40) return 'medium';
  return 'low';
}

function buildPriorityImpactLabel(impactScore?: number, confidenceScore?: number): string {
  const impact = Number(impactScore ?? 0);
  const confidence = Number(confidenceScore ?? 0);
  if (impact >= 80 || confidence >= 0.8) return 'High impact';
  if (impact >= 55 || confidence >= 0.6) return 'Medium impact';
  return 'Emerging impact';
}

function buildPriorityTimeToImpact(
  effortLevel?: 'low' | 'medium' | 'high',
  confidenceScore?: number,
): string {
  const confidence = Number(confidenceScore ?? 0);
  if (effortLevel === 'low' && confidence >= 0.65) return '1-2 weeks';
  if (effortLevel === 'medium' || confidence >= 0.45) return '2-4 weeks';
  return '4-8 weeks';
}

function buildFallbackTopPriorities(nextSteps: ReportViewNextStep[]): ReportViewTopPriority[] {
  return sortReportActions(nextSteps).slice(0, 3).map((step, index) => {
    const confidenceScore = Math.max(0.45, 0.8 - index * 0.12);
    const impactScore = Math.max(55, 82 - index * 10);
    const priorityType = classifyPriorityType({
      impactScore,
      effortLevel: step.effortLevel,
    });
    return {
      title: step.action,
      whyNow: step.description || 'This action has strong near-term leverage.',
      expectedOutcome: step.expectedOutcome,
      expectedUpside: step.expectedUpside,
      effortLevel: step.effortLevel,
      priorityType,
      priorityWhy: describePriorityType(priorityType),
      impactScore,
      confidenceScore,
      impactLabel: buildPriorityImpactLabel(impactScore, confidenceScore),
      timeToImpact: buildPriorityTimeToImpact(step.effortLevel, confidenceScore),
    };
  });
}

function healthToScore(health: PostIntelligence['scores']['health']): number {
  switch (health) {
    case 'excellent': return 85;
    case 'good': return 65;
    case 'fair': return 40;
    case 'poor': return 15;
    default: return 50;
  }
}

export function mapSnapshot(
  intel: CompanyBlogIntelligenceResult,
  reportId: string,
  companyId: string,
  domain: string,
  generatedDate: string,
  generated_at: string,
  is_stale: boolean,
  engine_version: string,
): any {
  const { posts, portfolio } = intel;
  const { growth_summary, authority } = portfolio;

  const avgEngagement = posts.length > 0 ? Math.round(posts.reduce((s, p) => s + p.scores.engagement, 0) / posts.length) : 0;
  const topPosts = [...posts].sort((a, b) => b.scores.engagement - a.scores.engagement).slice(0, 3);
  const atRisk = posts.filter((p) => p.scores.health === 'fair' || p.scores.health === 'poor').slice(0, 3);

  const insights: ReportViewInsight[] = [
    ...topPosts.map((p) => ({
      text: `"${p.title}" — ${p.scores.engagement}% engagement score`,
      icon: 'trend' as const,
      whyItMatters: 'This content is driving authority. Amplify and cross-link it.',
      businessImpact: 'Strong content performance supports qualified traffic, buyer trust, and downstream pipeline efficiency.',
    })),
    ...atRisk.map((p) => ({
      text: `"${p.title}" is ${p.scores.health} — needs attention`,
      icon: 'alert' as const,
      whyItMatters: p.recovery_actions[0]?.reason ?? 'Improving this post recovers lost visibility and ranking potential.',
      businessImpact: 'Underperforming content can reduce organic traffic and weaken the conversion path from content to pipeline.',
    })),
  ];

  const metrics: ReportViewMetric[] = [
    { label: 'Avg Engagement', score: avgEngagement, color: 'from-blue-400 to-blue-600' },
    { label: 'Authority Stage', score: authority.stages.findIndex((s) => s.label === authority.current_stage) * 25, color: 'from-purple-400 to-purple-600' },
    { label: 'Content Health', score: Math.round(posts.reduce((s, p) => s + healthToScore(p.scores.health), 0) / Math.max(posts.length, 1)), color: 'from-green-400 to-green-600' },
  ];

  const opportunities: ReportViewOpportunity[] = atRisk.map((p) => ({
    title: p.title,
    description: p.recovery_actions[0]?.reason ?? 'Review and improve content quality.',
    impact: p.scores.health === 'poor' ? 'high' : 'medium',
    priority: p.scores.health === 'poor' ? 'Fix immediately' : 'Plan next',
  }));

  const nextSteps: ReportViewNextStep[] = growth_summary.quickWins.slice(0, 4).map((action) => {
    const effortLevel: 'low' | 'medium' | 'high' = 'medium';
    const priorityType = classifyPriorityType({ impactScore: 68, effortLevel });
    return {
      action: action.title,
      description: action.title,
      steps: [],
      reasoning: '',
      tactics: [],
      focusPage: '',
      timeline: { short: '', mid: '', long: '' },
      priority: 'medium',
      impact: 'medium',
      effort: effortLevel,
      confidence: 0,
      expectedOutcome: 'This action should improve visibility, trust, or conversion readiness.',
      expectedUpside: buildExpectedUpside({
        priorityType,
        impactScore: 68,
        expectedOutcome: 'This action should improve visibility, trust, or conversion readiness.',
      }),
      impactScore: 68,
      effortLevel,
      priorityType,
      priorityWhy: describePriorityType(priorityType),
    };
  });
  const topPriorities = buildFallbackTopPriorities(nextSteps);

  return {
    reportId,
    companyId,
    domain,
    reportType: 'snapshot' as ReportType,
    generatedDate,
    generated_at,
    is_stale,
    engine_version,
    status: 'completed',
    title: 'Digital Authority Snapshot',
    diagnosis: growth_summary.topPost ? `Top performing content: "${growth_summary.topPost.title}"` : 'Your content portfolio needs focused attention.',
    summary: `${growth_summary.highCount} high-performing posts, ${growth_summary.mediumCount} medium, ${growth_summary.lowCount} low.`,
    overallScore: avgEngagement,
    confidenceSource: `Based on ${posts.length} published posts`,
    insights,
    metrics,
    opportunities,
    topPriorities,
    nextSteps,
  };
}

export function mapPerformance(
  intel: CompanyBlogIntelligenceResult,
  reportId: string,
  companyId: string,
  domain: string,
  generatedDate: string,
  generated_at: string,
  is_stale: boolean,
  engine_version: string,
): any {
  const { posts } = intel;

  const healthCounts = { excellent: 0, good: 0, fair: 0, poor: 0 };
  for (const p of posts) healthCounts[p.scores.health] = (healthCounts[p.scores.health] ?? 0) + 1;

  const avgVisibility = posts.length > 0 ? Math.round(posts.reduce((s, p) => s + p.scores.visibility, 0) / posts.length) : 0;
  const avgEngagement = posts.length > 0 ? Math.round(posts.reduce((s, p) => s + p.scores.engagement, 0) / posts.length) : 0;

  const insights: ReportViewInsight[] = [
    {
      text: `${healthCounts.excellent + healthCounts.good} posts are healthy, ${healthCounts.poor} are poor`,
      icon: 'trend',
      whyItMatters: 'Health distribution directly maps to ranking and reader retention.',
      businessImpact: 'A weak content-health mix can suppress traffic recovery and lower the efficiency of content-led conversion.',
    },
    {
      text: `Average visibility score: ${avgVisibility}%`,
      icon: avgVisibility < 50 ? 'alert' : 'trend',
      whyItMatters: 'Visibility below 50% means most content is not being discovered.',
      businessImpact: 'Lower visibility reduces qualified traffic entering the funnel and limits the pool of visitors who can convert.',
    },
    {
      text: `Average engagement score: ${avgEngagement}%`,
      icon: avgEngagement < 40 ? 'alert' : 'trend',
      whyItMatters: 'Low engagement signals a content-audience fit problem.',
      businessImpact: 'Weak engagement usually lowers conversion quality because visitors are not finding enough relevance to keep moving.',
    },
  ];

  const metrics: ReportViewMetric[] = [
    { label: 'Avg Visibility', score: avgVisibility, color: 'from-blue-500 to-blue-700' },
    { label: 'Avg Engagement', score: avgEngagement, color: 'from-purple-500 to-purple-700' },
    { label: 'Healthy Posts', score: Math.round(((healthCounts.excellent + healthCounts.good) / Math.max(posts.length, 1)) * 100), color: 'from-green-500 to-green-700' },
  ];

  const opportunities: ReportViewOpportunity[] = posts
    .filter((p) => p.recovery_actions.length > 0)
    .slice(0, 5)
    .map((p) => ({
      title: p.title,
      description: p.recovery_actions[0]?.reason ?? '',
      impact: p.scores.health === 'poor' ? 'high' : 'medium',
      priority: p.scores.health === 'poor' ? 'Fix immediately' : 'Plan next',
    }));

  const nextSteps: ReportViewNextStep[] = posts
    .filter((p) => p.recovery_actions.length > 0)
    .slice(0, 4)
    .map((p) => {
      const effortLevel: 'low' | 'medium' | 'high' = p.scores.health === 'poor' ? 'high' : 'medium';
      const impactScore = p.scores.health === 'poor' ? 82 : 66;
      const priorityType = classifyPriorityType({ impactScore, effortLevel });
      return {
        action: `Improve: ${p.title}`,
        description: p.recovery_actions[0]?.reason ?? '',
        steps: [],
        reasoning: '',
        tactics: [],
        focusPage: '',
        timeline: { short: '', mid: '', long: '' },
        priority: p.scores.health === 'poor' ? 'high' : 'medium',
        impact: p.scores.health === 'poor' ? 'high' : 'medium',
        effort: effortLevel,
        confidence: 0,
        expectedOutcome: 'This should improve the page health and recover lost performance.',
        expectedUpside: buildExpectedUpside({
          priorityType,
          impactScore,
          actionType: 'improve_content',
          expectedOutcome: 'This should improve the page health and recover lost performance.',
        }),
        impactScore,
        effortLevel,
        priorityType,
        priorityWhy: describePriorityType(priorityType),
      };
    });
  const topPriorities = buildFallbackTopPriorities(nextSteps);

  return {
    reportId,
    companyId,
    domain,
    reportType: 'performance' as ReportType,
    generatedDate,
    generated_at,
    is_stale,
    engine_version,
    status: 'completed',
    title: 'Performance Intelligence Report',
    diagnosis:
      avgEngagement < 40
        ? 'Content engagement is below threshold — reader fit requires realignment.'
        : 'Solid engagement base with recovery opportunities to unlock.',
    summary: `Your portfolio has ${posts.length} posts. ${healthCounts.excellent + healthCounts.good} are healthy, ${healthCounts.fair + healthCounts.poor} need recovery action.`,
    overallScore: Math.round((avgVisibility + avgEngagement) / 2),
    confidenceSource: `Derived from ${posts.length} post performance records`,
    insights,
    metrics,
    opportunities,
    topPriorities,
    nextSteps,
  };
}

export function mapGrowth(
  intel: CompanyBlogIntelligenceResult,
  reportId: string,
  companyId: string,
  domain: string,
  generatedDate: string,
  generated_at: string,
  is_stale: boolean,
  engine_version: string,
): any {
  const { portfolio, gaps } = intel;
  const { authority, topic_performance, recommendations } = portfolio;

  const insights: ReportViewInsight[] = [
    {
      text: `Authority stage: ${authority.current_stage}`,
      icon: 'trend',
      whyItMatters: 'Authority stage determines which content investments unlock the next growth tier.',
      businessImpact: 'Authority strength affects how efficiently the business can win traffic, trust, and revenue in competitive topics.',
    },
    ...gaps.items.slice(0, 2).map((gap) => ({
      text: `Content gap: "${gap.topic}"`,
      icon: 'alert' as const,
      whyItMatters: gap.reason ?? 'Filling this gap directly expands your search footprint.',
      businessImpact: 'Open topic gaps limit discoverability and reduce the chances of converting buyers during research and evaluation.',
    })),
    ...topic_performance.slice(0, 2).map((tp) => ({
      text: `Topic "${tp.category}": ${tp.verdict}`,
      icon: tp.verdict === 'scale' ? ('trend' as const) : ('alert' as const),
      whyItMatters: tp.narrative,
      businessImpact:
        tp.verdict === 'scale'
          ? 'Strong topic performance creates leverage for more traffic, stronger trust, and better revenue capture.'
          : 'Weak topic performance leaves demand uncaptured and can slow both traffic growth and revenue contribution.',
    })),
  ];

  const metrics: ReportViewMetric[] = topic_performance.slice(0, 4).map((tp) => ({
    label: tp.category,
    score: Math.round(tp.avg_engagement ?? 0),
    color: tp.verdict === 'scale' ? 'from-emerald-400 to-teal-600' : 'from-orange-400 to-red-500',
  }));

  const opportunities: ReportViewOpportunity[] = gaps.items.slice(0, 6).map((gap) => ({
    title: gap.topic,
    description: gap.reason ?? 'No content exists for this topic yet.',
    impact: gap.priority === 'high' ? 'high' : gap.priority === 'medium' ? 'medium' : 'low',
    priority: gap.priority === 'high' ? 'Fix immediately' : 'Plan next',
  }));

  const nextSteps: ReportViewNextStep[] = recommendations.slice(0, 5).map((rec, index) => {
    const effortLevel: 'low' | 'medium' | 'high' = 'medium';
    const impactScore = Math.max(60, 78 - index * 6);
    const priorityType = classifyPriorityType({ impactScore, effortLevel });
    return {
      action: rec.action,
      description: rec.reason,
      steps: [],
      reasoning: '',
      tactics: [],
      focusPage: '',
      timeline: { short: '', mid: '', long: '' },
      priority: 'medium',
      impact: 'medium',
      effort: effortLevel,
      confidence: 0,
      expectedOutcome: 'This should expand search footprint or strengthen authority.',
      expectedUpside: buildExpectedUpside({
        priorityType,
        impactScore,
        expectedOutcome: 'This should expand search footprint or strengthen authority.',
      }),
      impactScore,
      effortLevel,
      priorityType,
      priorityWhy: describePriorityType(priorityType),
    };
  });
  const topPriorities = buildFallbackTopPriorities(nextSteps);

  return {
    reportId,
    companyId,
    domain,
    reportType: 'growth' as ReportType,
    generatedDate,
    generated_at,
    is_stale,
    engine_version,
    status: 'completed',
    title: 'Market & Growth Intelligence Report',
    diagnosis: `You are at the "${authority.current_stage}" authority stage with ${gaps.items.length} topic gaps to close.`,
    summary: `${recommendations.length} strategic recommendations identified across ${topic_performance.length} tracked topics.`,
    overallScore: Math.round(topic_performance.reduce((s, tp) => s + (tp.avg_engagement ?? 0), 0) / Math.max(topic_performance.length, 1)),
    confidenceSource: `Based on topic cluster analysis across ${topic_performance.length} topics`,
    insights,
    metrics,
    opportunities,
    topPriorities,
    nextSteps,
  };
}

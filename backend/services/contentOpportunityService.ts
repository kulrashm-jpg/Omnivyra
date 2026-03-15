/**
 * Content Opportunity Service
 * Converts engagement signals into structured content opportunities.
 * Uses engagement_thread_classification, pattern detection, lead signals,
 * topic growth, engagement velocity, and learning feedback.
 */

import { supabase } from '../db/supabaseClient';
import { getTrendingTopics } from './trendingTopicsService';
import { getLearningMetrics } from './opportunityLearningService';

const MAX_MESSAGES_SCAN = 500;
const CACHE_TTL_MS = 60 * 1000;
const TOP_OPPORTUNITIES = 10;

const WEIGHT_CLASSIFICATION = 0.4;
const WEIGHT_PATTERN = 0.2;
const WEIGHT_LEAD = 0.2;
const WEIGHT_TOPIC_GROWTH = 0.1;
const WEIGHT_ENGAGEMENT_VELOCITY = 0.1;

const QUESTION_PATTERNS = /\b(how to|best way to|what is|how do|can you|does it)\b|\?/gi;
const PROBLEM_PATTERNS = /\b(issue|problem|struggling|error|bug|broken|fix)\b/gi;
const COMPARISON_PATTERNS = /\b(vs\.?|versus|alternative|compare|comparison|better than)\b/gi;
const FEATURE_PATTERNS = /\b(feature request|wish it had|would be nice|would love|please add)\b/gi;

export type ContentOpportunityType =
  | 'tutorial'
  | 'comparison'
  | 'explainer'
  | 'thought_leadership'
  | 'product_announcement'
  | 'landing_page';

export type ContentOpportunity = {
  topic: string;
  opportunity_type: ContentOpportunityType;
  suggested_title: string;
  signal_summary: {
    questions: number;
    problems: number;
    comparisons: number;
    feature_requests: number;
  };
  confidence_score: number;
  source_signals?: string[];
  quality_warning?: boolean;
};

const CLASSIFICATION_TO_OPPORTUNITY: Record<string, ContentOpportunityType> = {
  question_request: 'tutorial',
  recommendation_request: 'comparison',
  product_comparison: 'comparison',
  competitor_complaint: 'thought_leadership',
  problem_discussion: 'explainer',
};

const cache = new Map<string, { data: ContentOpportunity[]; expires: number }>();

function countMatches(content: string | null, patterns: RegExp): number {
  if (!content || typeof content !== 'string') return 0;
  const m = content.match(patterns);
  return m ? m.length : 0;
}

export async function generateContentOpportunities(
  organizationId: string,
  windowHours: number = 72
): Promise<ContentOpportunity[]> {
  const cacheKey = `${organizationId}:${windowHours}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expires) return cached.data;

  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  const { data: threads } = await supabase
    .from('engagement_threads')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('ignored', false);
  const threadIds = (threads ?? []).map((t: { id: string }) => t.id);
  if (threadIds.length === 0) return [];

  const { data: messages } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, content')
    .in('thread_id', threadIds)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES_SCAN);

  const msgList = (messages ?? []) as Array<{ id: string; thread_id: string; content: string | null }>;

  const { data: leads } = await supabase
    .from('engagement_lead_signals')
    .select('thread_id')
    .eq('organization_id', organizationId)
    .in('thread_id', threadIds);
  const leadThreads = new Set((leads ?? []).map((r: { thread_id: string }) => r.thread_id));

  const { data: classifications } = await supabase
    .from('engagement_thread_classification')
    .select('thread_id, classification_category, sentiment')
    .eq('organization_id', organizationId)
    .in('thread_id', threadIds);
  const classificationByThread = new Map<
    string,
    { classification_category: string; sentiment: string | null }
  >();
  (classifications ?? []).forEach(
    (c: { thread_id: string; classification_category: string; sentiment?: string | null }) => {
      classificationByThread.set(c.thread_id, {
        classification_category: c.classification_category ?? '',
        sentiment: c.sentiment ?? null,
      });
    }
  );

  const topics = await getTrendingTopics(organizationId, windowHours);
  const topTopicLabels =
    topics.length > 0
      ? topics.slice(0, 5).map((t) => t.topic.toLowerCase())
      : ['engagement'];

  const now = Date.now();
  const cutoff24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const cutoff48h = new Date(now - 48 * 60 * 60 * 1000).toISOString();
  const cutoff6h = new Date(now - 6 * 60 * 60 * 1000).toISOString();

  const { data: msg24h } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, content')
    .in('thread_id', threadIds)
    .gte('created_at', cutoff24h)
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES_SCAN);
  const msg24List = (msg24h ?? []) as Array<{ id: string; thread_id: string; content: string | null }>;

  const { data: msgPrev24h } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, content')
    .in('thread_id', threadIds)
    .gte('created_at', cutoff48h)
    .lt('created_at', cutoff24h)
    .limit(MAX_MESSAGES_SCAN);
  const msgPrev24List = (msgPrev24h ?? []) as Array<{ id: string; thread_id: string; content: string | null }>;

  const { data: msg6h } = await supabase
    .from('engagement_messages')
    .select('id, thread_id')
    .in('thread_id', threadIds)
    .gte('created_at', cutoff6h);
  const msg6List = (msg6h ?? []) as Array<{ id: string; thread_id: string }>;

  const topicCount24h = new Map<string, number>();
  const topicCountPrev24h = new Map<string, number>();
  for (const t of topTopicLabels) {
    topicCount24h.set(t, 0);
    topicCountPrev24h.set(t, 0);
  }
  for (const m of msg24List) {
    const c = (m.content ?? '').toLowerCase();
    for (const t of topTopicLabels) {
      if (c.includes(t)) topicCount24h.set(t, (topicCount24h.get(t) ?? 0) + 1);
    }
  }
  for (const m of msgPrev24List) {
    const c = (m.content ?? '').toLowerCase();
    for (const t of topTopicLabels) {
      if (c.includes(t)) topicCountPrev24h.set(t, (topicCountPrev24h.get(t) ?? 0) + 1);
    }
  }

  const msgCountByThread6h = new Map<string, number>();
  for (const m of msg6List) {
    msgCountByThread6h.set(m.thread_id, (msgCountByThread6h.get(m.thread_id) ?? 0) + 1);
  }
  const totalThreads6h = msgCountByThread6h.size || 1;
  const totalMsgs6h = msg6List.length;
  const avgMessagesPerThread6h = totalMsgs6h / totalThreads6h;
  const engagementVelocityNorm = Math.min(1, avgMessagesPerThread6h / 5);

  const learningMetrics = await getLearningMetrics(organizationId);

  type TopicSignal = {
    questions: number;
    problems: number;
    comparisons: number;
    feature_requests: number;
    leadThreads: number;
    classificationTutorial: number;
    classificationComparison: number;
    classificationExplainer: number;
    classificationThoughtLeadership: number;
  };

  const topicSignals = new Map<string, TopicSignal>();

  for (const topic of topTopicLabels) {
    topicSignals.set(topic, {
      questions: 0,
      problems: 0,
      comparisons: 0,
      feature_requests: 0,
      leadThreads: 0,
      classificationTutorial: 0,
      classificationComparison: 0,
      classificationExplainer: 0,
      classificationThoughtLeadership: 0,
    });
  }

  const threadsCountedForLead = new Map<string, Set<string>>();
  const threadsCountedForClass = new Map<string, Set<string>>();
  for (const topic of topTopicLabels) {
    threadsCountedForLead.set(topic, new Set());
    threadsCountedForClass.set(topic, new Set());
  }

  for (const msg of msgList) {
    const content = (msg.content ?? '').toString();
    const q = countMatches(content, QUESTION_PATTERNS);
    const p = countMatches(content, PROBLEM_PATTERNS);
    const c = countMatches(content, COMPARISON_PATTERNS);
    const f = countMatches(content, FEATURE_PATTERNS);

    const contentLower = content.toLowerCase();
    let matchedTopic: string | null = null;
    for (const t of topTopicLabels) {
      if (contentLower.includes(t)) {
        matchedTopic = t;
        break;
      }
    }
    if (!matchedTopic) {
      matchedTopic = topTopicLabels[0] ?? 'engagement';
    }
    const sig = topicSignals.get(matchedTopic);
    if (!sig) continue;

    sig.questions += q;
    sig.problems += p;
    sig.comparisons += c;
    sig.feature_requests += f;

    const leadCounted = threadsCountedForLead.get(matchedTopic);
    if (
      leadThreads.has(msg.thread_id) &&
      leadCounted &&
      !leadCounted.has(msg.thread_id)
    ) {
      leadCounted.add(msg.thread_id);
      sig.leadThreads += 1;
    }

    const cl = classificationByThread.get(msg.thread_id);
    const counted = threadsCountedForClass.get(matchedTopic);
    if (cl && counted && !counted.has(msg.thread_id)) {
      const oppType = CLASSIFICATION_TO_OPPORTUNITY[cl.classification_category];
      if (oppType === 'tutorial') {
        sig.classificationTutorial += 1;
        counted.add(msg.thread_id);
      } else if (oppType === 'comparison') {
        sig.classificationComparison += 1;
        counted.add(msg.thread_id);
      } else if (oppType === 'explainer') {
        sig.classificationExplainer += 1;
        counted.add(msg.thread_id);
      } else if (oppType === 'thought_leadership') {
        sig.classificationThoughtLeadership += 1;
        counted.add(msg.thread_id);
      }
    }
  }

  const opportunities: ContentOpportunity[] = [];

  for (const [topic, sig] of topicSignals.entries()) {
    const hasPattern =
      sig.questions + sig.problems + sig.comparisons + sig.feature_requests > 0;
    const hasClassification =
      sig.classificationTutorial +
        sig.classificationComparison +
        sig.classificationExplainer +
        sig.classificationThoughtLeadership >
      0;
    if (!hasPattern && sig.leadThreads === 0 && !hasClassification) {
      continue;
    }

    const topicTitle = topic
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    const signal_summary = {
      questions: sig.questions,
      problems: sig.problems,
      comparisons: sig.comparisons,
      feature_requests: sig.feature_requests,
    };

    let opportunity_type: ContentOpportunityType = 'thought_leadership';
    let suggested_title: string;
    let usedClassification = false;

    if (sig.leadThreads > 0) {
      opportunity_type = 'landing_page';
      suggested_title = `Landing page: ${topicTitle} solutions`;
    } else if (hasClassification) {
      usedClassification = true;
      const classCounts = [
        { t: 'tutorial' as const, c: sig.classificationTutorial },
        { t: 'comparison' as const, c: sig.classificationComparison },
        { t: 'explainer' as const, c: sig.classificationExplainer },
        { t: 'thought_leadership' as const, c: sig.classificationThoughtLeadership },
      ];
      const best = classCounts.reduce((a, b) => (b.c > a.c ? b : a));
      opportunity_type = best.t;
      if (best.c > 0) {
        if (opportunity_type === 'tutorial') {
          suggested_title = `How to Choose the Best ${topicTitle}`;
        } else if (opportunity_type === 'comparison') {
          suggested_title = `${topicTitle} Comparison: Best Options`;
        } else if (opportunity_type === 'explainer') {
          suggested_title = `${topicTitle}: Common Issues and Solutions`;
        } else {
          suggested_title = `Thought leadership: ${topicTitle} insights`;
        }
      } else {
        suggested_title = `Thought leadership: ${topicTitle} insights`;
      }
    } else {
      if (sig.questions > 2) {
        opportunity_type = 'tutorial';
        suggested_title = `How to Choose the Best ${topicTitle}`;
      } else if (sig.problems > 2) {
        opportunity_type = 'explainer';
        suggested_title = `${topicTitle}: Common Issues and Solutions`;
      } else if (sig.comparisons > 1) {
        opportunity_type = 'comparison';
        suggested_title = `${topicTitle} Comparison: Best Options`;
      } else if (sig.feature_requests > 0) {
        opportunity_type = 'product_announcement';
        suggested_title = `Product update: ${topicTitle} features`;
      } else {
        suggested_title = `Thought leadership: ${topicTitle} insights`;
      }
    }

    const patternStrength = Math.min(
      1,
      (sig.questions + sig.problems + sig.comparisons + sig.feature_requests) / 10
    );
    const leadStrength = sig.leadThreads > 0 ? 1 : 0;
    const prev24 = topicCountPrev24h.get(topic) ?? 0;
    const curr24 = topicCount24h.get(topic) ?? 0;
    const topicGrowthStrength =
      prev24 > 0 ? Math.min(1, Math.max(0, (curr24 - prev24) / prev24 + 0.5)) : curr24 > 0 ? 0.5 : 0;
    const engagementVelocityStrength = engagementVelocityNorm;

    const sourceSignals: string[] = [];
    if (usedClassification) sourceSignals.push('classification');
    if (patternStrength > 0) sourceSignals.push('pattern');
    if (leadStrength > 0) sourceSignals.push('lead');
    if (topicGrowthStrength > 0) sourceSignals.push('topic_growth');
    if (engagementVelocityStrength > 0) sourceSignals.push('engagement_velocity');

    let confidence_score =
      (usedClassification ? WEIGHT_CLASSIFICATION : 0) +
      WEIGHT_PATTERN * patternStrength +
      WEIGHT_LEAD * leadStrength +
      WEIGHT_TOPIC_GROWTH * topicGrowthStrength +
      WEIGHT_ENGAGEMENT_VELOCITY * engagementVelocityStrength;
    if (confidence_score === 0) confidence_score = 0.25;
    confidence_score = Math.min(1, Math.max(0, confidence_score));

    const lm = learningMetrics.get(opportunity_type);
    if (lm && lm.approval_rate > 0) {
      confidence_score *= lm.approval_rate;
    }
    confidence_score = Math.min(1, Math.max(0, confidence_score));

    const quality_warning = lm ? lm.approval_rate < 0.2 : false;

    opportunities.push({
      topic: topicTitle,
      opportunity_type,
      suggested_title,
      signal_summary,
      confidence_score: Math.min(0.98, Math.round(confidence_score * 100) / 100),
      source_signals: sourceSignals.length > 0 ? sourceSignals : undefined,
      quality_warning: quality_warning || undefined,
    });
  }

  opportunities.sort((a, b) => b.confidence_score - a.confidence_score);
  const result = opportunities.slice(0, TOP_OPPORTUNITIES);
  cache.set(cacheKey, { data: result, expires: Date.now() + CACHE_TTL_MS });
  return result;
}

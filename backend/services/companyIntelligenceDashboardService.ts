/**
 * Company Intelligence Dashboard Service
 * Phase-4: Aggregates company signals into dashboard categories.
 */

import { supabase } from '../db/supabaseClient';
import { refineLanguageOutput } from './languageRefinementService';

const SIGNALS_PER_CATEGORY = 10;
const DASHBOARD_FETCH_LIMIT = 200;
const DEFAULT_WINDOW_HOURS = 168; // 7 days

export type DashboardSignal = {
  signal_id: string;
  topic: string | null;
  signal_score: number;
  priority_level: string | null;
  matched_topics: string[] | null;
  matched_competitors: string[] | null;
  matched_regions: string[] | null;
  created_at: string | null;
};

export type DashboardSignalsResponse = {
  market_signals: DashboardSignal[];
  competitor_signals: DashboardSignal[];
  product_signals: DashboardSignal[];
  marketing_signals: DashboardSignal[];
  partnership_signals: DashboardSignal[];
};

type FetchedSignal = {
  signal_id: string;
  topic: string | null;
  signal_score: number | null;
  priority_level: string | null;
  matched_topics: string[] | null;
  matched_competitors: string[] | null;
  matched_regions: string[] | null;
  created_at: string | null;
};

type Category = 'competitor' | 'product' | 'partnership' | 'marketing' | 'market';

const PRODUCT_TERMS = /product|launch|release|feature|platform|saas|software|tool|app/i;
const MARKETING_TERMS = /campaign|ads|advertising|brand|engagement|content|marketing|social media|influencer/i;
const PARTNERSHIP_TERMS = /partnership|alliance|collaboration|acquisition|merge|joint venture|deal/i;

function hasCompetitorMatch(s: FetchedSignal): boolean {
  return s.matched_competitors != null && s.matched_competitors.length > 0;
}

function hasTopicMatch(s: FetchedSignal): boolean {
  return s.matched_topics != null && s.matched_topics.length > 0;
}

function hasProductMatch(s: FetchedSignal): boolean {
  const topic = (s.topic ?? '').toLowerCase();
  if (PRODUCT_TERMS.test(topic)) return true;
  const topics = s.matched_topics ?? [];
  return topics.some((t) => PRODUCT_TERMS.test(t.toLowerCase()));
}

function hasMarketingMatch(s: FetchedSignal): boolean {
  const topic = (s.topic ?? '').toLowerCase();
  return MARKETING_TERMS.test(topic);
}

function hasPartnershipMatch(s: FetchedSignal): boolean {
  const topic = (s.topic ?? '').toLowerCase();
  return PARTNERSHIP_TERMS.test(topic);
}

function hasMarketMatch(s: FetchedSignal): boolean {
  return hasTopicMatch(s) && !hasCompetitorMatch(s);
}

/**
 * Fetch recent company signals ordered by signal_score DESC.
 */
export async function fetchCompanySignals(
  companyId: string,
  windowHours: number = DEFAULT_WINDOW_HOURS
): Promise<FetchedSignal[]> {
  const since = new Date();
  since.setHours(since.getHours() - windowHours);
  const sinceStr = since.toISOString();

  const { data, error } = await supabase
    .from('company_intelligence_signals')
    .select(
      'signal_id, signal_score, priority_level, matched_topics, matched_competitors, matched_regions, created_at, intelligence_signals!inner(topic)'
    )
    .eq('company_id', companyId)
    .gte('created_at', sinceStr)
    .order('signal_score', { ascending: false, nullsFirst: false })
    .limit(DASHBOARD_FETCH_LIMIT);

  if (error) throw new Error(`fetchCompanySignals failed: ${error.message}`);

  const rows = (data ?? []) as Array<{
    signal_id: string;
    signal_score: number | null;
    priority_level: string | null;
    matched_topics: string[] | null;
    matched_competitors: string[] | null;
    matched_regions: string[] | null;
    created_at: string | null;
    intelligence_signals: { topic: string | null } | { topic: string | null }[] | null;
  }>;

  const getTopic = (rel: { topic?: string | null } | { topic?: string | null }[] | null): string | null => {
    if (!rel) return null;
    const r = Array.isArray(rel) ? rel[0] : rel;
    return (r as { topic?: string | null })?.topic ?? null;
  };

  return rows.map((r) => ({
    signal_id: r.signal_id,
    topic: getTopic(r.intelligence_signals),
    signal_score: r.signal_score ?? 0,
    priority_level: r.priority_level,
    matched_topics: r.matched_topics,
    matched_competitors: r.matched_competitors,
    matched_regions: r.matched_regions,
    created_at: r.created_at,
  }));
}

/**
 * Assign signals to categories. Priority: Competitor → Product → Partnership → Marketing → Market.
 */
export function categorizeSignals(signals: FetchedSignal[]): Record<Category, FetchedSignal[]> {
  const result: Record<Category, FetchedSignal[]> = {
    competitor: [],
    product: [],
    partnership: [],
    marketing: [],
    market: [],
  };

  const assigned = new Set<string>();

  for (const s of signals) {
    if (assigned.has(s.signal_id)) continue;

    if (hasCompetitorMatch(s)) {
      result.competitor.push(s);
      assigned.add(s.signal_id);
      continue;
    }
    if (hasProductMatch(s)) {
      result.product.push(s);
      assigned.add(s.signal_id);
      continue;
    }
    if (hasPartnershipMatch(s)) {
      result.partnership.push(s);
      assigned.add(s.signal_id);
      continue;
    }
    if (hasMarketingMatch(s)) {
      result.marketing.push(s);
      assigned.add(s.signal_id);
      continue;
    }
    if (hasMarketMatch(s)) {
      result.market.push(s);
      assigned.add(s.signal_id);
    }
  }

  return result;
}

function toDashboardSignal(s: FetchedSignal): DashboardSignal {
  return {
    signal_id: s.signal_id,
    topic: s.topic,
    signal_score: s.signal_score,
    priority_level: s.priority_level,
    matched_topics: s.matched_topics,
    matched_competitors: s.matched_competitors,
    matched_regions: s.matched_regions,
    created_at: s.created_at,
  };
}

async function refineSignal(s: FetchedSignal): Promise<DashboardSignal> {
  let topic = s.topic;
  let matched_topics = s.matched_topics;
  let matched_competitors = s.matched_competitors;
  let matched_regions = s.matched_regions;

  if (topic != null && typeof topic === 'string' && topic.trim()) {
    const r = await refineLanguageOutput({ content: topic, card_type: 'general' });
    topic = (r.refined as string) || topic;
  }
  if (Array.isArray(matched_topics) && matched_topics.length > 0) {
    const r = await refineLanguageOutput({ content: matched_topics, card_type: 'general' });
    matched_topics = (Array.isArray(r.refined) ? r.refined : [r.refined as string]) || matched_topics;
  }
  if (Array.isArray(matched_competitors) && matched_competitors.length > 0) {
    const r = await refineLanguageOutput({ content: matched_competitors, card_type: 'general' });
    matched_competitors = (Array.isArray(r.refined) ? r.refined : [r.refined as string]) || matched_competitors;
  }
  if (Array.isArray(matched_regions) && matched_regions.length > 0) {
    const r = await refineLanguageOutput({ content: matched_regions, card_type: 'general' });
    matched_regions = (Array.isArray(r.refined) ? r.refined : [r.refined as string]) || matched_regions;
  }

  return {
    signal_id: s.signal_id,
    topic,
    signal_score: s.signal_score ?? 0,
    priority_level: s.priority_level,
    matched_topics,
    matched_competitors,
    matched_regions,
    created_at: s.created_at,
  };
}

/**
 * Main service method. Build dashboard structure with top signals per category.
 */
export async function buildDashboardSignals(
  companyId: string,
  windowHours: number = DEFAULT_WINDOW_HOURS
): Promise<DashboardSignalsResponse> {
  const signals = await fetchCompanySignals(companyId, windowHours);
  const categorized = categorizeSignals(signals);

  const market = await Promise.all(
    categorized.market.slice(0, SIGNALS_PER_CATEGORY).map(refineSignal)
  );
  const competitor = await Promise.all(
    categorized.competitor.slice(0, SIGNALS_PER_CATEGORY).map(refineSignal)
  );
  const product = await Promise.all(
    categorized.product.slice(0, SIGNALS_PER_CATEGORY).map(refineSignal)
  );
  const marketing = await Promise.all(
    categorized.marketing.slice(0, SIGNALS_PER_CATEGORY).map(refineSignal)
  );
  const partnership = await Promise.all(
    categorized.partnership.slice(0, SIGNALS_PER_CATEGORY).map(refineSignal)
  );

  return {
    market_signals: market,
    competitor_signals: competitor,
    product_signals: product,
    marketing_signals: marketing,
    partnership_signals: partnership,
  };
}

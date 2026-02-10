import { NextApiRequest, NextApiResponse } from 'next';
import { generateRecommendations } from '../../../backend/services/recommendationEngineService';
import { getCompanyDefaultApiIds } from '../../../backend/services/externalApiService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getProfile } from '../../../backend/services/companyProfileService';
import { supabase } from '../../../backend/db/supabaseClient';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { generateRecommendation } from '../../../backend/services/aiGateway';
import {
  countActive,
  upsertOpportunities,
  listActiveOpportunities,
  MAX_SLOTS_PER_TYPE,
  type OpportunityItem,
  type OpportunityInput,
} from '../../../backend/services/opportunityService';

const DEFAULT_LOOKBACK_DAYS = 90;

const riskFromConfidence = (confidence: number) => {
  if (confidence >= 0.75) return 'Low';
  if (confidence >= 0.5) return 'Medium';
  return 'High';
};

const normalizeTopic = (value: string) => {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const computePriorityScore = (trend: any) => {
  const finalScore =
    typeof trend.final_score === 'number'
      ? trend.final_score
      : typeof trend.score === 'number'
      ? trend.score
      : null;
  const confidence =
    typeof trend.confidence === 'number'
      ? trend.confidence
      : typeof trend.signal_confidence === 'number'
      ? trend.signal_confidence
      : 0.6;
  const signalConfidence =
    typeof trend.signal_confidence === 'number' ? trend.signal_confidence : confidence;

  if (typeof finalScore === 'number') {
    return finalScore * 0.5 + confidence * 0.3 + signalConfidence * 0.2;
  }
  return confidence;
};

const buildSignalExplanation = (signals: string[]) => {
  const signalCopy: Record<string, string> = {
    topic_overlap_detected: 'This overlaps with topics used in a recent campaign.',
    related_to_recent_campaign: 'This is related to a recent campaign you ran.',
    possible_campaign_continuation: 'This could continue momentum from a previous campaign.',
    novel_theme: 'This appears to be a new theme for your brand.',
  };
  return signals.map((signal) => signalCopy[signal]).filter(Boolean);
};

const clampReasoning = (value: string) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.slice(0, 2).join(' ');
};

const normalizeList = (value?: string | null): string[] =>
  String(value || '')
    .split(/[,;/|]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);

const buildAudienceKeywords = (profile: any): string[] => {
  const list = Array.isArray(profile?.target_audience_list)
    ? profile.target_audience_list
    : normalizeList(profile?.target_audience);
  return list.map((item: string) => String(item).toLowerCase()).filter(Boolean);
};

const computeAudienceMatch = (topic: string, keywords: string[]) => {
  if (!keywords.length) return 0;
  const lower = String(topic || '').toLowerCase();
  const matches = keywords.filter((keyword) => keyword && lower.includes(keyword)).length;
  return Math.min(1, matches / keywords.length);
};

const clampScore = (value: number) => Math.max(0, Math.min(1, value));

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, campaignId } = req.query;
    if (!companyId || typeof companyId !== 'string' || !campaignId || typeof campaignId !== 'string') {
      return res.status(400).json({ error: 'companyId and campaignId are required' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId,
      requireCampaignId: true,
    });
    if (!access) return;

    const defaultApiIds = await getCompanyDefaultApiIds(companyId);
    const profile = await getProfile(companyId, { autoRefine: false });
    const audienceKeywords = buildAudienceKeywords(profile);
    const profileCategory =
      (profile?.category && String(profile.category)) ||
      (Array.isArray(profile?.industry_list) && profile.industry_list[0]) ||
      null;

    const since = new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: previousRows, error: previousError } = await supabase
      .from('recommendation_snapshots')
      .select('trend_topic,final_score,confidence,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since);
    if (previousError) {
      console.warn('OPPORTUNITY_HISTORY_LOAD_FAILED', previousError.message);
    }
    const previousTopicCounts: Record<string, number> = {};
    const incrementTopicCount = (topic: string) => {
      if (!topic) return;
      previousTopicCounts[topic] = (previousTopicCounts[topic] ?? 0) + 1;
    };
    const previousTopicsMap = (previousRows || []).reduce<Record<string, number>>((acc, row: any) => {
      const topic = normalizeTopic(row?.trend_topic || '');
      if (!topic) return acc;
      const previousScore =
        typeof row?.final_score === 'number'
          ? row.final_score
          : typeof row?.confidence === 'number'
          ? row.confidence
          : 0;
      acc[topic] = Math.max(acc[topic] ?? 0, previousScore);
      incrementTopicCount(topic);
      return acc;
    }, {});

    const { data: auditRows, error: auditError } = await supabase
      .from('audit_logs')
      .select('metadata,created_at')
      .eq('company_id', companyId)
      .in('action', [
        'RECOMMENDATION_DRAFT_PLAN_REQUESTED',
        'RECOMMENDATION_USED_FOR_PLANNING',
        'PREVIEW_ACCEPTED_FOR_PLANNING',
      ])
      .gte('created_at', since);
    if (auditError) {
      console.warn('OPPORTUNITY_AUDIT_HISTORY_LOAD_FAILED', auditError.message);
    }
    const snapshotHashes = new Set<string>();
    const recommendationIds = new Set<string>();
    (auditRows || []).forEach((row: any) => {
      const meta = row?.metadata || {};
      const topic = normalizeTopic(meta?.topic || '');
      if (topic) {
        previousTopicsMap[topic] = Math.max(previousTopicsMap[topic] ?? 0, 0);
        incrementTopicCount(topic);
      }
      if (typeof meta?.snapshot_hash === 'string' && meta.snapshot_hash) {
        snapshotHashes.add(meta.snapshot_hash);
      }
      if (typeof meta?.recommendation_id === 'string' && meta.recommendation_id) {
        recommendationIds.add(meta.recommendation_id);
      }
    });

    if (snapshotHashes.size > 0) {
      const { data: snapshotRows, error: snapshotError } = await supabase
        .from('recommendation_snapshots')
        .select('trend_topic,final_score,confidence,snapshot_hash')
        .in('snapshot_hash', Array.from(snapshotHashes));
      if (snapshotError) {
        console.warn('OPPORTUNITY_SNAPSHOT_LOOKUP_FAILED', snapshotError.message);
      }
      (snapshotRows || []).forEach((row: any) => {
        const topic = normalizeTopic(row?.trend_topic || '');
        if (!topic) return;
        const previousScore =
          typeof row?.final_score === 'number'
            ? row.final_score
            : typeof row?.confidence === 'number'
            ? row.confidence
            : 0;
        previousTopicsMap[topic] = Math.max(previousTopicsMap[topic] ?? 0, previousScore);
        incrementTopicCount(topic);
      });
    }

    if (recommendationIds.size > 0) {
      const { data: recRows, error: recError } = await supabase
        .from('recommendation_snapshots')
        .select('trend_topic,final_score,confidence,id')
        .in('id', Array.from(recommendationIds));
      if (recError) {
        console.warn('OPPORTUNITY_RECOMMENDATION_LOOKUP_FAILED', recError.message);
      }
      (recRows || []).forEach((row: any) => {
        const topic = normalizeTopic(row?.trend_topic || '');
        if (!topic) return;
        const previousScore =
          typeof row?.final_score === 'number'
            ? row.final_score
            : typeof row?.confidence === 'number'
            ? row.confidence
            : 0;
        previousTopicsMap[topic] = Math.max(previousTopicsMap[topic] ?? 0, previousScore);
        incrementTopicCount(topic);
      });
    }

    let recommendationContext: Record<string, any> | null = null;
    const result = await generateRecommendations(
      {
        companyId,
        campaignId,
        simulate: true,
        selectedApiIds: defaultApiIds,
        userId: access.userId,
      },
      {
        onContext: (context) => {
          recommendationContext = context;
        },
      }
    );

    const trendReasoningMap = new Map<string, string>();
    const trendSignals = Array.isArray(recommendationContext?.trend_reasoning)
      ? recommendationContext?.trend_reasoning
      : [];
    trendSignals.forEach((entry: any) => {
      const topic = normalizeTopic(entry?.topic || '');
      if (!topic) return;
      const explanations = buildSignalExplanation(entry?.signals || []);
      if (explanations.length > 0) {
        trendReasoningMap.set(topic, explanations.join(' '));
      }
    });

    const opportunities = (result.trends_used || []).map((trend: any) => {
      const confidence =
        typeof trend.signal_confidence === 'number' ? trend.signal_confidence : 0.6;
      const source =
        trend.source || (Array.isArray(trend.sources) ? trend.sources[0] : undefined) || 'unknown';
      const priorityScore = computePriorityScore(trend);
      const normalizedTopic = normalizeTopic(trend.topic || '');
      const platformTags = new Set<string>();
      if (trend.platform_tag) {
        platformTags.add(String(trend.platform_tag).toLowerCase());
      }
      const platformCount = platformTags.size;
      const reusePotentialRaw = trend.reuse_potential ?? trend.reusePotential ?? null;
      const reusePotentialScore =
        reusePotentialRaw === 'High Reuse'
          ? 1
          : reusePotentialRaw === 'Single Channel'
          ? 0.2
          : platformCount > 1
          ? 0.6
          : 0.2;
      const audienceMatch = computeAudienceMatch(trend.topic || '', audienceKeywords);
      const growthOpportunityScore = clampScore(
        priorityScore * 0.45 +
          Math.min(1, platformCount / 3) * 0.15 +
          reusePotentialScore * 0.2 +
          audienceMatch * 0.2
      );
      const growthBucket =
        growthOpportunityScore >= 0.65 ? 'High' : growthOpportunityScore >= 0.4 ? 'Medium' : 'Low';
      return {
        topic: String(trend.topic || ''),
        category: trend.category || profileCategory,
        confidence,
        source,
        risk_level: riskFromConfidence(confidence),
        priority_score: priorityScore,
        trend_reasoning: trendReasoningMap.get(normalizedTopic) || null,
        growth_opportunity_score: Number(growthOpportunityScore.toFixed(3)),
        growth_bucket: growthBucket,
      };
    });

    const explanationFallback = clampReasoning(result.explanation || '');
    const needsReasoning = opportunities.filter((item) => !item.trend_reasoning);
    if (needsReasoning.length > 0 && !explanationFallback) {
      try {
        if (process.env.OPENAI_API_KEY) {
          const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
          const message =
            'Provide 1-2 sentence reasons why each topic is trending. Return JSON only:\n' +
            '{ "items": [{ "topic": "...", "reason": "..." }] }\n' +
            'Use the topic, category, source, confidence, and priority_score.\n' +
            `Items:\n${JSON.stringify(
              needsReasoning.map((item) => ({
                topic: item.topic,
                category: item.category,
                source: item.source,
                confidence: item.confidence,
                priority_score: item.priority_score,
              })),
              null,
              2
            )}`;
          const completion = await generateRecommendation({
            companyId,
            model,
            temperature: 0.4,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: 'You summarize trend reasons for marketers.' },
              { role: 'user', content: message },
            ],
          });
          const parsed = completion.output || {};
          const items = Array.isArray(parsed?.items) ? parsed.items : [];
          const reasonMap = new Map<string, string>();
          items.forEach((entry: any) => {
            const topic = normalizeTopic(entry?.topic || '');
            const reason = clampReasoning(entry?.reason || '');
            if (topic && reason) {
              reasonMap.set(topic, reason);
            }
          });
          opportunities.forEach((item) => {
            if (!item.trend_reasoning) {
              const reason = reasonMap.get(normalizeTopic(item.topic));
              if (reason) item.trend_reasoning = reason;
            }
          });
        }
      } catch (error) {
        console.warn('OPPORTUNITY_REASONING_FAILED', error);
      }
    }

    if (explanationFallback) {
      opportunities.forEach((item) => {
        if (!item.trend_reasoning) {
          item.trend_reasoning = explanationFallback;
        }
      });
    }

    const deduped = new Map<string, any>();
    opportunities.forEach((opportunity) => {
      const normalized = normalizeTopic(opportunity.topic);
      if (!normalized) return;
      const previousMax = previousTopicsMap[normalized];
      const newScore = opportunity.priority_score;
      const allowed =
        typeof previousMax === 'number' && previousMax > 0
          ? newScore >= previousMax * 1.15
          : true;
      console.debug('Opportunity suppression check', {
        topic: opportunity.topic,
        previous_max_score: typeof previousMax === 'number' ? previousMax : null,
        new_priority_score: newScore,
        allowed,
      });
      if (!allowed) return;
      const existing = deduped.get(normalized);
      if (!existing || existing.priority_score < newScore) {
        deduped.set(normalized, opportunity);
      }
    });

    const minFrequency =
      Object.values(previousTopicCounts).length > 0
        ? Math.min(...Object.values(previousTopicCounts))
        : 0;
    const classified = Array.from(deduped.values()).map((opportunity) => {
      const normalized = normalizeTopic(opportunity.topic);
      const previousMax = previousTopicsMap[normalized];
      const frequency = previousTopicCounts[normalized] ?? 0;
      const isWildcard =
        typeof previousMax !== 'number' || previousMax <= 0 || (minFrequency > 0 && frequency === minFrequency);
      const priority = opportunity.priority_score;
      let trendClassification = 'Wildcard';
      if (!isWildcard) {
        if (priority >= 0.6) trendClassification = 'Momentum';
        else if (priority >= 0.35) trendClassification = 'Emerging';
      }
      return {
        ...opportunity,
        trend_classification: trendClassification,
      };
    });

    const momentum = classified
      .filter((item) => item.trend_classification === 'Momentum')
      .sort((a, b) => b.priority_score - a.priority_score);
    const emerging = classified
      .filter((item) => item.trend_classification === 'Emerging')
      .sort((a, b) => b.priority_score - a.priority_score);
    const wildcard = classified
      .filter((item) => item.trend_classification === 'Wildcard')
      .sort((a, b) => b.priority_score - a.priority_score);

    const selected: any[] = [];
    const take = (list: any[], count: number) => {
      const picked = list.splice(0, count);
      selected.push(...picked);
      return count - picked.length;
    };
    let remainingMomentum = take(momentum, 7);
    let remainingEmerging = take(emerging, 2);
    let remainingWildcard = take(wildcard, 1);

    if (remainingEmerging > 0) {
      remainingEmerging = take(momentum, remainingEmerging);
    }
    if (remainingWildcard > 0) {
      remainingWildcard = take(emerging, remainingWildcard);
      if (remainingWildcard > 0) {
        remainingWildcard = take(momentum, remainingWildcard);
      }
    }
    if (remainingMomentum > 0) {
      remainingMomentum = take(emerging, remainingMomentum);
      if (remainingMomentum > 0) {
        remainingMomentum = take(wildcard, remainingMomentum);
      }
    }

    const finalMap = new Map<string, any>();
    selected
      .sort((a, b) => b.priority_score - a.priority_score)
      .forEach((item) => {
        const normalized = normalizeTopic(item.topic);
        if (!normalized) return;
        if (!finalMap.has(normalized)) {
          finalMap.set(normalized, item);
        }
      });
    const filtered = Array.from(finalMap.values());

    console.debug('Diversified opportunity mix', {
      momentumCount: momentum.length,
      emergingCount: emerging.length,
      wildcardCount: wildcard.length,
    });

    // Persist to opportunity_items (type PULSE), respecting ACTIVE slot limit
    const activeCount = await countActive(companyId, 'PULSE');
    const slotsAvailable = Math.max(0, MAX_SLOTS_PER_TYPE - activeCount);
    const toUpsert = filtered.slice(0, slotsAvailable).map((item: any): OpportunityInput => ({
      title: String(item.topic || ''),
      summary: item.trend_reasoning ?? null,
      problem_domain: item.category ?? null,
      region_tags: [],
      source_refs: { source: item.source ?? 'pulse' },
      conversion_score: typeof item.priority_score === 'number' ? Math.round(item.priority_score * 100) : null,
      payload: {
        category: item.category ?? null,
        source: item.source ?? null,
        risk_level: item.risk_level ?? null,
        trend_classification: item.trend_classification ?? null,
        growth_opportunity_score: item.growth_opportunity_score ?? null,
        growth_bucket: item.growth_bucket ?? null,
      },
    }));

    if (toUpsert.length > 0) {
      await upsertOpportunities(companyId, 'PULSE', toUpsert);
    }

    const rows = await listActiveOpportunities(companyId, 'PULSE');
    const payload = (row: OpportunityItem) => (row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {});

    const opportunities = rows.map((row) => ({
      id: row.id,
      topic: row.title,
      category: payload(row).category ?? null,
      confidence: row.conversion_score != null ? row.conversion_score / 100 : null,
      source: payload(row).source ?? 'pulse',
      risk_level: payload(row).risk_level ?? null,
      priority_score: row.conversion_score != null ? row.conversion_score / 100 : null,
      trend_classification: payload(row).trend_classification ?? null,
      trend_reasoning: row.summary ?? null,
      growth_opportunity_score: row.conversion_score != null ? row.conversion_score / 100 : null,
      growth_bucket: payload(row).growth_bucket ?? null,
    }));

    return res.status(200).json({ opportunities });
  } catch (error) {
    console.error('Error loading detected opportunities:', error);
    return res.status(500).json({ error: 'Failed to load detected opportunities' });
  }
}

export default withRBAC(handler, [
  Role.COMPANY_ADMIN,
  Role.CONTENT_CREATOR,
  Role.CONTENT_MANAGER,
  Role.SUPER_ADMIN,
]);

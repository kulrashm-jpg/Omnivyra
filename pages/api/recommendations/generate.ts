import { NextApiRequest, NextApiResponse } from 'next';
import { generateRecommendations } from '../../../backend/services/recommendationEngineService';
import { getCompanyDefaultApiIds } from '../../../backend/services/externalApiService';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getProfile } from '../../../backend/services/companyProfileService';
import { generateRecommendation } from '../../../backend/services/aiGateway';
import { getStrategyHistoryForCompany } from '../../../backend/services/strategyHistoryService';
import { formatForUserOutput } from '../../../backend/utils/refineUserFacingResponse';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      companyId,
      regions: regionsBody,
      campaignId,
      enrichmentEnabled,
      objective,
      durationWeeks: bodyDurationWeeks,
      simulate,
      chat,
      selected_api_ids,
      manual_context,
      strategicPayload,
      insight_source,
    } = req.body || {};

    const execConfig = strategicPayload?.execution_config as Record<string, unknown> | undefined;
    const campaignDuration = execConfig?.campaign_duration;
    const durationWeeks =
      (typeof bodyDurationWeeks === 'number' && bodyDurationWeeks >= 4 && bodyDurationWeeks <= 12)
        ? bodyDurationWeeks
        : (execConfig != null &&
            typeof execConfig === 'object' &&
            typeof campaignDuration === 'number' &&
            campaignDuration >= 4 &&
            campaignDuration <= 12)
          ? campaignDuration
          : 12;
    if (typeof bodyDurationWeeks === 'number' && (bodyDurationWeeks < 4 || bodyDurationWeeks > 12)) {
      return res.status(400).json({
        error: 'Campaign duration must be between 4 and 12 weeks.',
      });
    }
    const execDuration = (strategicPayload?.execution_config as Record<string, unknown> | undefined)?.campaign_duration;
    if (typeof execDuration === 'number' && (execDuration < 4 || execDuration > 12)) {
      return res.status(400).json({
        error: 'Campaign duration must be between 4 and 12 weeks.',
      });
    }
    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }
    const regions = Array.isArray(regionsBody)
      ? regionsBody.map((r: unknown) => String(r).trim()).filter(Boolean)
      : typeof regionsBody === 'string'
      ? String(regionsBody)
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean)
      : [];
    const resolvedCampaignId =
      typeof campaignId === 'string' && campaignId.trim().length > 0 ? campaignId : null;
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId: resolvedCampaignId ?? undefined,
      requireCampaignId: false,
    });
    if (!access) return;
    console.log('RECOMMENDATION_REQUEST', { companyId, campaignId: resolvedCampaignId });

    if (resolvedCampaignId) {
      const { data: mappingRows, error: mappingError } = await supabase
        .from('campaign_versions')
        .select('id')
        .eq('company_id', companyId)
        .eq('campaign_id', resolvedCampaignId);
      if (mappingError) {
        return res.status(500).json({ error: 'Failed to verify campaign link' });
      }
      if (!mappingRows || mappingRows.length === 0) {
        return res.status(403).json({ error: 'CAMPAIGN_NOT_IN_COMPANY' });
      }
    }

    const chatMode = Boolean(chat);
    let recommendationContext: Record<string, any> | null = null;
    const defaultApiIds = await getCompanyDefaultApiIds(companyId);
    const resolvedSelection = Array.isArray(selected_api_ids) ? selected_api_ids : defaultApiIds;
    const manualContext =
      manual_context && typeof manual_context === 'object' ? manual_context : null;
    let strategyMemory: Awaited<ReturnType<typeof getStrategyHistoryForCompany>> | null = null;
    try {
      strategyMemory = await getStrategyHistoryForCompany(companyId);
      if (strategyMemory.campaigns_count === 0) strategyMemory = null;
    } catch {
      strategyMemory = null;
    }
    const resolvedInsightSource =
      insight_source === 'api' || insight_source === 'llm' || insight_source === 'hybrid'
        ? insight_source
        : 'hybrid';
    const result = await generateRecommendations(
      {
        companyId,
        campaignId: resolvedCampaignId ?? undefined,
        objective,
        durationWeeks,
        simulate: Boolean(simulate),
        userId: access.userId,
        selectedApiIds: resolvedSelection,
        regions: regions.length > 0 ? regions : undefined,
        enrichmentEnabled: enrichmentEnabled !== false,
        strategicPayload:
          strategicPayload && typeof strategicPayload === 'object' ? strategicPayload : undefined,
        strategyMemory: strategyMemory ?? undefined,
        insightSource: resolvedInsightSource,
      },
      {
        onContext: chatMode
          ? (context) => {
              recommendationContext = context;
            }
          : undefined,
      }
    );

    // Direct AI fallback: if the pipeline returned nothing, bypass all complexity and
    // call theme generation directly. This handles fresh companies with sparse profiles
    // and environments where external trend APIs are not configured.
    if (!result.trends_used || result.trends_used.length === 0) {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({
          error: 'AI theme generation is not configured',
          detail: 'OPENAI_API_KEY environment variable is missing. Add it to .env.local and restart the server.',
        });
      }
      try {
        const { generateAdditionalStrategicThemes } = await import('../../../backend/services/strategicThemeEngine');
        const rankingCtx = { historicalThemeCache: new Map<string, Set<string>>() };
        const aiThemes = await generateAdditionalStrategicThemes({
          companyId,
          strategicPayload: strategicPayload && typeof strategicPayload === 'object' ? strategicPayload : undefined,
          limit: 8,
          existingThemeKeys: [],
          rankingContext: rankingCtx,
        });
        if (aiThemes.length > 0) {
          result.trends_used = aiThemes.map((t) => ({
            topic: t.topic,
            source: 'ai_direct',
            sources: ['ai_direct'],
            frequency: 1,
            volume: 60,
            signal_confidence: 0.7,
            signal_type: null as any,
            source_topic: t.topic,
            signal_id: null,
            platform_tag: undefined,
          }));
          result.signals_source = 'PROFILE_ONLY';
          console.info('[generate] Direct AI fallback produced', aiThemes.length, 'themes for company', companyId);
        } else {
          console.warn('[generate] Direct AI fallback returned 0 themes for company', companyId, '— check OPENAI_API_KEY and company profile');
        }
      } catch (directAiErr: any) {
        console.error('[generate] Direct AI fallback failed:', directAiErr?.message ?? directAiErr);
        return res.status(500).json({
          error: 'AI theme generation failed',
          detail: directAiErr?.message ?? 'OpenAI call failed. Check OPENAI_API_KEY and model configuration.',
        });
      }
    }

    const sourceSignalsCount = result.trends_used?.length ?? 0;
    const signalsSource = result.signals_source ?? 'EXTERNAL';

    if (regions.length > 1) {
      try {
        await supabase.from('audit_logs').insert({
          action: 'REGION_REQUEST_SPLIT',
          actor_user_id: access.userId ?? null,
          company_id: companyId,
          metadata: { regions, company_id: companyId },
          created_at: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('REGION_REQUEST_SPLIT audit failed', e);
      }
    }
    try {
      await supabase.from('audit_logs').insert({
        action: 'TREND_SIGNAL_MERGE_COMPLETE',
        actor_user_id: access.userId ?? null,
        company_id: companyId,
        metadata: {
          topic_count: sourceSignalsCount,
          regions: regions.length > 0 ? regions : null,
          signals_source: signalsSource,
        },
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('TREND_SIGNAL_MERGE_COMPLETE audit failed', e);
    }

    let opportunityAnalysis: any | null = null;
    if (manualContext?.type === 'opportunity' || manualContext?.type === 'detected_opportunity') {
      try {
        if (!process.env.OPENAI_API_KEY) {
          console.warn('OPENAI_API_KEY_MISSING_FOR_OPPORTUNITY_ANALYSIS');
        } else {
          const profile = await getProfile(companyId, { autoRefine: false, languageRefine: true });
          const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
          const message =
            'Evaluate this opportunity against the company profile.\n' +
            'Return JSON only with fields:\n' +
            '- relevance_score (0 to 1)\n' +
            '- narrative_angle (string)\n' +
            '- content_mix (array of content types)\n' +
            '- risk_level (Low | Medium | High)\n' +
            '- confidence (0 to 1)\n' +
            `Company Profile:\n${JSON.stringify(profile || {}, null, 2)}\n` +
            `Opportunity:\n${JSON.stringify(manualContext || {}, null, 2)}`;
          const completion = await generateRecommendation({
            companyId,
            model,
            temperature: 0.3,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: 'You are a campaign strategist.' },
              { role: 'user', content: message },
            ],
          });
          opportunityAnalysis = completion.output;
        }
      } catch (error) {
        console.warn('OPPORTUNITY_ANALYSIS_FAILED', error);
        opportunityAnalysis = null;
      }
    }

    if ((manualContext?.type === 'opportunity' || manualContext?.type === 'detected_opportunity') && manualContext?.topic) {
      const manualTopic = String(manualContext.topic).trim();
      if (manualTopic) {
        const exists = (result.trends_used || []).some(
          (trend: any) => String(trend.topic || '').toLowerCase() === manualTopic.toLowerCase()
        );
        if (!exists) {
          result.trends_used = [
            {
              topic: manualTopic,
              source: manualContext?.type === 'detected_opportunity' ? 'detected_opportunity' : 'opportunity',
              sources: ['manual'],
              frequency: 1,
              platform_tag: Array.isArray(manualContext.platform_preferences)
                ? manualContext.platform_preferences[0]
                : undefined,
              signal_type: 'MANUAL' as const,
              source_topic: manualTopic,
              signal_id: manualContext?.signal_id ?? manualContext?.source_signal_id ?? null,
            },
            ...(result.trends_used || []),
          ];
        }
      }
    }

    let snapshotHashByTopic: Record<string, string> = {};
    let snapshotRowsByTopic: Record<string, { id: string; snapshot_hash?: string | null }> = {};
    if (!simulate) {
      const createdAt = new Date().toISOString();
      const fallbackTopic =
        result.daily_plan?.[0]?.topic ||
        result.weekly_plan?.[0]?.theme ||
        result.explanation ||
        'Recommendation snapshot';
      const trendsForRecords =
        result.trends_used.length > 0
          ? result.trends_used
          : [{ topic: fallbackTopic, sources: [], frequency: 1 } as { topic: string; signal_id?: string | null; signal_type?: string | null; source_topic?: string | null }];
      const topics = trendsForRecords.map((t) => t.topic);
      const records = trendsForRecords.map((trend) => ({
        company_id: companyId,
        campaign_id: resolvedCampaignId,
        trend_topic: trend.topic,
        source_topic: trend.source_topic || trend.topic,
        source_signal_id: trend.signal_id || null,
        source_signal_type: trend.signal_type || 'MANUAL',
        confidence: result.confidence_score,
        explanation: result.explanation,
        refresh_source: 'manual',
        refreshed_at: createdAt,
        created_at: createdAt,
        status: 'DRAFT',
        regions: regions.length > 0 ? regions : [],
        source_signals_count: sourceSignalsCount,
        signals_source: signalsSource,
      }));
      let { error: snapshotError } = await supabase
        .from('recommendation_snapshots')
        .insert(records);
      // Backward compatibility: retry inserts for older schemas.
      if (snapshotError) {
        const baseRecords = records.map((row) => ({
          company_id: row.company_id,
          campaign_id: row.campaign_id,
          trend_topic: row.trend_topic,
          confidence: row.confidence,
          explanation: row.explanation,
          refresh_source: row.refresh_source,
          refreshed_at: row.refreshed_at,
          created_at: row.created_at,
        }));
        const retry = await supabase.from('recommendation_snapshots').insert(baseRecords);
        snapshotError = retry.error;
      }
      // Oldest schema fallback: no campaign_id column.
      if (snapshotError) {
        const minimalRecords = records.map((row) => ({
          company_id: row.company_id,
          trend_topic: row.trend_topic,
          confidence: row.confidence,
          explanation: row.explanation,
          refresh_source: row.refresh_source,
          refreshed_at: row.refreshed_at,
          created_at: row.created_at,
        }));
        const retryWithoutCampaignId = await supabase
          .from('recommendation_snapshots')
          .insert(minimalRecords);
        snapshotError = retryWithoutCampaignId.error;
      }
      // Ultra-legacy schema fallback: keep only essential fields.
      if (snapshotError) {
        const essentialRecords = records.map((row) => ({
          company_id: row.company_id,
          trend_topic: row.trend_topic,
          created_at: row.created_at,
        }));
        const retryEssential = await supabase
          .from('recommendation_snapshots')
          .insert(essentialRecords);
        snapshotError = retryEssential.error;
      }
      if (snapshotError) {
        return res.status(500).json({
          error: 'Failed to persist recommendation snapshot',
          detail: snapshotError.message,
        });
      }
      try {
        const windowStart = new Date(new Date(createdAt).getTime() - 2 * 60 * 1000).toISOString();
        const windowEnd = new Date(new Date(createdAt).getTime() + 2 * 60 * 1000).toISOString();
        const { data: snapshotRows, error: snapshotLookupError } = await supabase
          .from('recommendation_snapshots')
          .select('id,trend_topic,snapshot_hash')
          .eq('company_id', companyId)
          .gte('refreshed_at', windowStart)
          .lte('refreshed_at', windowEnd)
          .in('trend_topic', topics);
        try {
        await supabase.from('audit_logs').insert({
          action: 'RECOMMENDATION_GENERATED',
          actor_user_id: access.userId ?? null,
          company_id: companyId,
          metadata: {
            campaign_id: resolvedCampaignId,
            regions: regions.length > 0 ? regions : null,
            source_signals_count: sourceSignalsCount,
            signals_source: signalsSource,
            status: 'DRAFT',
          },
          created_at: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('RECOMMENDATION_GENERATED audit failed', e);
      }

      if (!snapshotLookupError && snapshotRows) {
          snapshotHashByTopic = snapshotRows.reduce<Record<string, string>>((acc, row: any) => {
            if (row?.trend_topic && row?.snapshot_hash) {
              acc[String(row.trend_topic)] = String(row.snapshot_hash);
            }
            return acc;
          }, {});
          snapshotRowsByTopic = snapshotRows.reduce<Record<string, { id: string; snapshot_hash?: string | null }>>(
            (acc, row: any) => {
              if (row?.trend_topic && row?.id) {
                acc[String(row.trend_topic)] = {
                  id: String(row.id),
                  snapshot_hash: row.snapshot_hash ?? null,
                };
              }
              return acc;
            },
            {}
          );
        }
      } catch {
        snapshotHashByTopic = {};
        snapshotRowsByTopic = {};
      }
    }

    const hasSnapshotData =
      (snapshotHashByTopic && Object.keys(snapshotHashByTopic).length > 0) ||
      (snapshotRowsByTopic && Object.keys(snapshotRowsByTopic).length > 0);
    const resultWithSnapshots = hasSnapshotData
      ? {
          ...result,
          trends_used: result.trends_used.map((trend: any) => ({
            ...trend,
            snapshot_hash: snapshotHashByTopic[trend.topic] || undefined,
            id: snapshotRowsByTopic[trend.topic]?.id ?? undefined,
            source_signal_id: trend.signal_id ?? undefined,
            source_topic: trend.source_topic ?? trend.topic ?? undefined,
          })),
        }
      : result;

    if (!simulate && opportunityAnalysis && (manualContext?.type === 'opportunity' || manualContext?.type === 'detected_opportunity')) {
      try {
        const topicKey = manualContext?.topic ? String(manualContext.topic) : null;
        const targetRow = topicKey ? snapshotRowsByTopic[topicKey] : null;
        if (targetRow?.id) {
          await supabase.from('audit_logs').insert({
            action: 'RECOMMENDATION_OPPORTUNITY_ANALYSIS',
            actor_user_id: access.userId ?? null,
            company_id: companyId,
            metadata: {
              recommendation_id: targetRow.id,
              snapshot_hash: targetRow.snapshot_hash ?? null,
              opportunity_analysis: opportunityAnalysis,
            },
            created_at: new Date().toISOString(),
          });
        }
      } catch (error) {
        console.warn('OPPORTUNITY_ANALYSIS_AUDIT_FAILED', error);
      }
    }

    if (chatMode && recommendationContext?.trend_reasoning) {
      const reasoning = recommendationContext.trend_reasoning as Array<{
        topic: string;
        signals: string[];
      }>;
      const signalCopy: Record<string, string> = {
        topic_overlap_detected: 'This overlaps with topics used in a recent campaign.',
        related_to_recent_campaign: 'This is related to a recent campaign you ran.',
        possible_campaign_continuation:
          'This could work as a continuation of a previous campaign.',
        novel_theme: 'This appears to be a new theme for your brand.',
      };

      const explanations = reasoning.map((item) => ({
        topic: item.topic,
        explanations: item.signals.map((signal) => signalCopy[signal]).filter(Boolean),
      }));

      const response = {
        ...resultWithSnapshots,
        opportunity_analysis: opportunityAnalysis ?? undefined,
        chat_meta: {
          trend_explanations: explanations,
        },
      };
      const refined = await formatForUserOutput(response);
      return res.status(200).json(refined);
    }

    const refined = await formatForUserOutput({
      ...resultWithSnapshots,
      opportunity_analysis: opportunityAnalysis ?? undefined,
    });
    return res.status(200).json(refined);
  } catch (error: any) {
    if (error?.code === 'CAMPAIGN_NOT_IN_COMPANY') {
      return res.status(403).json({ error: 'CAMPAIGN_NOT_IN_COMPANY' });
    }
    console.error('Error generating recommendations:', error);
    const message = error?.message ?? (typeof error === 'string' ? error : 'Unknown error');
    return res.status(500).json({
      error: 'Failed to generate recommendations',
      detail: message,
    });
  }
}

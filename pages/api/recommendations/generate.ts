import { NextApiRequest, NextApiResponse } from 'next';
import { generateRecommendations } from '../../../backend/services/recommendationEngineService';
import { getCompanyDefaultApiIds } from '../../../backend/services/externalApiService';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { getProfile } from '../../../backend/services/companyProfileService';
import { generateRecommendation } from '../../../backend/services/aiGateway';

async function handler(req: NextApiRequest, res: NextApiResponse) {
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
      durationWeeks,
      simulate,
      chat,
      selected_api_ids,
      manual_context,
    } = req.body || {};
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
      },
      {
        onContext: chatMode
          ? (context) => {
              recommendationContext = context;
            }
          : undefined,
      }
    );

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
          const profile = await getProfile(companyId, { autoRefine: false });
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
      const topics =
        result.trends_used.length > 0
          ? result.trends_used.map((trend) => trend.topic)
          : [fallbackTopic];
      const records = topics.map((topic) => ({
        company_id: companyId,
        campaign_id: resolvedCampaignId,
        trend_topic: topic,
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
      const { error: snapshotError } = await supabase
        .from('recommendation_snapshots')
        .insert(records);
      if (snapshotError) {
        return res.status(500).json({ error: 'Failed to persist recommendation snapshot' });
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

    const resultWithSnapshots = snapshotHashByTopic && Object.keys(snapshotHashByTopic).length > 0
      ? {
          ...result,
          trends_used: result.trends_used.map((trend: any) => ({
            ...trend,
            snapshot_hash: snapshotHashByTopic[trend.topic] || undefined,
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

      return res.status(200).json({
        ...resultWithSnapshots,
        opportunity_analysis: opportunityAnalysis ?? undefined,
        chat_meta: {
          trend_explanations: explanations,
        },
      });
    }

    return res.status(200).json({
      ...resultWithSnapshots,
      opportunity_analysis: opportunityAnalysis ?? undefined,
    });
  } catch (error: any) {
    if (error?.code === 'CAMPAIGN_NOT_IN_COMPANY') {
      return res.status(403).json({ error: 'CAMPAIGN_NOT_IN_COMPANY' });
    }
    console.error('Error generating recommendations:', error);
    return res.status(500).json({ error: 'Failed to generate recommendations' });
  }
}

export default withRBAC(handler, [Role.COMPANY_ADMIN, Role.CONTENT_CREATOR]);

import { NextApiRequest, NextApiResponse } from 'next';
import { getProfile } from '../../../backend/services/companyProfileService';
import { fetchTrendsFromApis } from '../../../backend/services/externalApiService';
import { assessVirality } from '../../../backend/services/viralityAdvisorService';
import { buildCampaignSnapshotWithHash } from '../../../backend/services/viralitySnapshotBuilder';
import { buildDecideRequest, requestDecision } from '../../../backend/services/omnivyreClient';
import { generateRecommendations } from '../../../backend/services/recommendationEngine';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, campaignId, geo, category } = req.body || {};

    const profile = await getProfile(companyId, { autoRefine: true });
    const resolvedCompanyId = companyId || profile?.company_id || 'default';
    const trendSignals = await fetchTrendsFromApis(geo, category);

    let viralityDiagnostics = undefined;
    let omnivyreDecision = undefined;
    let snapshotHash = '';

    if (campaignId) {
      const { snapshot } = await buildCampaignSnapshotWithHash(campaignId);
      const assessment = await assessVirality(campaignId);
      viralityDiagnostics = assessment.diagnostics;
      snapshotHash = assessment.snapshot_hash;

      const decidePayload = buildDecideRequest({
        campaign_id: campaignId,
        snapshot_hash: assessment.snapshot_hash,
        model_version: assessment.model_version,
        snapshot,
        diagnostics: assessment.diagnostics,
        comparisons: assessment.comparisons,
        overall_summary: assessment.overall_summary,
      });
      omnivyreDecision = await requestDecision(decidePayload);
    }

    const recommendations = await generateRecommendations({
      companyProfile: profile,
      trendSignals,
      viralityDiagnostics,
      omnivyreDecision,
    });

    const records = recommendations.map((rec) => ({
      company_id: resolvedCompanyId,
      campaign_id: campaignId || null,
      snapshot_hash: snapshotHash,
      trend_topic: rec.trend,
      category: rec.category || null,
      audience: rec.audience,
      geo: rec.geo,
      platforms: rec.platforms,
      promotion_mode: rec.promotion_mode,
      effort_score: rec.effort_score,
      success_projection: {
        expected_reach: rec.expected_reach,
        expected_growth: rec.expected_growth,
      },
      final_score: rec.final_score,
      scores: rec.scores,
      confidence: rec.confidence,
      explanation: rec.explanation,
      created_at: new Date().toISOString(),
    }));

    let stored: Array<{ id: string }> = [];
    if (records.length > 0) {
      const { data, error } = await supabase
        .from('recommendation_snapshots')
        .insert(records)
        .select('id');
      if (error) {
        console.warn('Failed to persist recommendation snapshots', error.message);
      } else {
        stored = data || [];
      }
    }

    const recommendationIds = recommendations.map((_, index) => stored[index]?.id).filter(Boolean);

    return res.status(200).json({
      recommendations: recommendations.map((rec, index) => ({
        ...rec,
        recommendation_id: stored[index]?.id,
      })),
      recommendation_ids: recommendationIds,
    });
  } catch (error: any) {
    console.error('Error generating recommendations:', error);
    return res.status(500).json({ error: 'Failed to generate recommendations' });
  }
}

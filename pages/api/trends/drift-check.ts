import type { NextApiRequest, NextApiResponse } from 'next';
import { getProfile } from '../../../backend/services/companyProfileService';
import { detectTrendDrift } from '../../../backend/services/trendDriftService';
import { fetchTrendsFromApis } from '../../../backend/services/externalApiService';
import { getTrendSnapshots } from '../../../backend/db/campaignVersionStore';
import { getLatestAnalyticsReport } from '../../../backend/db/performanceStore';
import { sendLearningSnapshot } from '../../../backend/services/omnivyraFeedbackService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId } = req.body || {};
    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    const profile = await getProfile(companyId, { autoRefine: false });
    if (!profile) {
      return res.status(404).json({ error: 'Company profile not found' });
    }

    const previousSnapshots = await getTrendSnapshots(companyId);
    const previousTrends = previousSnapshots
      .flatMap((snap) => snap.snapshot?.emerging_trends ?? [])
      .map((trend: any) => trend?.topic)
      .filter(Boolean);

    const geoHint = profile.geography_list?.[0] ?? profile.geography ?? undefined;
    const trendSignals = await fetchTrendsFromApis(companyId, geoHint, undefined, {
      recordHealth: false,
    });
    const newTrends = trendSignals.map((signal) => signal.topic).filter(Boolean);

    const analyticsReport = await getLatestAnalyticsReport(companyId);
    const drift = detectTrendDrift({
      companyProfile: profile,
      previousTrends,
      newTrends,
      analytics: analyticsReport?.report_json,
    });

    console.log('DRIFT DETECTED', drift);
    await sendLearningSnapshot({
      companyId,
      trends_used: newTrends.map((topic) => ({ topic })),
      trends_ignored: [],
      signal_confidence_summary: undefined,
      novelty_score: undefined,
      confidence_score: undefined,
      placeholders: [],
      explanation: 'Trend drift check executed',
      external_api_health_snapshot: [],
      performance_metrics: analyticsReport?.report_json ?? null,
      drift_flags: drift,
      timestamp: new Date().toISOString(),
    });
    return res.status(200).json(drift);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to detect trend drift' });
  }
}

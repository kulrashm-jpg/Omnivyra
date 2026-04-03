import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handleGetMetrics(req, res);
  } else if (req.method === 'POST') {
    return handleSaveMetrics(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function handleGetMetrics(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { campaignId, weekNumber, platform, date } = req.query;

    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }

    let query = supabase
      .from('campaign_performance_metrics')
      .select('*')
      .eq('campaign_id', campaignId);

    // Apply filters
    if (weekNumber) {
      query = query.eq('week_number', weekNumber);
    }
    if (platform) {
      query = query.eq('platform', platform);
    }
    if (date) {
      query = query.eq('date', date);
    }

    const { data: metrics, error } = await query.order('date', { ascending: false });

    if (error) {
      console.error('Error fetching metrics:', error);
      return res.status(500).json({ error: 'Failed to fetch metrics' });
    }

    // Calculate aggregated metrics
    const aggregatedMetrics = calculateAggregatedMetrics(metrics || []);

    res.status(200).json({
      success: true,
      data: {
        metrics: metrics || [],
        aggregated: aggregatedMetrics,
        summary: {
          totalRecords: metrics?.length || 0,
          dateRange: metrics?.length ? {
            start: metrics[metrics.length - 1]?.date,
            end: metrics[0]?.date
          } : null
        }
      }
    });

  } catch (error) {
    console.error('Error in get-metrics API:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

async function handleSaveMetrics(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { campaignId, metricsData } = req.body;

    if (!campaignId || !metricsData) {
      return res.status(400).json({ error: 'Campaign ID and metrics data are required' });
    }

    // Validate metrics data structure
    const validatedMetrics = validateMetricsData(metricsData);

    // Save metrics to database
    const { data: savedMetrics, error } = await supabase
      .from('campaign_performance_metrics')
      .upsert(validatedMetrics.map(metric => ({
        campaign_id: campaignId,
        week_number: metric.weekNumber,
        platform: metric.platform,
        date: metric.date,
        impressions: metric.impressions || 0,
        reach: metric.reach || 0,
        followers_gained: metric.followersGained || 0,
        likes: metric.likes || 0,
        comments: metric.comments || 0,
        shares: metric.shares || 0,
        saves: metric.saves || 0,
        clicks: metric.clicks || 0,
        conversions: metric.conversions || 0,
        newsletter_signups: metric.newsletterSignups || 0,
        website_traffic: metric.websiteTraffic || 0,
        engagement_rate: metric.engagementRate || 0,
        click_through_rate: metric.clickThroughRate || 0,
        conversion_rate: metric.conversionRate || 0,
        ugc_submissions: metric.ugcSubmissions || 0,
        playlist_adds: metric.playlistAdds || 0,
        updated_at: new Date().toISOString()
      })))
      .select();

    if (error) {
      console.error('Error saving metrics:', error);
      return res.status(500).json({ error: 'Failed to save metrics' });
    }

    // Update campaign completion percentage based on metrics
    await updateCampaignCompletion(campaignId);

    res.status(200).json({
      success: true,
      message: 'Metrics saved successfully',
      data: savedMetrics
    });

  } catch (error) {
    console.error('Error in save-metrics API:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

function calculateAggregatedMetrics(metrics: any[]) {
  const aggregated = {
    totalImpressions: 0,
    totalReach: 0,
    totalFollowersGained: 0,
    totalLikes: 0,
    totalComments: 0,
    totalShares: 0,
    totalSaves: 0,
    totalClicks: 0,
    totalConversions: 0,
    totalNewsletterSignups: 0,
    totalWebsiteTraffic: 0,
    totalUgcSubmissions: 0,
    totalPlaylistAdds: 0,
    averageEngagementRate: 0,
    averageClickThroughRate: 0,
    averageConversionRate: 0,
    platformBreakdown: {} as any,
    weeklyBreakdown: {} as any
  };

  metrics.forEach(metric => {
    // Aggregate totals
    aggregated.totalImpressions += metric.impressions || 0;
    aggregated.totalReach += metric.reach || 0;
    aggregated.totalFollowersGained += metric.followers_gained || 0;
    aggregated.totalLikes += metric.likes || 0;
    aggregated.totalComments += metric.comments || 0;
    aggregated.totalShares += metric.shares || 0;
    aggregated.totalSaves += metric.saves || 0;
    aggregated.totalClicks += metric.clicks || 0;
    aggregated.totalConversions += metric.conversions || 0;
    aggregated.totalNewsletterSignups += metric.newsletter_signups || 0;
    aggregated.totalWebsiteTraffic += metric.website_traffic || 0;
    aggregated.totalUgcSubmissions += metric.ugc_submissions || 0;
    aggregated.totalPlaylistAdds += metric.playlist_adds || 0;

    // Platform breakdown
    if (metric.platform) {
      if (!aggregated.platformBreakdown[metric.platform]) {
        aggregated.platformBreakdown[metric.platform] = {
          impressions: 0,
          engagements: 0,
          followers: 0,
          clicks: 0,
          conversions: 0
        };
      }
      aggregated.platformBreakdown[metric.platform].impressions += metric.impressions || 0;
      aggregated.platformBreakdown[metric.platform].engagements += (metric.likes || 0) + (metric.comments || 0) + (metric.shares || 0);
      aggregated.platformBreakdown[metric.platform].followers += metric.followers_gained || 0;
      aggregated.platformBreakdown[metric.platform].clicks += metric.clicks || 0;
      aggregated.platformBreakdown[metric.platform].conversions += metric.conversions || 0;
    }

    // Weekly breakdown
    if (metric.week_number) {
      if (!aggregated.weeklyBreakdown[metric.week_number]) {
        aggregated.weeklyBreakdown[metric.week_number] = {
          impressions: 0,
          engagements: 0,
          followers: 0,
          clicks: 0,
          conversions: 0
        };
      }
      aggregated.weeklyBreakdown[metric.week_number].impressions += metric.impressions || 0;
      aggregated.weeklyBreakdown[metric.week_number].engagements += (metric.likes || 0) + (metric.comments || 0) + (metric.shares || 0);
      aggregated.weeklyBreakdown[metric.week_number].followers += metric.followers_gained || 0;
      aggregated.weeklyBreakdown[metric.week_number].clicks += metric.clicks || 0;
      aggregated.weeklyBreakdown[metric.week_number].conversions += metric.conversions || 0;
    }
  });

  // Calculate averages
  if (metrics.length > 0) {
    aggregated.averageEngagementRate = metrics.reduce((sum, m) => sum + (m.engagement_rate || 0), 0) / metrics.length;
    aggregated.averageClickThroughRate = metrics.reduce((sum, m) => sum + (m.click_through_rate || 0), 0) / metrics.length;
    aggregated.averageConversionRate = metrics.reduce((sum, m) => sum + (m.conversion_rate || 0), 0) / metrics.length;
  }

  return aggregated;
}

function validateMetricsData(metricsData: any[]) {
  return metricsData.map(metric => ({
    weekNumber: metric.weekNumber || null,
    platform: metric.platform || null,
    date: metric.date || new Date().toISOString().split('T')[0],
    impressions: parseInt(metric.impressions) || 0,
    reach: parseInt(metric.reach) || 0,
    followersGained: parseInt(metric.followersGained) || 0,
    likes: parseInt(metric.likes) || 0,
    comments: parseInt(metric.comments) || 0,
    shares: parseInt(metric.shares) || 0,
    saves: parseInt(metric.saves) || 0,
    clicks: parseInt(metric.clicks) || 0,
    conversions: parseInt(metric.conversions) || 0,
    newsletterSignups: parseInt(metric.newsletterSignups) || 0,
    websiteTraffic: parseInt(metric.websiteTraffic) || 0,
    engagementRate: parseFloat(metric.engagementRate) || 0,
    clickThroughRate: parseFloat(metric.clickThroughRate) || 0,
    conversionRate: parseFloat(metric.conversionRate) || 0,
    ugcSubmissions: parseInt(metric.ugcSubmissions) || 0,
    playlistAdds: parseInt(metric.playlistAdds) || 0
  }));
}

async function updateCampaignCompletion(campaignId: string) {
  try {
    // Get all weekly plans for the campaign
    const { data: weeklyPlans, error: weeklyError } = await supabase
      .from('weekly_content_plans')
      .select('week_number, completion_percentage')
      .eq('campaign_id', campaignId);

    if (weeklyError) {
      console.error('Error fetching weekly plans for completion update:', weeklyError);
      return;
    }

    // Calculate overall completion percentage
    const totalWeeks = weeklyPlans?.length || 0;
    const totalCompletion = weeklyPlans?.reduce((sum, plan) => sum + (plan.completion_percentage || 0), 0) || 0;
    const overallCompletion = totalWeeks > 0 ? Math.round(totalCompletion / totalWeeks) : 0;

    // Update campaign status based on completion
    let status = 'planning';
    if (overallCompletion >= 100) {
      status = 'completed';
    } else if (overallCompletion >= 50) {
      status = 'active';
    }

    // Update campaign
    await supabase
      .from('campaigns')
      .update({
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', campaignId);

  } catch (error) {
    console.error('Error updating campaign completion:', error);
  }
}

/**
 * Risk Assessment Service
 * 
 * Calculates risk scores for campaign readiness.
 * 
 * Features:
 * - Risk scoring (0-100)
 * - Mitigation suggestions
 * - Real-time risk updates
 */

import { supabase } from '../db/supabaseClient';

export interface RiskFactor {
  name: string;
  severity: 'high' | 'medium' | 'low';
  score: number;
  description: string;
  mitigation: string[];
}

export interface RiskAssessment {
  total_score: number;
  risk_level: 'low' | 'medium' | 'high';
  factors: RiskFactor[];
  mitigation_priority: string[];
}

/**
 * Assess campaign risk
 */
export async function assessCampaignRisk(campaignId: string): Promise<RiskAssessment> {
  const factors: RiskFactor[] = [];

  // Get campaign
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();

  if (!campaign) {
    throw new Error('Campaign not found');
  }

  // Check missing social accounts (HIGH RISK)
  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('platform')
    .eq('user_id', campaign.user_id)
    .eq('is_active', true);

  const platforms = accounts?.map(a => a.platform) || [];
  
  // Assume required platforms (can be configurable)
  const requiredPlatforms = ['linkedin', 'twitter', 'instagram'];
  const missingPlatforms = requiredPlatforms.filter(p => !platforms.includes(p));

  if (missingPlatforms.length > 0) {
    factors.push({
      name: 'missing_social_accounts',
      severity: 'high',
      score: missingPlatforms.length * 25, // 25 points per missing platform
      description: `Missing connected accounts: ${missingPlatforms.join(', ')}`,
      mitigation: [
        `Connect ${missingPlatforms.join(' and ')} account(s)`,
        'Go to Settings > Connected Accounts',
        'Authorize each platform',
      ],
    });
  }

  // Check missing content (MEDIUM RISK)
  const { data: weekly } = await supabase
    .from('weekly_content_refinements')
    .select('id, theme, focus_areas')
    .eq('campaign_id', campaignId);

  const incompleteWeeks = weekly?.filter(w => !w.theme || !w.focus_areas || (w.focus_areas as any[]).length === 0) || [];
  
  if (incompleteWeeks.length > 0) {
    factors.push({
      name: 'incomplete_content_plans',
      severity: 'medium',
      score: incompleteWeeks.length * 5,
      description: `${incompleteWeeks.length} week(s) missing themes or focus areas`,
      mitigation: [
        'Complete weekly content refinements',
        'Define themes for each week',
        'Add focus areas for content planning',
      ],
    });
  }

  // Check missing media (LOW RISK)
  const { data: scheduled } = await supabase
    .from('scheduled_posts')
    .select('id, media_urls')
    .eq('campaign_id', campaignId);

  const postsWithoutMedia = scheduled?.filter(p => !p.media_urls || (p.media_urls as string[]).length === 0) || [];
  const totalPosts = scheduled?.length || 0;
  
  if (totalPosts > 0 && postsWithoutMedia.length > totalPosts * 0.5) {
    factors.push({
      name: 'missing_media',
      severity: 'low',
      score: 10,
      description: `${postsWithoutMedia.length} of ${totalPosts} posts missing media`,
      mitigation: [
        'Upload media files for posts',
        'Add images or videos to increase engagement',
        'Use media library to attach files',
      ],
    });
  }

  // Check date conflicts (HIGH RISK)
  if (campaign.start_date && campaign.end_date) {
    const { data: conflicts } = await supabase
      .from('campaigns')
      .select('id, name, start_date, end_date')
      .eq('user_id', campaign.user_id)
      .neq('id', campaignId)
      .not('status', 'eq', 'completed');

    let hasConflict = false;
    const conflictNames: string[] = [];

    conflicts?.forEach((other: any) => {
      if (!other.start_date || !other.end_date) return;
      
      const start = new Date(campaign.start_date);
      const end = new Date(campaign.end_date);
      const otherStart = new Date(other.start_date);
      const otherEnd = new Date(other.end_date);

      if (start < otherEnd && end > otherStart) {
        hasConflict = true;
        conflictNames.push(other.name);
      }
    });

    if (hasConflict) {
      factors.push({
        name: 'date_conflicts',
        severity: 'high',
        score: 20,
        description: `Overlaps with campaigns: ${conflictNames.join(', ')}`,
        mitigation: [
          'Adjust campaign dates to avoid conflicts',
          'Check campaign calendar for available dates',
          'Consider resource constraints',
        ],
      });
    }
  }

  // Check campaign dates (MEDIUM RISK)
  if (!campaign.start_date || !campaign.end_date) {
    factors.push({
      name: 'missing_dates',
      severity: 'medium',
      score: 15,
      description: 'Campaign missing start or end date',
      mitigation: [
        'Set campaign start date',
        'Set campaign end date',
        'Ensure dates are in the future',
      ],
    });
  }

  // Calculate total score
  const totalScore = factors.reduce((sum, factor) => sum + factor.score, 0);
  const cappedScore = Math.min(totalScore, 100);

  // Determine risk level
  let riskLevel: 'low' | 'medium' | 'high';
  if (cappedScore <= 30) {
    riskLevel = 'low';
  } else if (cappedScore <= 70) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'high';
  }

  // Prioritize mitigation actions
  const mitigationPriority = factors
    .sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    })
    .flatMap(f => f.mitigation);

  return {
    total_score: cappedScore,
    risk_level: riskLevel,
    factors,
    mitigation_priority: mitigationPriority,
  };
}


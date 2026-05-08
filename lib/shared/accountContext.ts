// Account Context Engine Types
// Provides account maturity, performance metrics, and planning recommendations

export type MaturityStage = 'NEW' | 'GROWING' | 'ESTABLISHED';

export interface PlatformMetrics {
  platform: string;
  followers: number;
  avgReach: number;
  engagementRate: number;
  postingFrequency: number;
  last30DaysPosts: number;
}

export interface AccountContext {
  companyId: string;
  platforms: PlatformMetrics[];
  maturityStage: MaturityStage;
  overallScore: number; // 0-100
  recommendations: string[];
  lastUpdated: Date;
}

// Maturity scoring logic (simple rule-based)
export function calculateMaturityStage(platforms: PlatformMetrics[]): MaturityStage {
  if (platforms.length === 0) return 'NEW';

  const totalFollowers = platforms.reduce((sum, p) => sum + p.followers, 0);
  const avgEngagement = platforms.reduce((sum, p) => sum + p.engagementRate, 0) / platforms.length;
  const avgPostingFreq = platforms.reduce((sum, p) => sum + p.postingFrequency, 0) / platforms.length;

  // NEW: Low followers, low engagement, infrequent posting
  if (totalFollowers < 1000 || avgEngagement < 1.0 || avgPostingFreq < 2) {
    return 'NEW';
  }

  // GROWING: Moderate engagement and activity
  if (avgEngagement < 3.0 || avgPostingFreq < 4) {
    return 'GROWING';
  }

  // ESTABLISHED: High engagement, consistent posting
  return 'ESTABLISHED';
}

export function calculateOverallScore(platforms: PlatformMetrics[], maturityStage: MaturityStage): number {
  if (platforms.length === 0) return 0;

  const totalFollowers = platforms.reduce((sum, p) => sum + p.followers, 0);
  const avgEngagement = platforms.reduce((sum, p) => sum + p.engagementRate, 0) / platforms.length;
  const avgPostingFreq = platforms.reduce((sum, p) => sum + p.postingFrequency, 0) / platforms.length;

  // Base score from followers (0-40 points)
  const followerScore = Math.min(40, Math.log10(totalFollowers + 1) * 10);

  // Engagement score (0-35 points)
  const engagementScore = Math.min(35, avgEngagement * 10);

  // Consistency score (0-25 points)
  const consistencyScore = Math.min(25, avgPostingFreq * 5);

  const baseScore = followerScore + engagementScore + consistencyScore;

  // Maturity multiplier
  const maturityMultiplier = maturityStage === 'NEW' ? 0.7 : maturityStage === 'GROWING' ? 0.9 : 1.0;

  return Math.round(baseScore * maturityMultiplier);
}

export function generateRecommendations(platforms: PlatformMetrics[], maturityStage: MaturityStage): string[] {
  const recommendations: string[] = [];

  if (maturityStage === 'NEW') {
    recommendations.push('Focus on building consistent posting habits (3-5 posts/week)');
    recommendations.push('Engage with your audience through comments and DMs');
    recommendations.push('Create content that encourages shares and saves');
  } else if (maturityStage === 'GROWING') {
    recommendations.push('Experiment with different content types to boost engagement');
    recommendations.push('Collaborate with similar-sized accounts in your niche');
    recommendations.push('Analyze top-performing posts and replicate successful formats');
  } else {
    recommendations.push('Leverage your established audience for deeper engagement');
    recommendations.push('Consider creator partnerships and brand collaborations');
    recommendations.push('Focus on high-quality, authentic content that resonates');
  }

  // Platform-specific recommendations
  platforms.forEach(platform => {
    if (platform.engagementRate < 2.0) {
      recommendations.push(`Improve engagement on ${platform.platform} - try interactive content`);
    }
    if (platform.postingFrequency < 3) {
      recommendations.push(`Increase posting frequency on ${platform.platform} for better visibility`);
    }
  });

  return recommendations.slice(0, 3); // Limit to top 3 recommendations
}
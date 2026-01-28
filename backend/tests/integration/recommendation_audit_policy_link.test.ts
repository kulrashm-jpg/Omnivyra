const buildPolicySimulationLink = (recommendationId?: string | null, campaignId?: string | null) => {
  if (!recommendationId) return '/recommendations/policy';
  const params = new URLSearchParams();
  params.set('recommendationId', recommendationId);
  if (campaignId) params.set('campaignId', campaignId);
  return `/recommendations/policy?${params.toString()}`;
};

const getRecommendationBannerText = (recommendationId?: string | null) => {
  if (!recommendationId) return null;
  return `Simulating based on Recommendation: ${recommendationId}`;
};

describe('Recommendation audit policy link', () => {
  it('builds policy simulation link with recommendation and campaign id', () => {
    const link = buildPolicySimulationLink('rec-123', 'camp-456');
    expect(link).toContain('recommendationId=rec-123');
    expect(link).toContain('campaignId=camp-456');
  });

  it('shows banner text when recommendation id present', () => {
    const banner = getRecommendationBannerText('rec-123');
    expect(banner).toContain('rec-123');
  });
});

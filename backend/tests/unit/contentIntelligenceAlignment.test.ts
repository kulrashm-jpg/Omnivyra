/**
 * Unit tests for Content Intelligence Company → Market alignment changes.
 * Covers: deriveDisqualifiedSignals, campaign focus in drift, trend alignment category, etc.
 */

import { deriveDisqualifiedSignals } from '../../services/companyMissionContext';
import { detectTrendDrift } from '../../services/trendDriftService';
import { buildTrendAssessments } from '../../services/trends/trendAlignmentService';
import type { CompanyProfile } from '../../services/companyProfileService';

jest.mock('../../services/externalApiService', () => ({
  fetchTrendsFromApis: jest.fn(),
}));

const fetchTrendsFromApis = jest.requireMock('../../services/externalApiService')
  .fetchTrendsFromApis as jest.Mock;

describe('Content Intelligence Alignment', () => {
  describe('deriveDisqualifiedSignals', () => {
    it('returns DEFAULT disqualified signals when profile has no exclusions', () => {
      const profile = { company_id: 'c1' } as CompanyProfile;
      const result = deriveDisqualifiedSignals(profile);
      expect(result).toContain('Event announcements');
      expect(result).toContain('Generic motivational posts');
    });

    it('adds profile-driven exclusions from content_strategy', () => {
      const profile = {
        company_id: 'c1',
        content_strategy: 'avoid webinars, no paid ads',
      } as CompanyProfile;
      const result = deriveDisqualifiedSignals(profile);
      expect(result.some((s) => s.toLowerCase().includes('webinar'))).toBe(true);
      expect(result.some((s) => s.toLowerCase().includes('paid'))).toBe(true);
    });

    it('adds identity_safe_topics when present', () => {
      const profile = {
        company_id: 'c1',
        identity_safe_topics: 'politics, religion',
      } as CompanyProfile & { identity_safe_topics?: string };
      const result = deriveDisqualifiedSignals(profile);
      expect(result.some((s) => s.toLowerCase().includes('politics'))).toBe(true);
      expect(result.some((s) => s.toLowerCase().includes('religion'))).toBe(true);
    });
  });

  describe('Campaign focus in trend drift (buildThemeTokens)', () => {
    it('includes campaign_focus tokens in relevant new topics', () => {
      const profile: CompanyProfile = {
        company_id: 'c1',
        campaign_focus: 'AI marketing automation',
        content_themes_list: ['productivity'],
        industry_list: ['tech'],
      } as CompanyProfile;
      const result = detectTrendDrift({
        companyProfile: profile,
        previousTrends: ['productivity', 'tech'],
        newTrends: ['productivity', 'tech', 'marketing', 'automation'],
      });
      expect(result.newTopics).toContain('marketing');
      expect(result.newTopics).toContain('automation');
      expect(result.driftDetected).toBe(true);
    });

    it('excludes new topics unrelated to campaign_focus and themes', () => {
      const profile: CompanyProfile = {
        company_id: 'c1',
        campaign_focus: 'B2B SaaS',
        content_themes_list: ['productivity'],
      } as CompanyProfile;
      const result = detectTrendDrift({
        companyProfile: profile,
        previousTrends: ['productivity'],
        newTrends: ['productivity', 'sports', 'playoffs'],
      });
      expect(result.newTopics).not.toContain('sports');
      expect(result.newTopics).not.toContain('playoffs');
    });
  });

  describe('Category passed to fetchTrendsFromApis', () => {
    it('passes category from profile when calling fetchTrendsFromApis', async () => {
      fetchTrendsFromApis.mockResolvedValue([]);
      const profile: CompanyProfile = {
        company_id: 'c1',
        category: 'marketing',
        geography_list: ['US'],
      } as CompanyProfile;
      await buildTrendAssessments({
        profile,
        weekly_plan: [{ week_number: 1, theme: 'Test', trend_influence: [] }],
      });
      expect(fetchTrendsFromApis).toHaveBeenCalledWith(
        'c1',
        'US',
        'marketing',
        expect.any(Object)
      );
    });

    it('passes industry_list[0] as category when category is absent', async () => {
      fetchTrendsFromApis.mockResolvedValue([]);
      const profile: CompanyProfile = {
        company_id: 'c1',
        industry_list: ['Fintech'],
        geography_list: ['US'],
      } as CompanyProfile;
      await buildTrendAssessments({
        profile,
        weekly_plan: [{ week_number: 1, theme: 'Test', trend_influence: [] }],
      });
      expect(fetchTrendsFromApis).toHaveBeenCalledWith(
        'c1',
        'US',
        'Fintech',
        expect.any(Object)
      );
    });
  });
});

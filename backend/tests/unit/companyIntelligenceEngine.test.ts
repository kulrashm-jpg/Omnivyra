/**
 * Unit tests for companyIntelligenceEngine
 */

import {
  computeCompanyRelevance,
  transformToCompanySignals,
  type CompanyIntelligenceContext,
  type GlobalSignalInput,
} from '../../services/companyIntelligenceEngine';

const CONTEXT: CompanyIntelligenceContext = {
  industryTerms: ['saas', 'marketing'],
  competitors: [],
  keywords: ['content', 'growth'],
  region: 'US',
  productFocus: ['analytics', 'dashboard'],
};

describe('companyIntelligenceEngine', () => {
  describe('computeCompanyRelevance', () => {
    it('returns null for empty topic', () => {
      const result = computeCompanyRelevance(
        { id: 's1', topic: '' },
        'company-1',
        CONTEXT
      );
      expect(result).toBeNull();
    });

    it('returns null when relevance below threshold', () => {
      const result = computeCompanyRelevance(
        { id: 's1', topic: 'unrelated random words xyz', relevance_score: 0 },
        'company-1',
        CONTEXT
      );
      expect(result).toBeNull();
    });

    it('returns company signal when topic matches industry', () => {
      const result = computeCompanyRelevance(
        { id: 's1', topic: 'SaaS marketing trends 2025', relevance_score: 0.6 },
        'company-1',
        CONTEXT
      );
      expect(result).not.toBeNull();
      expect(result!.company_id).toBe('company-1');
      expect(result!.signal_id).toBe('s1');
      expect(result!.company_relevance_score).toBeGreaterThanOrEqual(0.2);
      expect(result!.company_signal_type).toBeDefined();
      expect(result!.impact_score).toBeGreaterThanOrEqual(0);
    });

    it('does not classify raw competitor-name substrings as competitor activity', () => {
      const result = computeCompanyRelevance(
        { id: 's2', topic: 'Acme product launch announced', relevance_score: 0.5 },
        'company-1',
        CONTEXT
      );
      expect(result).not.toBeNull();
      expect(result!.company_signal_type).toBe('product_launch');
    });

    it('returns customer_sentiment when topic has complaint keywords', () => {
      const result = computeCompanyRelevance(
        { id: 's3', topic: 'Customer complaint about billing', relevance_score: 0.5 },
        'company-1',
        CONTEXT
      );
      expect(result).not.toBeNull();
      expect(result!.company_signal_type).toBe('customer_sentiment');
    });
  });

  describe('transformToCompanySignals', () => {
    it('returns empty array for empty input', () => {
      expect(transformToCompanySignals([], 'c1', CONTEXT)).toEqual([]);
    });

    it('filters and transforms multiple signals', () => {
      const signals: GlobalSignalInput[] = [
        { id: 's1', topic: 'SaaS marketing growth', relevance_score: 0.7 },
        { id: 's2', topic: 'xyz abc unrelated', relevance_score: 0.1 },
        { id: 's3', topic: 'Content analytics dashboard launch', relevance_score: 0.6 },
      ];
      const out = transformToCompanySignals(signals, 'c1', CONTEXT);
      expect(out.length).toBeGreaterThanOrEqual(1);
      expect(out.every((s) => s.company_id === 'c1')).toBe(true);
      expect(out.every((s) => s.company_relevance_score >= 0.2)).toBe(true);
      expect(out.some((s) => s.company_signal_type === 'competitor_activity')).toBe(false);
    });
  });
});

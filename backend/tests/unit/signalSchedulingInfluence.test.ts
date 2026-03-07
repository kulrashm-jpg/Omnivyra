/**
 * Unit tests for Phase 7 — Signal Scheduling Influence.
 */

import { analyzeSignalInfluence } from '../../services/signalSchedulingInfluence';
import { supabase } from '../../db/supabaseClient';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

const mockFrom = supabase.from as jest.Mock;

describe('signalSchedulingInfluence (Phase 7)', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  describe('analyzeSignalInfluence', () => {
    it('returns empty array when no signals', async () => {
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const result = await analyzeSignalInfluence(
        {},
        'c1',
        '2025-03-03T00:00:00Z',
        '2025-03-09T23:59:59Z'
      );

      expect(result).toEqual([]);
    });

    it('filters signals by score >= 0.6 and limits to 5', async () => {
      const signals = [
        { id: '1', company_id: 'c1', signal_type: 'industry_trend', signal_source: 'news', signal_topic: 'AI regulation', signal_score: 0.82, signal_timestamp: '2025-03-07T10:00:00Z', metadata: null, created_at: '' },
        { id: '2', company_id: 'c1', signal_type: 'competitor_activity', signal_source: 'api', signal_topic: 'Product launch', signal_score: 0.55, signal_timestamp: '2025-03-06T10:00:00Z', metadata: null, created_at: '' },
      ];
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: signals, error: null }),
      });

      const result = await analyzeSignalInfluence(
        {},
        'c1',
        '2025-03-03T00:00:00Z',
        '2025-03-09T23:59:59Z'
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.signal_type).toBe('industry_trend');
      expect(result[0]!.message).toBe('Trending topic detected: AI regulation.');
      expect(result[0]!.recommendation).toContain('AI regulation');
    });

    it('applies RULE 1 (industry_trend) message format', async () => {
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: [
            { id: '1', company_id: 'c1', signal_type: 'industry_trend', signal_source: 'news', signal_topic: 'AI regulation', signal_score: 0.82, signal_timestamp: '2025-03-07T10:00:00Z', metadata: null, created_at: '' },
          ],
          error: null,
        }),
      });

      const result = await analyzeSignalInfluence({}, 'c1', '2025-03-03', '2025-03-09');
      expect(result[0]!.type).toBe('signal_opportunity');
      expect(result[0]!.message).toBe('Trending topic detected: AI regulation.');
    });

    it('applies RULE 2 (seasonal_event) message format', async () => {
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: [
            { id: '1', company_id: 'c1', signal_type: 'seasonal_event', signal_source: 'internal', signal_topic: 'Q1 planning', signal_score: 0.75, signal_timestamp: '2025-03-07T10:00:00Z', metadata: null, created_at: '' },
          ],
          error: null,
        }),
      });

      const result = await analyzeSignalInfluence({}, 'c1', '2025-03-03', '2025-03-09');
      expect(result[0]!.message).toBe('Upcoming seasonal event may influence audience engagement.');
    });

    it('applies RULE 3 (competitor_activity) message format', async () => {
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: [
            { id: '1', company_id: 'c1', signal_type: 'competitor_activity', signal_source: 'api', signal_topic: 'Product launch', signal_score: 0.7, signal_timestamp: '2025-03-07T10:00:00Z', metadata: null, created_at: '' },
          ],
          error: null,
        }),
      });

      const result = await analyzeSignalInfluence({}, 'c1', '2025-03-03', '2025-03-09');
      expect(result[0]!.message).toBe('Competitor activity detected around Product launch.');
    });
  });
});

/**
 * Unit tests for Phase 6A Scheduling Signal Intelligence.
 * Tests scoreSignal logic and recordSignal/getSignalsForWeek API.
 */

import {
  scoreSignal,
  recordSignal,
  getSignalsForWeek,
  SIGNAL_TYPES,
  type SchedulingSignalInput,
} from '../../services/signalIntelligenceEngine';
import { supabase } from '../../db/supabaseClient';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

const mockFrom = supabase.from as jest.Mock;

describe('schedulingSignalIntelligence (Phase 6A)', () => {
  describe('scoreSignal', () => {
    it('uses formula: recencyWeight*0.4 + topicRelevance*0.4 + sourceReliability*0.2', () => {
      const signal: SchedulingSignalInput = {
        company_id: 'c1',
        signal_type: 'industry_trend',
        signal_source: 'news',
        signal_topic: 'AI regulation',
        signal_timestamp: new Date().toISOString(),
        topic_relevance: 0.8,
        source_reliability: 0.9,
      };
      const score = scoreSignal(signal);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
      expect(typeof score).toBe('number');
    });

    it('weights recency: newer signals score higher', () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

      const recent: SchedulingSignalInput = {
        company_id: 'c1',
        signal_type: 'market_news',
        signal_source: 'news',
        signal_topic: 'X',
        signal_timestamp: oneHourAgo.toISOString(),
        topic_relevance: 0.5,
        source_reliability: 0.5,
      };
      const old: SchedulingSignalInput = {
        ...recent,
        signal_timestamp: eightDaysAgo.toISOString(),
      };

      expect(scoreSignal(recent)).toBeGreaterThan(scoreSignal(old));
    });

    it('maps source reliability for known sources', () => {
      const base: Omit<SchedulingSignalInput, 'signal_source'> = {
        company_id: 'c1',
        signal_type: 'market_news',
        signal_topic: 'X',
        signal_timestamp: new Date().toISOString(),
        topic_relevance: 0.5,
      };
      const news = scoreSignal({ ...base, signal_source: 'news' });
      const social = scoreSignal({ ...base, signal_source: 'social' });
      expect(news).toBeGreaterThan(social);
    });

    it('clamps scores to [0, 1]', () => {
      const extreme: SchedulingSignalInput = {
        company_id: 'c1',
        signal_type: 'industry_trend',
        signal_source: 'news',
        signal_topic: 'X',
        signal_timestamp: new Date().toISOString(),
        topic_relevance: 1.2,
        source_reliability: 1.5,
      };
      const score = scoreSignal(extreme);
      expect(score).toBeLessThanOrEqual(1);
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('recordSignal', () => {
    beforeEach(() => {
      mockFrom.mockReset();
    });

    it('inserts into scheduling_intelligence_signals with computed score', async () => {
      const chain = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            id: 'sig-1',
            company_id: 'c1',
            signal_type: 'industry_trend',
            signal_source: 'news',
            signal_topic: 'AI regulation',
            signal_score: 0.82,
            signal_timestamp: '2025-03-07T10:00:00Z',
            metadata: {},
            created_at: '2025-03-07T10:00:00Z',
          },
          error: null,
        }),
      };
      mockFrom.mockReturnValue(chain);

      const result = await recordSignal({
        company_id: 'c1',
        signal_type: 'industry_trend',
        signal_source: 'news',
        signal_topic: 'AI regulation',
        signal_timestamp: '2025-03-07T10:00:00Z',
      });

      expect(mockFrom).toHaveBeenCalledWith('scheduling_intelligence_signals');
      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          company_id: 'c1',
          signal_type: 'industry_trend',
          signal_source: 'news',
          signal_topic: 'AI regulation',
          signal_timestamp: '2025-03-07T10:00:00Z',
          metadata: {},
        })
      );
      expect(result.id).toBe('sig-1');
      expect(result.signal_score).toBe(0.82);
    });

    it('accepts override signal_score', async () => {
      const chain = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { id: 'sig-2', signal_score: 0.95, company_id: 'c1', signal_type: 'market_news', signal_source: 'api', signal_topic: 'X', signal_timestamp: '2025-03-07T10:00:00Z', metadata: null, created_at: '' },
          error: null,
        }),
      };
      mockFrom.mockReturnValue(chain);

      await recordSignal({
        company_id: 'c1',
        signal_type: 'market_news',
        signal_source: 'api',
        signal_topic: 'X',
        signal_timestamp: '2025-03-07T10:00:00Z',
        signal_score: 0.95,
      });

      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ signal_score: 0.95 })
      );
    });
  });

  describe('getSignalsForWeek', () => {
    beforeEach(() => {
      mockFrom.mockReset();
    });

    it('queries by company_id and date range, ordered by score desc', async () => {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: [
            {
              id: 's1',
              company_id: 'c1',
              signal_type: 'industry_trend',
              signal_source: 'news',
              signal_topic: 'AI regulation',
              signal_score: 0.82,
              signal_timestamp: '2025-03-07T10:00:00Z',
              metadata: null,
              created_at: '2025-03-07T10:00:00Z',
            },
          ],
          error: null,
        }),
      };
      mockFrom.mockReturnValue(chain);

      const weekStart = '2025-03-03T00:00:00Z';
      const weekEnd = '2025-03-09T23:59:59Z';
      const result = await getSignalsForWeek('c1', weekStart, weekEnd);

      expect(mockFrom).toHaveBeenCalledWith('scheduling_intelligence_signals');
      expect(chain.eq).toHaveBeenCalledWith('company_id', 'c1');
      expect(chain.gte).toHaveBeenCalledWith('signal_timestamp', weekStart);
      expect(chain.lte).toHaveBeenCalledWith('signal_timestamp', weekEnd);
      expect(chain.order).toHaveBeenCalledWith('signal_score', { ascending: false });
      expect(result).toHaveLength(1);
      expect(result[0]!.signal_score).toBe(0.82);
      expect(result[0]!.signal_topic).toBe('AI regulation');
    });
  });

  describe('SIGNAL_TYPES', () => {
    it('includes required types', () => {
      expect(SIGNAL_TYPES).toContain('industry_trend');
      expect(SIGNAL_TYPES).toContain('competitor_activity');
      expect(SIGNAL_TYPES).toContain('company_event');
      expect(SIGNAL_TYPES).toContain('seasonal_event');
      expect(SIGNAL_TYPES).toContain('market_news');
    });
  });
});

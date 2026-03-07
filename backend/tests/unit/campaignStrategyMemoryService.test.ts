/**
 * Unit tests for Campaign Strategy Memory Service
 */
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { supabase } from '../../db/supabaseClient';
import {
  getStrategyMemory,
  updateStrategyMemory,
  updateStrategyMemoryFromSignals,
} from '../../services/campaignStrategyMemoryService';

function chain(result: { data: any; error: any }) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    upsert: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
  };
}

describe('campaignStrategyMemoryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getStrategyMemory', () => {
    it('retrieves company strategy memory', async () => {
      const mockRow = {
        id: 'uuid-1',
        company_id: 'co-1',
        preferred_tone: 'professional',
        preferred_platforms: ['linkedin', 'x'],
        preferred_content_types: ['carousel', 'blog'],
        last_updated: '2025-03-05T12:00:00Z',
      };
      (supabase.from as jest.Mock).mockReturnValue(
        chain({ data: mockRow, error: null })
      );

      const result = await getStrategyMemory('co-1');

      expect(result).not.toBeNull();
      expect(result?.company_id).toBe('co-1');
      expect(result?.preferred_tone).toBe('professional');
      expect(result?.preferred_platforms).toEqual(['linkedin', 'x']);
      expect(result?.preferred_content_types).toEqual(['carousel', 'blog']);
      expect(supabase.from).toHaveBeenCalledWith('campaign_strategy_memory');
    });

    it('returns null for empty companyId', async () => {
      const result = await getStrategyMemory('');
      expect(result).toBeNull();
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('returns null when no row exists', async () => {
      (supabase.from as jest.Mock).mockReturnValue(
        chain({ data: null, error: null })
      );
      const result = await getStrategyMemory('co-2');
      expect(result).toBeNull();
    });
  });

  describe('updateStrategyMemory', () => {
    it('updates memory correctly', async () => {
      const mockUpserted = {
        id: 'uuid-1',
        company_id: 'co-1',
        preferred_tone: 'conversational',
        preferred_platforms: ['linkedin'],
        preferred_content_types: ['post'],
        last_updated: '2025-03-05T12:00:00Z',
      };
      (supabase.from as jest.Mock).mockReturnValue({
        upsert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: mockUpserted, error: null }),
          }),
        }),
      });

      const result = await updateStrategyMemory('co-1', {
        preferred_tone: 'conversational',
        preferred_platforms: ['linkedin'],
        preferred_content_types: ['post'],
      });

      expect(result).not.toBeNull();
      expect(result?.preferred_tone).toBe('conversational');
      expect(result?.preferred_platforms).toEqual(['linkedin']);
      expect(result?.preferred_content_types).toEqual(['post']);
      expect(supabase.from).toHaveBeenCalledWith('campaign_strategy_memory');
    });

    it('returns null for empty companyId', async () => {
      const result = await updateStrategyMemory('', { preferred_tone: 'professional' });
      expect(result).toBeNull();
    });
  });

  describe('integration with planning pipeline', () => {
    it('getStrategyMemory returns shape usable for allocatePlatforms', async () => {
      const mockRow = {
        id: 'uuid-1',
        company_id: 'co-1',
        preferred_tone: 'educational',
        preferred_platforms: ['x', 'linkedin'],
        preferred_content_types: ['carousel'],
        last_updated: '2025-03-05T12:00:00Z',
      };
      (supabase.from as jest.Mock).mockReturnValue(
        chain({ data: mockRow, error: null })
      );

      const memory = await getStrategyMemory('co-1');
      expect(memory?.preferred_platforms).toBeDefined();
      expect(Array.isArray(memory?.preferred_platforms)).toBe(true);
      expect(memory?.preferred_platforms).toEqual(['x', 'linkedin']);
      expect(memory?.preferred_tone).toBe('educational');
    });

    it('getStrategyMemory returns shape usable for languageRefinementService', async () => {
      const mockRow = {
        id: 'uuid-1',
        company_id: 'co-1',
        preferred_tone: 'inspirational',
        preferred_platforms: [],
        preferred_content_types: [],
        last_updated: '2025-03-05T12:00:00Z',
      };
      (supabase.from as jest.Mock).mockReturnValue(
        chain({ data: mockRow, error: null })
      );

      const memory = await getStrategyMemory('co-1');
      expect(typeof memory?.preferred_tone).toBe('string');
      expect(['conversational', 'educational', 'professional', 'inspirational']).toContain(
        memory?.preferred_tone
      );
    });
  });

  describe('updateStrategyMemoryFromSignals', () => {
    it('does not throw when table missing or empty', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: [], error: null }),
        }),
      });
      await expect(
        updateStrategyMemoryFromSignals('co-1', 'camp-1')
      ).resolves.not.toThrow();
    });
  });
});

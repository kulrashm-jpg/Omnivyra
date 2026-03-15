import {
  normalizeStrategyContext,
  migrateStrategyContext,
  StrategyContextValidationError,
  StrategySchemaVersionError,
  StrategySchemaMigrationError,
} from '../../services/strategyContextService';

describe('strategyContextService', () => {
  it('rejects posting_frequency keys not in platforms', () => {
    const input = {
      duration_weeks: 12,
      platforms: ['linkedin'],
      posting_frequency: { twitter: 5 },
    };
    expect(() => normalizeStrategyContext(input)).toThrow(StrategyContextValidationError);
    expect(() => normalizeStrategyContext(input)).toThrow(/must exist in platforms array/);
  });

  it('accepts valid StrategyContext with matching platforms and posting_frequency', () => {
    const input = {
      duration_weeks: 12,
      platforms: ['linkedin', 'twitter'],
      posting_frequency: { linkedin: 3, twitter: 5 },
    };
    const result = normalizeStrategyContext(input);
    expect(result.strategy_schema_version).toBe(1);
    expect(result.duration_weeks).toBe(12);
    expect(result.platforms).toEqual(['linkedin', 'twitter']);
    expect(result.posting_frequency).toEqual({ linkedin: 3, twitter: 5 });
  });

  it('rejects posting_frequency > 30', () => {
    const input = {
      duration_weeks: 12,
      platforms: ['linkedin'],
      posting_frequency: { linkedin: 50 },
    };
    expect(() => normalizeStrategyContext(input)).toThrow(StrategyContextValidationError);
    expect(() => normalizeStrategyContext(input)).toThrow(/between 0 and 30/);
  });

  it('normalizes content_mix so total = 100', () => {
    const input = {
      duration_weeks: 12,
      platforms: ['linkedin'],
      posting_frequency: { linkedin: 3 },
      content_mix: { post: 30, video: 30 },
    };
    const result = normalizeStrategyContext(input);
    expect(result.content_mix).toEqual({ post: 50, video: 50 });
  });

  it('normalizes platform LinkedIn to linkedin and removes zero-frequency platforms', () => {
    const input = {
      duration_weeks: 12,
      platforms: ['LinkedIn', 'twitter'],
      posting_frequency: { linkedin: 3, twitter: 0 },
    };
    const result = normalizeStrategyContext(input);
    expect(result.platforms).toEqual(['linkedin']);
    expect(result.posting_frequency).toEqual({ linkedin: 3 });
  });

  it('does not mutate input (clones before processing)', () => {
    const input = {
      duration_weeks: 12,
      platforms: ['linkedin'],
      posting_frequency: { linkedin: 3 },
    };
    const result = normalizeStrategyContext(input);
    expect(result).not.toBe(input);
    expect(input.platforms).toEqual(['linkedin']);
    expect(input.posting_frequency).toEqual({ linkedin: 3 });
  });

  it('rejects unknown platform (no fallback)', () => {
    const input = {
      duration_weeks: 12,
      platforms: ['facebook'],
      posting_frequency: { facebook: 3 },
    };
    expect(() => normalizeStrategyContext(input)).toThrow(StrategyContextValidationError);
    expect(() => normalizeStrategyContext(input)).toThrow(/Unknown platform/);
  });

  it('rejects content_mix with sum > 100', () => {
    const input = {
      duration_weeks: 12,
      platforms: ['linkedin'],
      posting_frequency: { linkedin: 3 },
      content_mix: { post: 60, video: 50 },
    };
    expect(() => normalizeStrategyContext(input)).toThrow(StrategyContextValidationError);
    expect(() => normalizeStrategyContext(input)).toThrow(/sum must be <= 100/);
  });

  it('rejects content_mix with negative value', () => {
    const input = {
      duration_weeks: 12,
      platforms: ['linkedin'],
      posting_frequency: { linkedin: 3 },
      content_mix: { post: -1 },
    };
    expect(() => normalizeStrategyContext(input)).toThrow(StrategyContextValidationError);
    expect(() => normalizeStrategyContext(input)).toThrow(/must be >= 0/);
  });

  it('accepts missing strategy_schema_version as v1', () => {
    const input = {
      duration_weeks: 12,
      platforms: ['linkedin'],
      posting_frequency: { linkedin: 3 },
    };
    const result = normalizeStrategyContext(input);
    expect(result.strategy_schema_version).toBe(1);
  });

  it('accepts strategy_schema_version 1', () => {
    const input = {
      strategy_schema_version: 1,
      duration_weeks: 12,
      platforms: ['linkedin'],
      posting_frequency: { linkedin: 3 },
    };
    const result = normalizeStrategyContext(input);
    expect(result.strategy_schema_version).toBe(1);
  });

  it('throws StrategySchemaMigrationError when migration returns incomplete object', () => {
    const incomplete = {
      strategy_schema_version: 1,
      duration_weeks: 12,
    };
    expect(() => migrateStrategyContext(incomplete)).toThrow(StrategySchemaMigrationError);
    expect(() => migrateStrategyContext(incomplete)).toThrow(/missing required field/);
  });

  it('throws StrategySchemaVersionError for strategy_schema_version 2', () => {
    const input = {
      strategy_schema_version: 2,
      duration_weeks: 12,
      platforms: ['linkedin'],
      posting_frequency: { linkedin: 3 },
    };
    expect(() => normalizeStrategyContext(input)).toThrow(StrategySchemaVersionError);
    expect(() => normalizeStrategyContext(input)).toThrow(/not supported|Expected/);
  });

  it('returns deeply frozen (immutable) output', () => {
    const result = normalizeStrategyContext({
      duration_weeks: 12,
      platforms: ['linkedin'],
      posting_frequency: { linkedin: 3 },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.platforms)).toBe(true);
    expect(Object.isFrozen(result.posting_frequency)).toBe(true);
    expect(() => {
      (result as { duration_weeks: number }).duration_weeks = 6;
    }).toThrow();
    expect(() => {
      result.platforms.push('twitter');
    }).toThrow();
  });
});

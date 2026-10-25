/**
 * Search geography is sent as Google's own parameters, not appended to the query.
 *
 * Before: a geography of "India" turned "AI marketing platform" into the different query
 * "AI marketing platform India", run from an unrecorded default location. A "not found"
 * could not be read against where it was searched.
 */
import { resolveSearchContext } from '../../services/serp/canonicalSerpClient';

describe('resolveSearchContext', () => {
  it('sends a recognised country as gl/location and leaves the query untouched', () => {
    expect(resolveSearchContext('AI marketing platform', 'India', 20)).toEqual({
      gl: 'in', hl: 'en', location: 'India', geographyAppendedToQuery: false, sentQuery: 'AI marketing platform', depth: 20,
    });
  });

  it('is case-insensitive and maps aliases', () => {
    expect(resolveSearchContext('q', 'united states', 10).gl).toBe('us');
    expect(resolveSearchContext('q', 'UK', 10).gl).toBe('uk');
  });

  it('keeps the previous behaviour for an unrecognised geography, and says so', () => {
    const ctx = resolveSearchContext('dentists', 'Pune', 10);
    expect(ctx.sentQuery).toBe('dentists Pune');
    expect(ctx.geographyAppendedToQuery).toBe(true);
    expect(ctx.gl).toBeNull();
  });

  it('records the context even with no geography', () => {
    expect(resolveSearchContext('q', null, 8)).toEqual({ gl: null, hl: 'en', location: null, geographyAppendedToQuery: false, sentQuery: 'q', depth: 8 });
  });
});

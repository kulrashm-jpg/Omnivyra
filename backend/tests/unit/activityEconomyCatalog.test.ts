/**
 * Activity Economy Catalog — unit tests (Phase 8A).
 *
 * Certifies: every CreditAction is mapped to exactly one class, class economics
 * satisfy the band/timeout invariants, and resolveActivityEconomics returns the
 * contracted shape with reservationCredits = maximumCredits − entryConsumption.
 *
 * supabaseClient is mocked only because importing CREDIT_ACTIONS pulls in
 * creditDeductionService's transitive DB import; the catalog itself is DB-free.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

import { CREDIT_ACTIONS } from '../../services/creditDeductionService';
import {
  ACTIVITY_CLASS_ECONOMICS,
  ACTIVITY_CLASS_MAP,
  SYSTEM_PRICING_KEYS,
  getActivityClass,
  resolveActivityEconomics,
  type ActivityClass,
} from '../../services/activityEconomyCatalog';

describe('activityEconomyCatalog', () => {
  describe('class economics invariants', () => {
    const classes = Object.keys(ACTIVITY_CLASS_ECONOMICS) as ActivityClass[];

    it.each(classes)('%s: 0 <= entry <= min <= max and timeout >= 0', (cls) => {
      const e = ACTIVITY_CLASS_ECONOMICS[cls];
      expect(e.entryConsumptionCredits).toBeGreaterThanOrEqual(0);
      expect(e.entryConsumptionCredits).toBeLessThanOrEqual(e.minimumCredits);
      expect(e.minimumCredits).toBeLessThanOrEqual(e.maximumCredits);
      expect(e.abandonmentTimeoutSeconds).toBeGreaterThanOrEqual(0);
    });
  });

  describe('mapping completeness (no activity left unmapped)', () => {
    it('every CreditAction has a class', () => {
      for (const action of CREDIT_ACTIONS) {
        expect(getActivityClass(action)).not.toBeNull();
      }
    });

    it('the map covers exactly the CreditAction set (no drift, no extras)', () => {
      const mapped = new Set(Object.keys(ACTIVITY_CLASS_MAP));
      const actions = new Set(CREDIT_ACTIONS as readonly string[]);
      // No CreditAction missing from the map.
      for (const a of actions) expect(mapped.has(a)).toBe(true);
      // No stale key in the map that isn't a CreditAction.
      for (const m of mapped) expect(actions.has(m)).toBe(true);
      expect(mapped.size).toBe(actions.size);
    });

    it('every mapped class is a defined class with economics', () => {
      for (const cls of Object.values(ACTIVITY_CLASS_MAP)) {
        expect(ACTIVITY_CLASS_ECONOMICS[cls]).toBeDefined();
      }
    });
  });

  describe('resolveActivityEconomics', () => {
    it('returns the contracted shape with reservation = max − entry', () => {
      for (const action of CREDIT_ACTIONS) {
        const r = resolveActivityEconomics(action);
        expect(r.activity).toBe(action);
        expect(r.activityClass).toBe(ACTIVITY_CLASS_MAP[action]);
        const e = ACTIVITY_CLASS_ECONOMICS[r.activityClass];
        expect(r.entryConsumption).toBe(e.entryConsumptionCredits);
        expect(r.minimumCredits).toBe(e.minimumCredits);
        expect(r.maximumCredits).toBe(e.maximumCredits);
        expect(r.reservationCredits).toBe(e.maximumCredits - e.entryConsumptionCredits);
        expect(r.abandonmentTimeoutSeconds).toBe(e.abandonmentTimeoutSeconds);
        // Exposure is always non-negative.
        expect(r.reservationCredits).toBeGreaterThanOrEqual(0);
      }
    });

    it('resolves system metering keys to SYSTEM', () => {
      for (const key of SYSTEM_PRICING_KEYS) {
        const r = resolveActivityEconomics(key);
        expect(r.activityClass).toBe('SYSTEM');
        expect(r.entryConsumption).toBe(0);
        expect(r.reservationCredits).toBe(0);
      }
    });

    it('throws on an unknown action rather than resolving to free', () => {
      expect(() => resolveActivityEconomics('not_a_real_action')).toThrow(/No activity class/);
    });
  });

  describe('representative mappings', () => {
    it.each([
      ['blog_generation', 'LONG_GENERATION'],
      ['content_generation', 'LONG_GENERATION'],
      ['campaign_generation', 'AUTOMATION'],
      ['campaign_creation', 'AUTOMATION'],
      ['voice_per_minute', 'VOICE'],
      ['ai_reply', 'REPLY'],
      ['full_strategy', 'DEEP_RESEARCH'],
      ['lead_detection', 'INTELLIGENCE_SCAN'],
      ['image_generation', 'IMAGE_GENERATION'],
      ['video_generation', 'VIDEO_GENERATION'],
    ] as const)('%s -> %s', (action, cls) => {
      expect(getActivityClass(action)).toBe(cls);
    });
  });
});

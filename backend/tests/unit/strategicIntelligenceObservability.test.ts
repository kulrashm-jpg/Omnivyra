/**
 * RELEASE-READINESS-001 — Strategic Recommendation Intelligence observability contracts.
 *
 * Instrumentation is the ONLY production-code change this release makes to an
 * already-certified capability, so it is held to three non-negotiable contracts:
 *
 *   1. FAIL-SAFE     — a throwing metrics sink must never surface into enrichment.
 *   2. NO PII        — the emitted surface is counts / durations / fixed enums.
 *                      Narrative values, profile text, topics and tenant ids must
 *                      never reach the registry.
 *   3. INERT         — enrichment output is byte-identical whether observability is
 *                      enabled or disabled, and the feature flag stays default OFF.
 */
import { registry } from '../../observability/registry';
import {
  STRATEGIC_INTELLIGENCE_METRICS,
  recordStrategicIntelligenceInvoked,
  recordStrategicIntelligenceSucceeded,
  recordStrategicIntelligenceSkipped,
  recordStrategicIntelligenceFailed,
} from '../../observability/strategicIntelligenceMetrics';
import {
  enrichRecommendationIntelligence,
  strategicRecommendationIntelligenceEnabled,
  STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENV_VAR,
} from '../../services/strategicRecommendationIntelligenceService';
import type { CompanyProfile } from '../../services/companyProfileService';

const SENSITIVE_PROFILE: CompanyProfile = {
  company_id: 'acme-corp-9f13',
  core_problem_statement: 'CONFIDENTIAL_PROBLEM_STRING',
  target_audience: 'CONFIDENTIAL_AUDIENCE_STRING',
  desired_transformation: 'CONFIDENTIAL_TRANSFORMATION_STRING',
  awareness_gap: 'CONFIDENTIAL_GAP_STRING',
  authority_domains: ['CONFIDENTIAL_DOMAIN_STRING'],
} as unknown as CompanyProfile;

const CORPUS = [
  { topic: 'CONFIDENTIAL_TOPIC_ONE', source: 'test', geo: 'US', volume: 900, polish_flags: { authority_elevated: true } },
  { topic: 'CONFIDENTIAL_TOPIC_TWO', source: 'test', geo: 'US', volume: 40, polish_flags: { diamond_candidate: true } },
];

describe('RELEASE-READINESS-001 — strategic intelligence observability', () => {
  describe('1. fail-safe', () => {
    it('swallows a throwing registry sink on every emitter', () => {
      const incr = jest.spyOn(registry, 'incr').mockImplementation(() => {
        throw new Error('sink exploded');
      });
      const observe = jest.spyOn(registry, 'observe').mockImplementation(() => {
        throw new Error('sink exploded');
      });
      try {
        expect(() => recordStrategicIntelligenceInvoked('primary')).not.toThrow();
        expect(() => recordStrategicIntelligenceSucceeded('primary', 12)).not.toThrow();
        expect(() => recordStrategicIntelligenceSkipped('flag_disabled', 'primary')).not.toThrow();
        expect(() => recordStrategicIntelligenceSkipped('empty_result', 'fallback')).not.toThrow();
        expect(() => recordStrategicIntelligenceFailed('producer_fallback')).not.toThrow();
      } finally {
        incr.mockRestore();
        observe.mockRestore();
      }
    });

    it('enrichment still returns its normal output while the sink is throwing', () => {
      const incr = jest.spyOn(registry, 'incr').mockImplementation(() => {
        throw new Error('sink exploded');
      });
      try {
        const enriched = enrichRecommendationIntelligence([...CORPUS], SENSITIVE_PROFILE);
        expect(enriched).toHaveLength(2);
        expect(enriched[0].intelligence.problem_being_solved).toContain('CONFIDENTIAL_PROBLEM_STRING');
      } finally {
        incr.mockRestore();
      }
    });

    it('ignores non-finite / negative durations instead of polluting the histogram', () => {
      registry.reset();
      recordStrategicIntelligenceSucceeded('primary', Number.NaN);
      recordStrategicIntelligenceSucceeded('primary', -5);
      const durations = registry
        .histogramEntries()
        .filter((h) => h.name === STRATEGIC_INTELLIGENCE_METRICS.durationMs);
      expect(durations).toHaveLength(0);
      registry.reset();
    });
  });

  describe('2. no PII', () => {
    it('emits only counts, durations and fixed enum labels — never tenant data', () => {
      registry.reset();
      recordStrategicIntelligenceInvoked('primary');
      recordStrategicIntelligenceSucceeded('primary', 7);
      recordStrategicIntelligenceSkipped('flag_disabled', 'fallback');
      recordStrategicIntelligenceFailed('producer_fallback', 'primary');

      const emitted = JSON.stringify([registry.counterEntries(), registry.histogramEntries()]);

      // No caller-supplied value can appear, because no emitter accepts one.
      for (const secret of [
        'CONFIDENTIAL_PROBLEM_STRING',
        'CONFIDENTIAL_AUDIENCE_STRING',
        'CONFIDENTIAL_TOPIC_ONE',
        'acme-corp-9f13',
      ]) {
        expect(emitted).not.toContain(secret);
      }

      // Every label value is drawn from the two fixed enums.
      const allowedPaths = new Set(['primary', 'fallback']);
      const allowedReasons = new Set(['flag_disabled', 'empty_result', 'producer_fallback']);
      for (const entry of registry.counterEntries()) {
        const labels = (entry.labels ?? {}) as Record<string, unknown>;
        expect(Object.keys(labels).sort()).toEqual(
          expect.arrayContaining(Object.keys(labels).filter((k) => k === 'path' || k === 'reason')),
        );
        if (labels.path !== undefined) expect(allowedPaths.has(String(labels.path))).toBe(true);
        if (labels.reason !== undefined) expect(allowedReasons.has(String(labels.reason))).toBe(true);
      }
      registry.reset();
    });

    it('pins the metric-name surface (five names, no narrative field name among them)', () => {
      expect(Object.values(STRATEGIC_INTELLIGENCE_METRICS)).toEqual([
        'recommendation.strategic_intelligence.invoked',
        'recommendation.strategic_intelligence.succeeded',
        'recommendation.strategic_intelligence.skipped',
        'recommendation.strategic_intelligence.failed',
        'recommendation.strategic_intelligence.duration_ms',
      ]);
      const names = Object.values(STRATEGIC_INTELLIGENCE_METRICS).join('|');
      for (const field of [
        'problem_being_solved',
        'gap_being_filled',
        'why_now',
        'authority_reason',
        'expected_transformation',
        'campaign_angle',
      ]) {
        expect(names).not.toContain(field);
      }
    });
  });

  describe('3. inert', () => {
    it('produces byte-identical enrichment output with observability ON and OFF', () => {
      const previous = process.env.OBSERVABILITY_ENABLED;
      try {
        let withObservability = '';
        let withoutObservability = '';

        jest.isolateModules(() => {
          process.env.OBSERVABILITY_ENABLED = 'true';
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const mod = require('../../services/strategicRecommendationIntelligenceService');
          withObservability = JSON.stringify(
            mod.enrichRecommendationIntelligence([...CORPUS], SENSITIVE_PROFILE),
          );
        });

        jest.isolateModules(() => {
          process.env.OBSERVABILITY_ENABLED = 'false';
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const mod = require('../../services/strategicRecommendationIntelligenceService');
          withoutObservability = JSON.stringify(
            mod.enrichRecommendationIntelligence([...CORPUS], SENSITIVE_PROFILE),
          );
        });

        expect(withObservability).toBe(withoutObservability);
        expect(withObservability.length).toBeGreaterThan(0);
      } finally {
        if (previous === undefined) delete process.env.OBSERVABILITY_ENABLED;
        else process.env.OBSERVABILITY_ENABLED = previous;
        registry.reset();
      }
    });

    it('keeps the capability flag default OFF and enabled only by the exact string "true"', () => {
      const previous = process.env[STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENV_VAR];
      try {
        delete process.env[STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENV_VAR];
        expect(strategicRecommendationIntelligenceEnabled()).toBe(false);

        for (const value of ['', 'false', '0', 'TRUE', 'True', 'yes', 'on', '1', ' true ']) {
          process.env[STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENV_VAR] = value;
          expect(strategicRecommendationIntelligenceEnabled()).toBe(false);
        }

        process.env[STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENV_VAR] = 'true';
        expect(strategicRecommendationIntelligenceEnabled()).toBe(true);

        // Rollback is "unset the env var" — no code deployment.
        delete process.env[STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENV_VAR];
        expect(strategicRecommendationIntelligenceEnabled()).toBe(false);
      } finally {
        if (previous === undefined) delete process.env[STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENV_VAR];
        else process.env[STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENV_VAR] = previous;
      }
    });
  });
});

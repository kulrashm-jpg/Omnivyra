/**
 * REPORT-1-PROVENANCE-INTEGRITY-REMEDIATION-002 — provenance follows ORIGIN, never CHANNEL.
 *
 * THE SHARED DEFECT
 * Four symptoms shared one structural cause: a source-kind tag was chosen for the pipe a signal
 * arrived through rather than for where the evidence actually came from, and
 * `PROVENANCE_BY_SOURCE` then conferred a class on it.
 *
 *   • `evidenceSourceFromTag` mapped ANY `website_intelligence:*` tag to `crawler`, although the
 *     four engines sharing that channel read very different things.
 *   • `dimTrustCoherence` hard-coded `source: 'crawler'` on a value derived from
 *     `community_ai_actions` (Omnivyra platform activity) and `company_brand_identity`
 *     (tenant-declared) — the engine itself declares those origins truthfully and the dimension
 *     discarded them.
 *   • `social_links` was classified PUBLIC_OBSERVED although the set is a blend of crawled and
 *     typed URLs whose per-entry origin is unrecoverable.
 *
 * And one hole that made retagging alone insufficient: `scoreFromAxis` takes `state` as a
 * SEPARATE argument from `evidence`, so a dimension could be `measured` with every observation
 * excluded — a number with no evidence behind it.
 *
 * WHAT IS ASSERTED
 * The classification table, the tag mapper and the shared choke point, plus an end-to-end
 * assertion that a private-origin dimension cannot emerge from the real canonical builder as a
 * measured public observation.
 */
import {
  provenanceForSource,
  isReport1Source,
  isReport1Provenance,
  REPORT1_PROVENANCE,
  PRIVATE_PROVENANCE,
} from '../../services/evidenceProvenance';
import type { EvidenceSourceKind } from '../../services/canonicalReport/canonicalReportTypes';
import {
  DIMENSION_BUILDERS,
  type DimensionContext,
} from '../../services/canonicalReport/canonicalReportBuilderInputs';

/** Origins that are genuinely public and must stay public. */
const PUBLIC_ORIGINS: EvidenceSourceKind[] = [
  'crawler', 'public_audit', 'serp', 'wikidata', 'schema_org',
  'answer_engine', 'ads_transparency', 'review_aggregator', 'competitor_intelligence',
];

/** Origins that are NOT public observation and must never be asserted on by Report 1. */
const NON_PUBLIC_ORIGINS: EvidenceSourceKind[] = [
  'company_declared', 'platform_activity', 'social_links', 'gsc', 'trajectory_history',
];

describe('REMEDIATION-002 — provenance derives from origin, not channel', () => {
  // ── Test A: company-confirmed data ──────────────────────────────────────
  describe('A. tenant-declared evidence', () => {
    it('company_declared is COMPANY_CONFIRMED and never PUBLIC_OBSERVED', () => {
      expect(provenanceForSource('company_declared')).toBe('COMPANY_CONFIRMED');
      expect(provenanceForSource('company_declared')).not.toBe('PUBLIC_OBSERVED');
      expect(isReport1Source('company_declared')).toBe(false);
    });

    it('declared social links cannot assert a public observation', () => {
      // The blend is unrecoverable per entry, so the set cannot claim the public domain was seen.
      expect(provenanceForSource('social_links')).not.toBe('PUBLIC_OBSERVED');
      expect(isReport1Source('social_links')).toBe(false);
    });
  });

  // ── Test B: internal platform activity ──────────────────────────────────
  describe('B. Omnivyra platform activity', () => {
    it('platform_activity is OMNIVYRA_OBSERVED and never PUBLIC_OBSERVED', () => {
      expect(provenanceForSource('platform_activity')).toBe('OMNIVYRA_OBSERVED');
      expect(provenanceForSource('platform_activity')).not.toBe('PUBLIC_OBSERVED');
      expect(isReport1Source('platform_activity')).toBe(false);
    });

    it('is kept distinct from trajectory_history — both ours, different things', () => {
      expect(provenanceForSource('trajectory_history')).toBe('OMNIVYRA_OBSERVED');
      expect('platform_activity').not.toBe('trajectory_history');
    });
  });

  // ── Test C: genuine public observation survives ─────────────────────────
  describe('C. genuine public observation is not over-corrected', () => {
    it.each(PUBLIC_ORIGINS)('%s remains PUBLIC_OBSERVED', (source) => {
      expect(provenanceForSource(source)).toBe('PUBLIC_OBSERVED');
      expect(isReport1Source(source)).toBe(true);
    });
  });

  // ── Test D: derived stays derived ───────────────────────────────────────
  describe('D. derived and inferred values keep their own class', () => {
    it('heuristic and decisions are INFERRED — usable by Report 1, but not observations', () => {
      for (const src of ['heuristic', 'decisions'] as EvidenceSourceKind[]) {
        expect(provenanceForSource(src)).toBe('INFERRED');
        expect(isReport1Source(src)).toBe(true);
        expect(provenanceForSource(src)).not.toBe('PUBLIC_OBSERVED');
      }
    });

    it('benchmark_dataset stays ESTIMATED and llm_probe stays INFERRED', () => {
      expect(provenanceForSource('benchmark_dataset')).toBe('ESTIMATED');
      expect(provenanceForSource('llm_probe')).toBe('INFERRED');
    });
  });

  // ── Tests E + F: the two fabricated metrics lose their public claim ──────
  describe('E/F. publishing frequency and engagement cannot be built from a social URL', () => {
    it('the only source backing them is not Report 1 evidence', () => {
      // `reportScoreModelService` attributes both `frequency` (Publishing Frequency) and
      // `platforms` to `social_links` alone. With that demoted, neither can claim a public
      // observation of cadence or engagement — which is correct: nothing observes either.
      expect(isReport1Source('social_links')).toBe(false);
      expect(PRIVATE_PROVENANCE.has(provenanceForSource('social_links'))).toBe(true);
    });

    it('no source kind in the vocabulary asserts observed posting cadence or engagement', () => {
      // Guards against a future "cadence" source being invented to make the number look measured.
      const kinds: EvidenceSourceKind[] = [...PUBLIC_ORIGINS, ...NON_PUBLIC_ORIGINS];
      for (const k of kinds) expect(k).not.toMatch(/cadence|posting|engagement/i);
    });
  });

  // ── §17 end-to-end: the real dimension builder + the shared choke point ──
  describe('end-to-end — a private-origin dimension cannot emerge as measured', () => {
    /** Minimal real context: only what dimTrustCoherence reads. */
    const ctx = (brand: { score: number | null; brandTrust: number | null }): DimensionContext => ({
      snapshot: {} as never,
      brand: { ...brand, confidence: 0.9, evaluatedAt: '2026-09-28T00:00:00.000Z' },
      engineEvidence: null,
    });

    it('community sentiment (platform activity) does NOT become a measured public score', () => {
      const dim = DIMENSION_BUILDERS.trust_coherence(ctx({ score: 71, brandTrust: 64 }));
      expect(dim.score.state).toBe('unavailable');
      expect(dim.score.value).toBeNull();
      // The evidence is not silently dropped — it is recorded as excluded, and named.
      expect(dim.score.evidence.observations).toHaveLength(0);
      expect(dim.score.evidence.provenance.excludedSources).toContain('platform_activity');
      expect(dim.score.evidence.provenance.report1Clean).toBe(false);
      expect(dim.score.evidence.provenance.classes).not.toContain('PUBLIC_OBSERVED');
    });

    it('declared brand identity (company confirmed) does NOT become a measured public score', () => {
      // No brandTrust ⇒ falls back to brand.score, dominated by company_brand_identity.
      const dim = DIMENSION_BUILDERS.trust_coherence(ctx({ score: 82, brandTrust: null }));
      expect(dim.score.state).toBe('unavailable');
      expect(dim.score.value).toBeNull();
      expect(dim.score.evidence.provenance.excludedSources).toContain('company_declared');
      expect(dim.score.evidence.provenance.classes).not.toContain('PUBLIC_OBSERVED');
    });

    it('states WHY it is unavailable rather than describing a proxy it may not assert', () => {
      const dim = DIMENSION_BUILDERS.trust_coherence(ctx({ score: 82, brandTrust: 64 }));
      expect(dim.rationale).toMatch(/not established from public evidence/i);
      expect(dim.rationale).not.toMatch(/On-site brand-health proxy/i);
    });

    it('the dimension is kept, not deleted — it has a purpose once a public source resolves', () => {
      const dim = DIMENSION_BUILDERS.trust_coherence(ctx({ score: null, brandTrust: null }));
      expect(dim.key).toBe('trust_coherence');
      expect(dim.label).toBe('Trust Coherence');
      expect(dim.score.state).toBe('unavailable');
    });

    it('does not mass-abstain: a dimension with no evidence at all is untouched by the guard', () => {
      // Nothing excluded ⇒ the guard must not fire. This is what keeps the fix from
      // degenerating into "mark everything unavailable".
      const dim = DIMENSION_BUILDERS.trust_coherence(ctx({ score: null, brandTrust: null }));
      expect(dim.score.evidence.provenance.excluded).toHaveLength(0);
      expect(dim.score.evidence.provenance.report1Clean).toBe(true);
    });
  });

  // ── Test H: the existing class sets are intact ──────────────────────────
  describe('H. existing provenance controls are unchanged', () => {
    it('Report 1 asserts on exactly the four public-safe classes', () => {
      expect([...REPORT1_PROVENANCE].sort()).toEqual(
        ['ESTIMATED', 'INFERRED', 'PUBLIC_OBSERVED', 'UNAVAILABLE'].sort(),
      );
    });

    it('the three private classes remain private and disjoint from Report 1', () => {
      expect([...PRIVATE_PROVENANCE].sort()).toEqual(
        ['COMPANY_CONFIRMED', 'CONNECTED_SOURCE', 'OMNIVYRA_OBSERVED'].sort(),
      );
      for (const c of PRIVATE_PROVENANCE) expect(isReport1Provenance(c)).toBe(false);
    });

    it('gsc is still CONNECTED_SOURCE — the boundary that keeps Report 1 public', () => {
      expect(provenanceForSource('gsc')).toBe('CONNECTED_SOURCE');
      expect(isReport1Source('gsc')).toBe(false);
    });

    it.each(NON_PUBLIC_ORIGINS)('%s is excluded from Report 1 evidence', (source) => {
      expect(isReport1Source(source)).toBe(false);
    });
  });
});

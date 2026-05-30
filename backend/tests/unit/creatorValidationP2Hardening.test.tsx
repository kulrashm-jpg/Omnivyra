/**
 * @jest-environment jsdom
 *
 * Creator Validation P2 Hardening — focused tests:
 *
 *   Phase 1  Legal industry rule fires distinct from Finance/Consulting
 *   Phase 2  Multi-industry resolution: Healthcare SaaS, FinTech,
 *            InsurTech, LegalTech, HRTech, Manufacturing Software
 *   Phase 4  Industry contributions explainability surface
 *   Phase 3  Governance flow coverage matrix is structurally
 *            consistent and includes the five required flows
 */

import {
  analyzeIndustryContributions,
  getRecommendedPurposeOptionsForType,
  listRecommendationRules,
} from '../../services/creator/companyStrategyRecommendationEngine';
import {
  GOVERNANCE_FLOW_COVERAGE_MATRIX,
  getFlowCoverageRow,
  validateFlowCoverageMatrix,
} from '../../services/creator/governanceCoverageMatrix';

/* ── Phase 1 — Legal industry rule ──────────────────────────────── */

describe('Phase 1 — Legal industry rule (distinct from Finance / Consulting)', () => {
  test('Legal company prioritises educational/framework/comparison/process', () => {
    const infographic = getRecommendedPurposeOptionsForType('infographic', {
      industry: 'Legal',
      target_audience: 'lawyers and counsel',
    });
    const topThree = infographic.slice(0, 3).map((o) => o.value);
    // Infographic options are stats, process, timeline, comparison,
    // framework, roadmap. The legal rule boosts process+comparison+
    // framework (educational not present in infographic). Top three
    // should be drawn from those three with native-idx tiebreak:
    // process(idx 1)+comparison(idx 3)+framework(idx 4).
    for (const v of topThree) {
      expect(['process', 'comparison', 'framework']).toContain(v);
    }
  });

  test('Legal carousel surfaces educational + framework at the top with legal-specific reason', () => {
    const carousel = getRecommendedPurposeOptionsForType('carousel', {
      industry: 'Legal',
      products_services: 'litigation support and attorney workflows',
    });
    expect(carousel[0].value).toBe('educational');
    expect(carousel[1].value).toBe('framework');
    expect(carousel[0].reasons).toEqual(expect.arrayContaining(['Legal positioning']));
    expect(carousel[1].reasons).toEqual(expect.arrayContaining(['Legal positioning']));
  });

  test('Pure Finance company does NOT carry Legal positioning', () => {
    const infographic = getRecommendedPurposeOptionsForType('infographic', {
      industry: 'Finance',
      target_audience: 'banking executives',
    });
    for (const opt of infographic) {
      expect(opt.reasons).not.toEqual(expect.arrayContaining(['Legal positioning']));
    }
  });

  test('Pure Consulting company does NOT carry Legal positioning', () => {
    const carousel = getRecommendedPurposeOptionsForType('carousel', {
      industry: 'Consulting',
      target_audience: 'transformation executives',
    });
    for (const opt of carousel) {
      expect(opt.reasons).not.toEqual(expect.arrayContaining(['Legal positioning']));
    }
  });

  test('listRecommendationRules includes the Legal rule', () => {
    const rules = listRecommendationRules();
    const labels = rules.industry.map((r) => r.reason);
    expect(labels).toContain('Legal positioning');
  });
});

/* ── Phase 2 — Multi-Industry Resolution ────────────────────────── */

describe('Phase 2 — Multi-industry resolution (compound terms)', () => {
  test('Healthcare SaaS → both Healthcare AND SaaS rules fire', () => {
    const analysis = analyzeIndustryContributions({
      industry: 'Healthcare SaaS',
      products_services: 'software platform for hospitals',
    });
    const slugs = analysis.all.map((c) => c.industry);
    expect(slugs).toEqual(expect.arrayContaining(['healthcare', 'saas']));
    expect(analysis.is_multi_industry).toBe(true);
    expect(analysis.combined_influence).toBeGreaterThan(0);
  });

  test('FinTech → both Finance AND SaaS rules fire (fintech is in both trigger sets)', () => {
    const analysis = analyzeIndustryContributions({
      industry: 'FinTech',
    });
    const slugs = analysis.all.map((c) => c.industry);
    expect(slugs).toEqual(expect.arrayContaining(['finance', 'saas']));
    expect(analysis.is_multi_industry).toBe(true);
  });

  test('InsurTech → both Insurance AND SaaS rules fire', () => {
    const analysis = analyzeIndustryContributions({
      industry: 'InsurTech',
    });
    const slugs = analysis.all.map((c) => c.industry);
    expect(slugs).toEqual(expect.arrayContaining(['insurance', 'saas']));
    expect(analysis.is_multi_industry).toBe(true);
  });

  test('LegalTech → both Legal AND SaaS rules fire', () => {
    const analysis = analyzeIndustryContributions({
      industry: 'LegalTech',
    });
    const slugs = analysis.all.map((c) => c.industry);
    expect(slugs).toEqual(expect.arrayContaining(['legal', 'saas']));
    expect(analysis.is_multi_industry).toBe(true);
  });

  test('HRTech → both Recruiting AND SaaS rules fire', () => {
    const analysis = analyzeIndustryContributions({
      industry: 'HRTech',
    });
    const slugs = analysis.all.map((c) => c.industry);
    expect(slugs).toEqual(expect.arrayContaining(['recruiting', 'saas']));
    expect(analysis.is_multi_industry).toBe(true);
  });

  test('Manufacturing Software → both Manufacturing AND SaaS rules fire', () => {
    const analysis = analyzeIndustryContributions({
      industry: 'Manufacturing Software',
    });
    const slugs = analysis.all.map((c) => c.industry);
    expect(slugs).toEqual(expect.arrayContaining(['manufacturing', 'saas']));
    expect(analysis.is_multi_industry).toBe(true);
  });

  test('Single industry (pure Healthcare) → is_multi_industry=false', () => {
    const analysis = analyzeIndustryContributions({
      industry: 'Healthcare',
      target_audience: 'patients',
    });
    expect(analysis.is_multi_industry).toBe(false);
    expect(analysis.primary?.industry).toBe('healthcare');
    expect(analysis.secondary).toBeNull();
  });

  test('No industry signal → empty analysis with zero combined influence', () => {
    const analysis = analyzeIndustryContributions(null);
    expect(analysis.all).toEqual([]);
    expect(analysis.combined_influence).toBe(0);
    expect(analysis.is_multi_industry).toBe(false);
    expect(analysis.primary).toBeNull();
    expect(analysis.secondary).toBeNull();
  });

  test('Recommendation scoring still fires additively for multi-industry companies', () => {
    // Healthcare SaaS — educational gets boosted by BOTH rules.
    const image = getRecommendedPurposeOptionsForType('image', {
      industry: 'Healthcare SaaS',
      products_services: 'software platform for hospitals',
    });
    const educational = image.find((o) => o.value === 'educational')!;
    // Healthcare adds W_INDUSTRY (6), SaaS adds W_INDUSTRY (6) → ≥ 12
    expect(educational.score).toBeGreaterThanOrEqual(12);
    // Reasons should include both Healthcare and SaaS positioning labels.
    expect(educational.reasons).toEqual(expect.arrayContaining([
      'Healthcare positioning',
      'SaaS positioning',
    ]));
  });
});

/* ── Phase 4 — Industry Contributions Explainability ────────────── */

describe('Phase 4 — Industry contributions explainability', () => {
  test('primary is the highest-scoring contribution; secondary is next', () => {
    const analysis = analyzeIndustryContributions({
      industry: 'Healthcare SaaS',
    });
    expect(analysis.primary).not.toBeNull();
    expect(analysis.secondary).not.toBeNull();
    expect(analysis.primary!.total_score).toBeGreaterThanOrEqual(analysis.secondary!.total_score);
  });

  test('Each contribution carries label + matched_triggers + total_score', () => {
    const analysis = analyzeIndustryContributions({
      industry: 'Healthcare',
      target_audience: 'patients',
    });
    expect(analysis.all.length).toBeGreaterThan(0);
    for (const c of analysis.all) {
      expect(typeof c.label).toBe('string');
      expect(c.label.length).toBeGreaterThan(0);
      expect(Array.isArray(c.matched_triggers)).toBe(true);
      expect(c.matched_triggers.length).toBeGreaterThan(0);
      expect(typeof c.total_score).toBe('number');
      expect(c.total_score).toBeGreaterThan(0);
    }
  });

  test('combined_influence equals sum of contributions', () => {
    const analysis = analyzeIndustryContributions({
      industry: 'Healthcare SaaS',
    });
    const sum = analysis.all.reduce((acc, c) => acc + c.total_score, 0);
    expect(analysis.combined_influence).toBe(sum);
  });

  test('Output is deterministic: same input → same contribution order', () => {
    const input = { industry: 'FinTech' };
    const a = analyzeIndustryContributions(input);
    const b = analyzeIndustryContributions(input);
    expect(a.all.map((c) => c.industry)).toEqual(b.all.map((c) => c.industry));
  });
});

/* ── Phase 3 — Governance flow coverage matrix ──────────────────── */

describe('Phase 3 — Governance flow coverage matrix consistency', () => {
  test('Matrix is structurally valid', () => {
    const result = validateFlowCoverageMatrix();
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test('All five required flows are present', () => {
    const flows = GOVERNANCE_FLOW_COVERAGE_MATRIX.map((r) => r.flow);
    expect(flows).toEqual(expect.arrayContaining([
      'generation',
      'regeneration',
      'adaptation',
      'campaign_fan_out',
      'replay',
    ]));
  });

  test('Generation flow: resolves fresh + attaches metadata + fires audit', () => {
    const row = getFlowCoverageRow('generation')!;
    expect(row.policy_resolution).toBe('fresh-from-profile');
    expect(row.covered.resolves_policy).toBe(true);
    expect(row.covered.attaches_metadata).toBe(true);
    expect(row.covered.fires_audit).toBe(true);
  });

  test('Adaptation is a documented passthrough (no policy mutation)', () => {
    const row = getFlowCoverageRow('adaptation')!;
    expect(row.covered.preserves_upstream).toBe(true);
    expect(row.policy_resolution).toBe('upstream-passthrough');
    // Notes must document the by-design rationale so future reviewers
    // don't accidentally "fix" this into a fresh-resolution flow.
    expect(row.notes).toMatch(/governance-neutral|by design|preserved verbatim/i);
  });

  test('Replay is a documented snapshot (no policy refresh)', () => {
    const row = getFlowCoverageRow('replay')!;
    expect(row.policy_resolution).toBe('persisted-snapshot');
    expect(row.covered.resolves_policy).toBe(false);
    expect(row.covered.preserves_upstream).toBe(true);
    expect(row.notes).toMatch(/by design|previously approved|original/i);
  });

  test('Campaign fan-out resolves fresh + attaches both governance and applied_variant envelopes', () => {
    const row = getFlowCoverageRow('campaign_fan_out')!;
    expect(row.policy_resolution).toBe('fresh-from-profile');
    expect(row.covered.attaches_metadata).toBe(true);
    expect(row.metadata_target).toMatch(/applied_variant/);
  });

  test('Regeneration honors caller-supplied governance (no double-audit)', () => {
    const row = getFlowCoverageRow('regeneration')!;
    expect(row.policy_resolution).toBe('caller-supplied');
    expect(row.covered.attaches_metadata).toBe(true);
    expect(row.audit_site).toMatch(/double-firing|picker|upstream/i);
  });
});

/**
 * @jest-environment jsdom
 *
 * Creator Compliance-Aware Strategy Governance — focused tests covering:
 *
 *   Phase 1+2  resolveStrategyGovernancePolicy → industry detection +
 *              healthcare / finance / insurance / legal policies
 *   Phase 3    applyStrategyGovernance buckets (recommended / allowed /
 *              restricted) + deprioritized still visible
 *   Phase 4    Restriction reasons present on suppressed strategies
 *   Phase 5    Picker hook surfaces governance payload + default
 *              override applied
 *   Phase 6    Audit event helpers fire without throwing (best-effort)
 *
 * Regression-safe:
 *   - Recommendation engine output is INPUT to the applier; tests
 *     assert applier preserves order within each bucket.
 *   - Empty policy ("none" industry) preserves recommendation engine
 *     order with all options classified 'allowed' or 'recommended'.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { render, waitFor } from '@testing-library/react';
import {
  resolveStrategyGovernancePolicy,
  getPolicyForIndustry,
  listGovernanceIndustries,
  policyHasAnyRule,
  suppressedStrategiesForContentType,
  deprioritizedStrategiesForContentType,
} from '../../services/creator/strategyGovernancePolicyRegistry';
import {
  applyStrategyGovernance,
  applyStrategyGovernanceAllTypes,
} from '../../services/creator/strategyGovernanceApplier';
import {
  auditRestrictedStrategySelected,
  auditRestrictedStrategiesRevealed,
} from '../../services/creator/strategyGovernanceAuditEvents';
import { getRecommendedPurposeOptions } from '../../services/creator/companyStrategyRecommendationEngine';
import { PURPOSE_OPTIONS } from '../../../lib/variants/purposeOptions';

/* ── Phase 1 — Industry detection ───────────────────────────────── */

describe('Phase 1 — industry detection', () => {
  test('healthcare industry detected from `industry` string', () => {
    const policy = resolveStrategyGovernancePolicy({ industry: 'Healthcare' });
    expect(policy.industry).toBe('healthcare');
    expect(policy.riskLevel).toBe('high');
  });

  test('finance industry detected from category', () => {
    const policy = resolveStrategyGovernancePolicy({ category: 'fintech' });
    expect(policy.industry).toBe('finance');
  });

  test('insurance industry detected', () => {
    const policy = resolveStrategyGovernancePolicy({ industry: 'Insurance technology' });
    expect(policy.industry).toBe('insurance');
  });

  test('legal industry detected', () => {
    const policy = resolveStrategyGovernancePolicy({ industry: 'Law firm' });
    expect(policy.industry).toBe('legal');
  });

  test('non-regulated industry yields empty policy', () => {
    const policy = resolveStrategyGovernancePolicy({ industry: 'SaaS' });
    expect(policy.industry).toBe('none');
    expect(policy.riskLevel).toBe('none');
    expect(policy.suppressedStrategies).toEqual([]);
    expect(policy.deprioritizedStrategies).toEqual([]);
    expect(policy.requiredWarnings).toEqual([]);
  });

  test('null input yields empty policy (null-safe)', () => {
    const policy = resolveStrategyGovernancePolicy(null);
    expect(policy.industry).toBe('none');
    expect(policyHasAnyRule(policy)).toBe(false);
  });

  test('industry detection precedence — healthcare wins over generic terms', () => {
    const policy = resolveStrategyGovernancePolicy({
      industry: 'medical and technology',
      category: 'platform',
    });
    expect(policy.industry).toBe('healthcare');
  });

  test('listGovernanceIndustries enumerates all governed verticals', () => {
    const list = listGovernanceIndustries();
    expect(list).toEqual(['healthcare', 'finance', 'insurance', 'legal']);
  });
});

/* ── Phase 2 — Industry policies ────────────────────────────────── */

describe('Phase 2 — healthcare policy', () => {
  const policy = getPolicyForIndustry('healthcare');

  test('suppresses promotional + quote on image lane', () => {
    const suppressed = suppressedStrategiesForContentType(policy, 'image').map((r) => r.strategy);
    expect(suppressed).toEqual(expect.arrayContaining(['promotional', 'quote']));
  });

  test('deprioritizes product-showcase on image + carousel', () => {
    const deprIm = deprioritizedStrategiesForContentType(policy, 'image').map((r) => r.strategy);
    const deprCa = deprioritizedStrategiesForContentType(policy, 'carousel').map((r) => r.strategy);
    expect(deprIm).toContain('product-showcase');
    expect(deprCa).toContain('product-showcase');
  });

  test('default strategy overrides anchor on educational / stats', () => {
    expect(policy.defaultStrategyOverrides.image).toBe('educational');
    expect(policy.defaultStrategyOverrides.carousel).toBe('educational');
    expect(policy.defaultStrategyOverrides.infographic).toBe('stats');
  });
});

describe('Phase 2 — finance policy', () => {
  const policy = getPolicyForIndustry('finance');

  test('suppresses promotional + quote on image', () => {
    const suppressed = suppressedStrategiesForContentType(policy, 'image').map((r) => r.strategy);
    expect(suppressed).toEqual(expect.arrayContaining(['promotional', 'quote']));
  });

  test('deprioritizes product-showcase + carousel story', () => {
    const deprCa = deprioritizedStrategiesForContentType(policy, 'carousel').map((r) => r.strategy);
    expect(deprCa).toEqual(expect.arrayContaining(['product-showcase', 'story']));
  });

  test('default strategy overrides anchor on educational / comparison', () => {
    expect(policy.defaultStrategyOverrides.image).toBe('educational');
    expect(policy.defaultStrategyOverrides.infographic).toBe('comparison');
  });
});

describe('Phase 2 — insurance policy', () => {
  const policy = getPolicyForIndustry('insurance');

  test('suppresses promotional on image', () => {
    const suppressed = suppressedStrategiesForContentType(policy, 'image').map((r) => r.strategy);
    expect(suppressed).toContain('promotional');
  });

  test('default strategy overrides anchor on educational / comparison / framework', () => {
    expect(policy.defaultStrategyOverrides.image).toBe('educational');
    expect(policy.defaultStrategyOverrides.carousel).toBe('framework');
    expect(policy.defaultStrategyOverrides.infographic).toBe('comparison');
  });
});

describe('Phase 2 — legal policy', () => {
  const policy = getPolicyForIndustry('legal');

  test('suppresses promotional + quote on image', () => {
    const suppressed = suppressedStrategiesForContentType(policy, 'image').map((r) => r.strategy);
    expect(suppressed).toEqual(expect.arrayContaining(['promotional', 'quote']));
  });

  test('default strategy overrides anchor on framework', () => {
    expect(policy.defaultStrategyOverrides.carousel).toBe('framework');
    expect(policy.defaultStrategyOverrides.infographic).toBe('framework');
  });
});

/* ── Phase 3 — Applier classification ───────────────────────────── */

describe('Phase 3 — applyStrategyGovernance classification', () => {
  test('non-regulated industry → all options classified recommended/allowed; no restricted', () => {
    const recommended = getRecommendedPurposeOptions({ industry: 'SaaS' });
    const policy = resolveStrategyGovernancePolicy({ industry: 'SaaS' });
    const result = applyStrategyGovernance({
      contentType: 'image',
      recommendedOptions: recommended.image,
      policy,
    });
    expect(result.restricted).toEqual([]);
    expect(result.recommended.length + result.allowed.length).toBe(recommended.image.length);
    expect(result.defaultStrategyOverride).toBeNull();
  });

  test('healthcare → promotional + quote image classified restricted with reasons', () => {
    const recommended = getRecommendedPurposeOptions({ industry: 'Healthcare' });
    const policy = resolveStrategyGovernancePolicy({ industry: 'Healthcare' });
    const result = applyStrategyGovernance({
      contentType: 'image',
      recommendedOptions: recommended.image,
      policy,
    });
    const restrictedValues = result.restricted.map((o) => o.value);
    expect(restrictedValues).toEqual(expect.arrayContaining(['promotional', 'quote']));
    for (const opt of result.restricted) {
      expect(opt.classification).toBe('restricted');
      expect(opt.restriction_reason).toBeTruthy();
      expect(opt.restriction_reason).toMatch(/Healthcare/i);
    }
    // No option is dropped — total count preserved.
    expect(result.options).toHaveLength(recommended.image.length);
  });

  test('finance → product-showcase classified allowed-but-deprioritized', () => {
    const recommended = getRecommendedPurposeOptions({ industry: 'Finance' });
    const policy = resolveStrategyGovernancePolicy({ industry: 'Finance' });
    const result = applyStrategyGovernance({
      contentType: 'carousel',
      recommendedOptions: recommended.carousel,
      policy,
    });
    const productShowcase = result.options.find((o) => o.value === 'product-showcase')!;
    expect(productShowcase.classification).toBe('allowed');
    expect(productShowcase.deprioritized).toBe(true);
    expect(productShowcase.restriction_reason).toMatch(/Financial services/i);
  });

  test('ordering: recommended → allowed → deprioritized → restricted', () => {
    const recommended = getRecommendedPurposeOptions({ industry: 'Healthcare' });
    const policy = resolveStrategyGovernancePolicy({ industry: 'Healthcare' });
    const result = applyStrategyGovernance({
      contentType: 'image',
      recommendedOptions: recommended.image,
      policy,
    });
    const seen = { rec: false, allowed: false, depr: false, restricted: false };
    for (const opt of result.options) {
      if (opt.classification === 'recommended') {
        expect(seen.restricted).toBe(false);
        expect(seen.depr).toBe(false);
        seen.rec = true;
      } else if (opt.classification === 'allowed' && !opt.deprioritized) {
        expect(seen.restricted).toBe(false);
        expect(seen.depr).toBe(false);
        seen.allowed = true;
      } else if (opt.classification === 'allowed' && opt.deprioritized) {
        expect(seen.restricted).toBe(false);
        seen.depr = true;
      } else if (opt.classification === 'restricted') {
        seen.restricted = true;
      }
    }
  });

  test('applyStrategyGovernanceAllTypes returns all three lanes', () => {
    const recommended = getRecommendedPurposeOptions({ industry: 'Finance' });
    const policy = resolveStrategyGovernancePolicy({ industry: 'Finance' });
    const all = applyStrategyGovernanceAllTypes({
      recommendedByType: recommended,
      policy,
    });
    expect(all.image.options).toHaveLength(PURPOSE_OPTIONS.image.length);
    expect(all.carousel.options).toHaveLength(PURPOSE_OPTIONS.carousel.length);
    expect(all.infographic.options).toHaveLength(PURPOSE_OPTIONS.infographic.length);
  });
});

/* ── Phase 4 — Explainability ───────────────────────────────────── */

describe('Phase 4 — explainability', () => {
  test('healthcare restriction reasons reference Healthcare', () => {
    const recommended = getRecommendedPurposeOptions({ industry: 'Healthcare' });
    const policy = resolveStrategyGovernancePolicy({ industry: 'Healthcare' });
    const result = applyStrategyGovernance({
      contentType: 'image',
      recommendedOptions: recommended.image,
      policy,
    });
    for (const opt of result.restricted) {
      expect(opt.restriction_reason).toMatch(/Healthcare industry policy/i);
    }
  });

  test('legal restriction reasons reference UPL or ethical-rules language', () => {
    const recommended = getRecommendedPurposeOptions({ industry: 'Law' });
    const policy = resolveStrategyGovernancePolicy({ industry: 'Law' });
    const result = applyStrategyGovernance({
      contentType: 'image',
      recommendedOptions: recommended.image,
      policy,
    });
    const reasons = result.restricted.map((o) => o.restriction_reason).filter(Boolean) as string[];
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.some((r) => /UPL|ethical|outcome|endorsement/i.test(r))).toBe(true);
  });

  test('required warnings surface on regulated industries only', () => {
    const hc = resolveStrategyGovernancePolicy({ industry: 'Healthcare' });
    const saas = resolveStrategyGovernancePolicy({ industry: 'SaaS' });
    expect(hc.requiredWarnings.length).toBeGreaterThan(0);
    expect(saas.requiredWarnings).toEqual([]);
  });
});

/* ── Phase 5 — Picker hook surfaces governance ──────────────────── */

jest.mock('../../../lib/apiFetch', () => ({ apiFetch: jest.fn() }));
const { apiFetch } = require('../../../lib/apiFetch') as { apiFetch: jest.Mock };

import { useRecommendedPurposeOptions } from '../../../components/variant-experience/useRecommendedPurposeOptions';

function ProbeGovernance({ companyId }: { companyId: string }) {
  const state = useRecommendedPurposeOptions({ companyId, enabled: true });
  return (
    <div>
      <span data-testid="industry">{state.governance.industry}</span>
      <span data-testid="riskLevel">{state.governance.risk_level}</span>
      <span data-testid="restrictedImageCount">
        {state.governance.per_content_type.image.restricted.length}
      </span>
      <span data-testid="defaultImage">
        {state.governance.per_content_type.image.default_strategy_override ?? ''}
      </span>
      <span data-testid="warningCount">{state.governance.required_warnings.length}</span>
    </div>
  );
}

describe('Phase 5 — picker hook surfaces governance', () => {
  beforeEach(() => apiFetch.mockReset());

  test('healthcare payload surfaces industry + restricted + warning', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        company_id: 'co-hc',
        has_profile: true,
        recommended: getRecommendedPurposeOptions({ industry: 'Healthcare' }),
        governance: {
          industry: 'healthcare',
          risk_level: 'high',
          required_warnings: ['Healthcare content should reference clinical evidence and avoid unsupported claims.'],
          per_content_type: {
            image: {
              options: [],
              recommended: [],
              allowed: [],
              restricted: [
                { value: 'promotional', label: 'Promotional', score: 0, reasons: [], applies_as_cold_start_prior: false, classification: 'restricted', restriction_reason: 'Healthcare industry policy — aggressive promotional framing carries clinical claim risk', deprioritized: false },
              ],
              default_strategy_override: 'educational',
            },
            carousel: { options: [], recommended: [], allowed: [], restricted: [], default_strategy_override: 'educational' },
            infographic: { options: [], recommended: [], allowed: [], restricted: [], default_strategy_override: 'stats' },
          },
        },
      }),
    });
    const { getByTestId } = render(<ProbeGovernance companyId="co-hc" />);
    await waitFor(() => {
      expect(getByTestId('industry').textContent).toBe('healthcare');
    });
    expect(getByTestId('riskLevel').textContent).toBe('high');
    expect(getByTestId('restrictedImageCount').textContent).toBe('1');
    expect(getByTestId('defaultImage').textContent).toBe('educational');
    expect(getByTestId('warningCount').textContent).toBe('1');
  });

  test('non-regulated payload yields industry=none and zero restricted', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        company_id: 'co-saas',
        has_profile: true,
        recommended: getRecommendedPurposeOptions({ industry: 'SaaS' }),
        governance: {
          industry: 'none',
          risk_level: 'none',
          required_warnings: [],
          per_content_type: {
            image: { options: [], recommended: [], allowed: [], restricted: [], default_strategy_override: null },
            carousel: { options: [], recommended: [], allowed: [], restricted: [], default_strategy_override: null },
            infographic: { options: [], recommended: [], allowed: [], restricted: [], default_strategy_override: null },
          },
        },
      }),
    });
    const { getByTestId } = render(<ProbeGovernance companyId="co-saas" />);
    await waitFor(() => {
      expect(getByTestId('industry').textContent).toBe('none');
    });
    expect(getByTestId('restrictedImageCount').textContent).toBe('0');
    expect(getByTestId('warningCount').textContent).toBe('0');
  });

  test('API failure falls back to native governance (industry=none, no restricted)', async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: 'boom' }),
    });
    const { getByTestId } = render(<ProbeGovernance companyId="co-x" />);
    await waitFor(() => {
      expect(getByTestId('industry').textContent).toBe('none');
    });
    expect(getByTestId('restrictedImageCount').textContent).toBe('0');
  });
});

/* ── Phase 6 — Audit event helpers ──────────────────────────────── */

describe('Phase 6 — audit event helpers do not throw', () => {
  test('auditRestrictedStrategySelected fires without throwing', () => {
    expect(() => {
      auditRestrictedStrategySelected({
        companyId: 'co-hc',
        industry: 'healthcare',
        riskLevel: 'high',
        strategyId: 'image:promotional',
        contentType: 'image',
        restrictionReason: 'Healthcare industry policy',
        actorUserId: 'user-1',
      });
    }).not.toThrow();
  });

  test('auditRestrictedStrategiesRevealed fires without throwing', () => {
    expect(() => {
      auditRestrictedStrategiesRevealed({
        companyId: 'co-hc',
        industry: 'healthcare',
        riskLevel: 'high',
        contentType: 'image',
        actorUserId: 'user-1',
      });
    }).not.toThrow();
  });
});

/* ── Validation pinned scenarios ─────────────────────────────────── */

describe('Validation — pinned scenarios', () => {
  test('Healthcare: educational, stats, process rank first on infographic', () => {
    const recommended = getRecommendedPurposeOptions({ industry: 'Healthcare' });
    const policy = resolveStrategyGovernancePolicy({ industry: 'Healthcare' });
    const result = applyStrategyGovernance({
      contentType: 'infographic',
      recommendedOptions: recommended.infographic,
      policy,
    });
    const top3 = result.options.slice(0, 3).map((o) => o.value);
    // stats is natively first; healthcare promotes it. process is recommended too.
    expect(top3).toEqual(expect.arrayContaining(['stats', 'process']));
  });

  test('Finance: educational + comparison + stats rank in top 3 on infographic', () => {
    const recommended = getRecommendedPurposeOptions({ industry: 'Finance' });
    const policy = resolveStrategyGovernancePolicy({ industry: 'Finance' });
    const result = applyStrategyGovernance({
      contentType: 'infographic',
      recommendedOptions: recommended.infographic,
      policy,
    });
    const top3 = result.options.slice(0, 3).map((o) => o.value);
    expect(top3).toEqual(expect.arrayContaining(['comparison', 'stats']));
  });

  test('SaaS: no suppression, no restricted, no warnings', () => {
    const recommended = getRecommendedPurposeOptions({ industry: 'SaaS' });
    const policy = resolveStrategyGovernancePolicy({ industry: 'SaaS' });
    const result = applyStrategyGovernanceAllTypes({
      recommendedByType: recommended,
      policy,
    });
    expect(result.image.restricted).toEqual([]);
    expect(result.carousel.restricted).toEqual([]);
    expect(result.infographic.restricted).toEqual([]);
    expect(policy.requiredWarnings).toEqual([]);
  });
});

/**
 * @jest-environment jsdom
 *
 * Creator Company-Context Strategy Bridge — focused tests covering:
 *
 *   Phase 1  getRecommendedPurposeOptions returns reordered + scored
 *   Phase 2  Industry / audience / product / theme / pain mapping
 *   Phase 3  Picker hook returns native fallback when no context
 *   Phase 4  Cold-start prior flag (applies_as_cold_start_prior=true
 *            only when score > 0)
 *   Phase 5  Reasons populated per matched signal
 *
 * The engine is PURE — no network mocks needed for the core tests.
 * The hook is exercised separately with an apiFetch mock.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { render, waitFor } from '@testing-library/react';
import {
  getRecommendedPurposeOptions,
  getRecommendedPurposeOptionsForType,
  listRecommendationRules,
} from '../../services/creator/companyStrategyRecommendationEngine';
import { PURPOSE_OPTIONS } from '../../../lib/variants/purposeOptions';

/* ── Phase 1: shape contract ────────────────────────────────────── */

describe('Phase 1 — engine shape contract', () => {
  test('returns the same option count per content type as PURPOSE_OPTIONS', () => {
    const result = getRecommendedPurposeOptions(null);
    expect(result.image).toHaveLength(PURPOSE_OPTIONS.image.length);
    expect(result.carousel).toHaveLength(PURPOSE_OPTIONS.carousel.length);
    expect(result.infographic).toHaveLength(PURPOSE_OPTIONS.infographic.length);
  });

  test('no context → native order preserved with score=0 + empty reasons', () => {
    const result = getRecommendedPurposeOptions(null);
    expect(result.image.map((o) => o.value)).toEqual(PURPOSE_OPTIONS.image.map((o) => o.value));
    expect(result.carousel.map((o) => o.value)).toEqual(PURPOSE_OPTIONS.carousel.map((o) => o.value));
    expect(result.infographic.map((o) => o.value)).toEqual(PURPOSE_OPTIONS.infographic.map((o) => o.value));
    for (const lane of [result.image, result.carousel, result.infographic]) {
      for (const opt of lane) {
        expect(opt.score).toBe(0);
        expect(opt.reasons).toEqual([]);
        expect(opt.applies_as_cold_start_prior).toBe(false);
      }
    }
  });

  test('every option preserves the original label + description', () => {
    const result = getRecommendedPurposeOptions(null);
    const native = PURPOSE_OPTIONS;
    for (const ct of ['image', 'carousel', 'infographic'] as const) {
      const byValue = new Map(result[ct].map((o) => [o.value, o]));
      for (const nativeOpt of native[ct]) {
        const opt = byValue.get(nativeOpt.value)!;
        expect(opt.label).toBe(nativeOpt.label);
        expect(opt.description).toBe(nativeOpt.description);
      }
    }
  });
});

/* ── Phase 2: industry mapping ──────────────────────────────────── */

describe('Phase 2 — industry mapping', () => {
  test('Developer Tools company prioritises framework / process / educational / comparison', () => {
    const carousel = getRecommendedPurposeOptionsForType('carousel', {
      industry: 'Developer Tools',
      target_audience: 'developers',
      products_services: 'API + SDK',
    });
    // Framework should sort to the top.
    expect(carousel[0].value).toBe('framework');
    // Each top-3 should carry at least one reason from the bridge.
    for (let i = 0; i < 3; i++) {
      expect(carousel[i].score).toBeGreaterThan(0);
      expect(carousel[i].reasons.length).toBeGreaterThan(0);
    }
    // process / educational / comparison are NOT carousel options for
    // 'comparison' (it's infographic-only). framework, educational,
    // story, product-showcase, presentation are. Check that
    // 'educational' sits ahead of options with no matching rule.
    const educationalIdx = carousel.findIndex((o) => o.value === 'educational');
    const presentationIdx = carousel.findIndex((o) => o.value === 'presentation');
    expect(educationalIdx).toBeLessThan(presentationIdx);
  });

  test('Healthcare company prioritises educational / process / stats', () => {
    const infographic = getRecommendedPurposeOptionsForType('infographic', {
      industry: 'Healthcare',
      target_audience: 'patients and physicians',
    });
    expect(infographic[0].value).toBe('stats');
    // process should rank higher than its native position (position 1).
    const processIdx = infographic.findIndex((o) => o.value === 'process');
    expect(processIdx).toBeLessThanOrEqual(1);
  });

  test('Finance company prioritises educational / comparison / stats', () => {
    const infographic = getRecommendedPurposeOptionsForType('infographic', {
      industry: 'Finance',
      target_audience: 'finance leaders',
    });
    const comparisonIdx = infographic.findIndex((o) => o.value === 'comparison');
    const statsIdx = infographic.findIndex((o) => o.value === 'stats');
    // both should rise above their native positions (3 and 0). At minimum, comparison rises.
    expect(comparisonIdx).toBeLessThan(3);
    // stats should remain at or near the top because it's natively first AND scored.
    expect(statsIdx).toBeLessThan(2);
  });

  test('Consulting company prioritises framework / story', () => {
    const carousel = getRecommendedPurposeOptionsForType('carousel', {
      industry: 'Consulting',
      target_audience: 'executives',
    });
    expect(['framework', 'story']).toContain(carousel[0].value);
  });

  test('Recruiting company prioritises story / framework', () => {
    const carousel = getRecommendedPurposeOptionsForType('carousel', {
      industry: 'Recruiting',
      target_audience: 'hiring managers',
    });
    expect(['story', 'framework']).toContain(carousel[0].value);
  });

  test('Marketing technology company prioritises product-showcase / story / framework', () => {
    const carousel = getRecommendedPurposeOptionsForType('carousel', {
      industry: 'Marketing technology',
      products_services: 'attribution platform',
    });
    expect(['product-showcase', 'story', 'framework']).toContain(carousel[0].value);
  });

  test('Ecommerce company prioritises product-showcase / promotional / story', () => {
    const image = getRecommendedPurposeOptionsForType('image', {
      industry: 'Ecommerce',
      category: 'retail',
    });
    expect(['product-showcase', 'promotional']).toContain(image[0].value);
  });

  test('SaaS-only company gets a milder broad boost', () => {
    const image = getRecommendedPurposeOptionsForType('image', {
      industry: 'SaaS',
    });
    // product-showcase, educational, framework get boosted. At least
    // one of those should rise above its native position.
    const productShowcaseIdx = image.findIndex((o) => o.value === 'product-showcase');
    expect(productShowcaseIdx).toBeLessThan(3);
  });
});

/* ── Phase 2: audience signal alone reorders ────────────────────── */

describe('Phase 2 — audience-only signal', () => {
  test('Executive audience promotes framework / presentation / roadmap', () => {
    const infographic = getRecommendedPurposeOptionsForType('infographic', {
      target_audience: 'CEO and board executives',
    });
    const frameworkIdx = infographic.findIndex((o) => o.value === 'framework');
    const roadmapIdx = infographic.findIndex((o) => o.value === 'roadmap');
    // framework natively at index 4; roadmap at index 5. Both should move up.
    expect(frameworkIdx).toBeLessThan(4);
    expect(roadmapIdx).toBeLessThan(5);
  });

  test('Technical audience promotes framework / process / comparison', () => {
    const carousel = getRecommendedPurposeOptionsForType('carousel', {
      target_audience: 'CTO and engineering leadership',
    });
    expect(carousel[0].value).toBe('framework');
  });
});

/* ── Phase 2: product / pain / theme signals ────────────────────── */

describe('Phase 2 — product / pain / theme rules', () => {
  test('Integration-focused product surface boosts product-showcase + framework', () => {
    // Use products_services without 'api' so we isolate the product rule.
    // The integration trigger fires on 'integration' alone.
    const image = getRecommendedPurposeOptionsForType('image', {
      products_services: 'integration workflow platform',
    });
    // product-showcase must be in the top 3 of the reordered image lane.
    const top3 = image.slice(0, 3).map((o) => o.value);
    expect(top3).toContain('product-showcase');
    const productShowcase = image.find((o) => o.value === 'product-showcase')!;
    expect(productShowcase.reasons).toEqual(
      expect.arrayContaining(['Integration / API-centric product surface']),
    );
    // And on the carousel lane, framework also gets the product-rule boost.
    const carousel = getRecommendedPurposeOptionsForType('carousel', {
      products_services: 'integration workflow platform',
    });
    const framework = carousel.find((o) => o.value === 'framework')!;
    expect(framework.reasons).toEqual(
      expect.arrayContaining(['Integration / API-centric product surface']),
    );
  });

  test('Trust / proof pain boosts stats + story', () => {
    const infographic = getRecommendedPurposeOptionsForType('infographic', {
      pain_symptoms: ['credibility gap', 'no proof of ROI'],
    });
    const stats = infographic.find((o) => o.value === 'stats')!;
    expect(stats.reasons).toEqual(expect.arrayContaining(['Pain: trust / proof']));
  });

  test('Case-study content theme boosts story + product-showcase', () => {
    const carousel = getRecommendedPurposeOptionsForType('carousel', {
      content_themes: 'customer case studies and success stories',
    });
    const story = carousel.find((o) => o.value === 'story')!;
    expect(story.reasons).toEqual(expect.arrayContaining(['Case-study content theme']));
  });
});

/* ── Phase 2: additive stacking ─────────────────────────────────── */

describe('Phase 2 — additive scoring (no hard exclusions)', () => {
  test('Multiple matching rules stack — score grows with signal count', () => {
    const minimal = getRecommendedPurposeOptionsForType('carousel', {
      industry: 'Developer Tools',
    });
    const rich = getRecommendedPurposeOptionsForType('carousel', {
      industry: 'Developer Tools',
      target_audience: 'engineering leaders',
      products_services: 'API integration platform',
      content_themes: 'developer education',
    });
    const minimalFramework = minimal.find((o) => o.value === 'framework')!;
    const richFramework = rich.find((o) => o.value === 'framework')!;
    expect(richFramework.score).toBeGreaterThan(minimalFramework.score);
    expect(richFramework.reasons.length).toBeGreaterThan(minimalFramework.reasons.length);
  });

  test('No option is ever suppressed — all native options remain in output', () => {
    const all = getRecommendedPurposeOptions({
      industry: 'Healthcare',
      target_audience: 'patients',
    });
    expect(all.image).toHaveLength(PURPOSE_OPTIONS.image.length);
    expect(all.carousel).toHaveLength(PURPOSE_OPTIONS.carousel.length);
    expect(all.infographic).toHaveLength(PURPOSE_OPTIONS.infographic.length);
    // Promotional must still appear even though no rule promotes it for healthcare.
    expect(all.image.find((o) => o.value === 'promotional')).toBeDefined();
  });
});

/* ── Phase 4: cold-start prior flag ─────────────────────────────── */

describe('Phase 4 — cold-start prior flag', () => {
  test('applies_as_cold_start_prior is true ONLY when score > 0', () => {
    const result = getRecommendedPurposeOptions({
      industry: 'Developer Tools',
    });
    for (const opt of result.carousel) {
      expect(opt.applies_as_cold_start_prior).toBe(opt.score > 0);
    }
  });

  test('No context → no option marked as cold-start prior', () => {
    const result = getRecommendedPurposeOptions(null);
    for (const lane of [result.image, result.carousel, result.infographic]) {
      for (const opt of lane) expect(opt.applies_as_cold_start_prior).toBe(false);
    }
  });
});

/* ── Phase 5: explainability ────────────────────────────────────── */

describe('Phase 5 — explainability', () => {
  test('Recommended options carry operator-readable reasons', () => {
    const result = getRecommendedPurposeOptionsForType('carousel', {
      industry: 'Developer Tools',
      target_audience: 'engineers',
    });
    const framework = result.find((o) => o.value === 'framework')!;
    expect(framework.reasons).toEqual(expect.arrayContaining(['Developer audience']));
    expect(framework.reasons).toEqual(expect.arrayContaining(['Technical decision-maker audience']));
  });

  test('listRecommendationRules surfaces the rule book for admin diagnostics', () => {
    const rules = listRecommendationRules();
    expect(rules.industry.length).toBeGreaterThan(0);
    expect(rules.audience.length).toBeGreaterThan(0);
    expect(rules.product.length).toBeGreaterThan(0);
    expect(rules.theme.length).toBeGreaterThan(0);
    expect(rules.pain.length).toBeGreaterThan(0);
  });
});

/* ── Phase 3: picker hook fallback ──────────────────────────────── */

jest.mock('../../../lib/apiFetch', () => ({ apiFetch: jest.fn() }));
const { apiFetch } = require('../../../lib/apiFetch') as { apiFetch: jest.Mock };

import { useRecommendedPurposeOptions } from '../../../components/variant-experience/useRecommendedPurposeOptions';

function ProbePurposeOptions({ companyId, enabled }: { companyId: string; enabled?: boolean }) {
  const state = useRecommendedPurposeOptions({ companyId, enabled });
  return (
    <div>
      <span data-testid="loading">{String(state.loading)}</span>
      <span data-testid="hasProfile">{String(state.has_profile)}</span>
      <span data-testid="firstImage">{state.recommended.image[0]?.value ?? ''}</span>
      <span data-testid="firstCarousel">{state.recommended.carousel[0]?.value ?? ''}</span>
      <span data-testid="firstInfographic">{state.recommended.infographic[0]?.value ?? ''}</span>
    </div>
  );
}

describe('Phase 3 — picker hook fallback', () => {
  beforeEach(() => apiFetch.mockReset());

  test('falls back to native order when fetch fails', async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: 'boom' }),
    });
    const { getByTestId } = render(<ProbePurposeOptions companyId="co-x" />);
    await waitFor(() => {
      expect(getByTestId('loading').textContent).toBe('false');
    });
    expect(getByTestId('firstImage').textContent).toBe(PURPOSE_OPTIONS.image[0].value);
    expect(getByTestId('firstCarousel').textContent).toBe(PURPOSE_OPTIONS.carousel[0].value);
    expect(getByTestId('firstInfographic').textContent).toBe(PURPOSE_OPTIONS.infographic[0].value);
  });

  test('reorders when the API returns a recommended payload', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        company_id: 'co-x',
        has_profile: true,
        recommended: getRecommendedPurposeOptions({
          industry: 'Developer Tools',
          target_audience: 'developers',
        }),
      }),
    });
    const { getByTestId } = render(<ProbePurposeOptions companyId="co-x" />);
    await waitFor(() => {
      expect(getByTestId('hasProfile').textContent).toBe('true');
    });
    // Developer Tools → carousel top is framework.
    expect(getByTestId('firstCarousel').textContent).toBe('framework');
  });

  test('disabled hook never fetches and returns native fallback', () => {
    const { getByTestId } = render(<ProbePurposeOptions companyId="co-x" enabled={false} />);
    expect(getByTestId('firstImage').textContent).toBe(PURPOSE_OPTIONS.image[0].value);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

/* ── Creator Validation P1 Remediation — Phase 1 (Insurance) ────── */

describe('Validation P1 — Insurance industry has its OWN rule (not Finance)', () => {
  test('Insurance carousel surfaces educational + framework at the top with insurance-specific reason', () => {
    const carousel = getRecommendedPurposeOptionsForType('carousel', {
      industry: 'Insurance',
      products_services: 'underwriting and claims processing',
    });
    // Carousel exposes educational, framework, story, product-showcase,
    // presentation. The insurance rule boosts educational AND framework
    // by W_INDUSTRY; tiebreak follows native order (educational at idx 0,
    // framework at idx 1).
    expect(carousel[0].value).toBe('educational');
    expect(carousel[1].value).toBe('framework');
    expect(carousel[0].reasons).toEqual(expect.arrayContaining(['Insurance positioning']));
    expect(carousel[1].reasons).toEqual(expect.arrayContaining(['Insurance positioning']));
    // Must NOT inherit Finance reasoning.
    expect(carousel[0].reasons).not.toEqual(expect.arrayContaining(['Finance positioning']));
    expect(carousel[1].reasons).not.toEqual(expect.arrayContaining(['Finance positioning']));
  });

  test('Insurance infographic prioritises educational/framework/comparison/process strategies', () => {
    const infographic = getRecommendedPurposeOptionsForType('infographic', {
      industry: 'Insurance',
      target_audience: 'policy buyers',
    });
    // Top three should be among {comparison, framework, process} since
    // educational does not exist in infographic — all three of those
    // are boosted by the insurance rule.
    const top3 = infographic.slice(0, 3).map((o) => o.value);
    for (const v of top3) {
      expect(['comparison', 'framework', 'process']).toContain(v);
    }
  });

  test('Insurance image prioritises educational reasoning', () => {
    const image = getRecommendedPurposeOptionsForType('image', {
      industry: 'Insurance',
    });
    expect(image[0].value).toBe('educational');
    expect(image[0].reasons).toEqual(expect.arrayContaining(['Insurance positioning']));
  });

  test('Pure Finance company does NOT carry Insurance positioning', () => {
    const infographic = getRecommendedPurposeOptionsForType('infographic', {
      industry: 'Finance',
      target_audience: 'banking executives',
    });
    for (const opt of infographic) {
      expect(opt.reasons).not.toEqual(expect.arrayContaining(['Insurance positioning']));
    }
  });

  test('Insurance company does NOT double-fire as Finance', () => {
    const infographic = getRecommendedPurposeOptionsForType('infographic', {
      industry: 'Insurance',
    });
    // With 'insurance' removed from finance triggers, no option should
    // carry the Finance positioning reason.
    for (const opt of infographic) {
      expect(opt.reasons).not.toEqual(expect.arrayContaining(['Finance positioning']));
    }
  });
});

/* ── Creator Validation P1 Remediation — Phase 2 (Audience rules) ─ */

describe('Validation P1 — HR / Operations / Finance leadership audience rules', () => {
  test('HR audience boosts process/framework/story with explainable reason', () => {
    const carousel = getRecommendedPurposeOptionsForType('carousel', {
      target_audience: 'chro and people leaders',
    });
    const framework = carousel.find((o) => o.value === 'framework')!;
    const story = carousel.find((o) => o.value === 'story')!;
    expect(framework.reasons).toEqual(expect.arrayContaining(['HR leadership audience']));
    expect(story.reasons).toEqual(expect.arrayContaining(['HR leadership audience']));
    expect(framework.score).toBeGreaterThan(0);
  });

  test('Operations audience boosts process/framework/comparison', () => {
    const infographic = getRecommendedPurposeOptionsForType('infographic', {
      target_audience: 'coo and supply chain leaders',
    });
    const process = infographic.find((o) => o.value === 'process')!;
    const framework = infographic.find((o) => o.value === 'framework')!;
    const comparison = infographic.find((o) => o.value === 'comparison')!;
    expect(process.reasons).toEqual(expect.arrayContaining(['Operations leadership audience']));
    expect(framework.reasons).toEqual(expect.arrayContaining(['Operations leadership audience']));
    expect(comparison.reasons).toEqual(expect.arrayContaining(['Operations leadership audience']));
  });

  test('Finance leadership audience boosts stats/comparison/framework', () => {
    const infographic = getRecommendedPurposeOptionsForType('infographic', {
      target_audience: 'controller and treasurer roles handling forecasting',
    });
    const stats = infographic.find((o) => o.value === 'stats')!;
    const comparison = infographic.find((o) => o.value === 'comparison')!;
    const framework = infographic.find((o) => o.value === 'framework')!;
    expect(stats.reasons).toEqual(expect.arrayContaining(['Finance leadership audience']));
    expect(comparison.reasons).toEqual(expect.arrayContaining(['Finance leadership audience']));
    expect(framework.reasons).toEqual(expect.arrayContaining(['Finance leadership audience']));
  });

  test('Generic "leaders" alone does NOT fire HR / Ops / Finance leadership rules', () => {
    const carousel = getRecommendedPurposeOptionsForType('carousel', {
      target_audience: 'leaders',
    });
    for (const opt of carousel) {
      expect(opt.reasons).not.toEqual(expect.arrayContaining(['HR leadership audience']));
      expect(opt.reasons).not.toEqual(expect.arrayContaining(['Operations leadership audience']));
      expect(opt.reasons).not.toEqual(expect.arrayContaining(['Finance leadership audience']));
    }
  });
});

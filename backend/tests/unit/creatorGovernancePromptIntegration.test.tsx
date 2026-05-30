/**
 * @jest-environment jsdom
 *
 * Creator Governance → Prompt Composer Integration — focused tests:
 *
 *   Phase 1  buildGovernancePromptContext shape + normalizer
 *   Phase 2  composer threads the governance layer additively
 *   Phase 3  Healthcare / Finance / Insurance / Legal compliance
 *            directives appear in the composed flat prompt
 *   Phase 4  Restricted-strategy caution line injected
 *   Phase 5  generation_metadata.governance shape exposed
 *   Phase 6  Validation pin: SaaS produces unchanged prompt
 */

import '@testing-library/jest-dom';
import {
  buildGovernancePromptContext,
  buildContextFromPolicy,
  normalizeStrategySlug,
  governanceContextHasAnyDirective,
} from '../../services/creator/strategyGovernancePromptContext';
import {
  getPolicyForIndustry,
  resolveStrategyGovernancePolicy,
} from '../../services/creator/strategyGovernancePolicyRegistry';
import { composeCreatorImagePrompt } from '../../services/creator/creatorPromptComposer';

const BASE_INPUT = {
  title: 'A clear, considered headline',
  body: 'A short body line that anchors the visual.',
  eyebrow: 'image',
  audience: 'operators',
  platform: 'linkedin',
  objective: 'awareness',
  brandKit: { companyName: 'Acme', industry: 'SaaS' },
  brandMode: 'brand-aware' as const,
  contentType: 'image',
};

/* ── Phase 1 — context builder + normalizer ─────────────────────── */

describe('Phase 1 — buildGovernancePromptContext', () => {
  test('non-regulated industry → industry=none with empty directives', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'SaaS' },
      contentType: 'image',
      selectedStrategy: 'promotional',
    });
    expect(ctx.industry).toBe('none');
    expect(ctx.riskLevel).toBe('none');
    expect(ctx.compliancePromptDirectives).toEqual([]);
    expect(ctx.selectedStrategyIsRestricted).toBe(false);
    expect(governanceContextHasAnyDirective(ctx)).toBe(false);
  });

  test('healthcare → carries compliance directives', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    expect(ctx.industry).toBe('healthcare');
    expect(ctx.riskLevel).toBe('high');
    expect(ctx.compliancePromptDirectives.length).toBeGreaterThan(0);
    expect(governanceContextHasAnyDirective(ctx)).toBe(true);
  });

  test('selected strategy = "promotional" (restricted in healthcare image) flags as restricted', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'promotional',
    });
    expect(ctx.selectedStrategyIsRestricted).toBe(true);
    expect(ctx.selectedStrategyGovernanceReason).toMatch(/Healthcare/i);
  });

  test('selected strategy = "product-showcase" (deprioritized in finance) flags as deprioritized', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Finance' },
      contentType: 'image',
      selectedStrategy: 'product-showcase',
    });
    expect(ctx.selectedStrategyIsDeprioritized).toBe(true);
    expect(ctx.selectedStrategyIsRestricted).toBe(false);
    expect(ctx.selectedStrategyGovernanceReason).toMatch(/Financial services/i);
  });

  test('null company context → empty industry', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: null,
      contentType: 'image',
      selectedStrategy: null,
    });
    expect(ctx.industry).toBe('none');
  });
});

describe('Phase 1 — normalizeStrategySlug', () => {
  test('long form image stripped to short form', () => {
    expect(normalizeStrategySlug('promotional-image', 'image')).toBe('promotional');
    expect(normalizeStrategySlug('quote-image', 'image')).toBe('quote');
    expect(normalizeStrategySlug('product-showcase-image', 'image')).toBe('product-showcase');
  });

  test('long form carousel stripped to short form', () => {
    expect(normalizeStrategySlug('story-carousel', 'carousel')).toBe('story');
    expect(normalizeStrategySlug('framework-carousel', 'carousel')).toBe('framework');
  });

  test('infographic short keys pass through unchanged', () => {
    expect(normalizeStrategySlug('stats', 'infographic')).toBe('stats');
    expect(normalizeStrategySlug('comparison', 'infographic')).toBe('comparison');
  });

  test('already short slug returned as-is', () => {
    expect(normalizeStrategySlug('promotional', 'image')).toBe('promotional');
  });

  test('empty / null input returns null', () => {
    expect(normalizeStrategySlug(null, 'image')).toBeNull();
    expect(normalizeStrategySlug(undefined, 'image')).toBeNull();
    expect(normalizeStrategySlug('', 'image')).toBeNull();
  });

  test('long form is correctly recognised when used as picker bridge', () => {
    // Picker sets purpose='promotional'; renderer later sees 'promotional-image'
    // via metadata.subtype. Both should map to the same governance lookup.
    const fromPicker = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'promotional',
    });
    const fromRenderer = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'promotional-image',
    });
    expect(fromPicker.selectedStrategyIsRestricted).toBe(true);
    expect(fromRenderer.selectedStrategyIsRestricted).toBe(true);
    expect(fromPicker.selectedStrategyGovernanceReason)
      .toBe(fromRenderer.selectedStrategyGovernanceReason);
  });
});

/* ── Phase 2+3 — composer threads governance layer ──────────────── */

describe('Phase 2+3 — composer threads governance layer', () => {
  test('healthcare context populates layers.governance with compliance directives', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const composed = composeCreatorImagePrompt({ ...BASE_INPUT, governance: ctx });
    expect(composed.layers.governance.length).toBeGreaterThan(0);
    // Header line names the industry + risk level.
    expect(composed.layers.governance[0]).toMatch(/healthcare/i);
    expect(composed.layers.governance[0]).toMatch(/risk: high/i);
    // Directives mention clinical / treatment / outcome.
    const joined = composed.layers.governance.join(' ');
    expect(joined).toMatch(/clinical claim/i);
    expect(joined).toMatch(/treatment guarantee/i);
    expect(joined).toMatch(/outcome guarantee/i);
  });

  test('finance context injects guaranteed-return / guaranteed-outcome directives', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Finance' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const composed = composeCreatorImagePrompt({ ...BASE_INPUT, governance: ctx });
    const joined = composed.layers.governance.join(' ');
    expect(joined).toMatch(/guaranteed return/i);
    expect(joined).toMatch(/guaranteed outcome/i);
    expect(joined).toMatch(/unsupported financial claim/i);
  });

  test('insurance context injects coverage / suitability directives', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Insurance' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const composed = composeCreatorImagePrompt({ ...BASE_INPUT, governance: ctx });
    const joined = composed.layers.governance.join(' ');
    expect(joined).toMatch(/coverage guarantee/i);
    expect(joined).toMatch(/suitability claim/i);
  });

  test('legal context injects legal-guarantee / client-result directives', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Law' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const composed = composeCreatorImagePrompt({ ...BASE_INPUT, governance: ctx });
    const joined = composed.layers.governance.join(' ');
    expect(joined).toMatch(/legal guarantee/i);
    expect(joined).toMatch(/implied outcome/i);
    expect(joined).toMatch(/client-result/i);
  });

  test('governance directives are present in the composed FLAT prompt', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const composed = composeCreatorImagePrompt({ ...BASE_INPUT, governance: ctx });
    expect(composed.prompt).toMatch(/Compliance directives \(healthcare industry policy/i);
    expect(composed.prompt).toMatch(/clinical claim/i);
  });

  test('non-regulated industry → empty governance layer; flat prompt has no compliance header', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'SaaS' },
      contentType: 'image',
      selectedStrategy: 'promotional',
    });
    const composed = composeCreatorImagePrompt({ ...BASE_INPUT, governance: ctx });
    expect(composed.layers.governance).toEqual([]);
    expect(composed.prompt).not.toMatch(/Compliance directives/i);
  });

  test('missing governance argument is byte-identical to legacy callers', () => {
    const withoutCtx = composeCreatorImagePrompt({ ...BASE_INPUT });
    const withNoneCtx = composeCreatorImagePrompt({
      ...BASE_INPUT,
      governance: buildGovernancePromptContext({
        companyContext: { industry: 'SaaS' },
        contentType: 'image',
        selectedStrategy: 'promotional',
      }),
    });
    // The two flat prompts MUST be identical — governance layer is
    // strict no-op when industry='none'.
    expect(withoutCtx.prompt).toBe(withNoneCtx.prompt);
    expect(withoutCtx.layers.governance).toEqual([]);
    expect(withNoneCtx.layers.governance).toEqual([]);
  });

  test('existing prompt layers are NOT modified (campaign, asset, brand, etc. unchanged)', () => {
    const withoutCtx = composeCreatorImagePrompt({ ...BASE_INPUT });
    const withCtx = composeCreatorImagePrompt({
      ...BASE_INPUT,
      governance: buildGovernancePromptContext({
        companyContext: { industry: 'Healthcare' },
        contentType: 'image',
        selectedStrategy: 'educational',
      }),
    });
    expect(withCtx.layers.campaign).toEqual(withoutCtx.layers.campaign);
    expect(withCtx.layers.asset).toEqual(withoutCtx.layers.asset);
    expect(withCtx.layers.brand).toEqual(withoutCtx.layers.brand);
    expect(withCtx.layers.product).toEqual(withoutCtx.layers.product);
    expect(withCtx.layers.realism).toEqual(withoutCtx.layers.realism);
    expect(withCtx.layers.negative).toEqual(withoutCtx.layers.negative);
    expect(withCtx.layers.quality).toEqual(withoutCtx.layers.quality);
    // Only governance changes.
    expect(withCtx.layers.governance.length).toBeGreaterThan(0);
  });
});

/* ── Phase 4 — restricted-strategy caution line ─────────────────── */

describe('Phase 4 — restricted-strategy caution', () => {
  test('selecting a restricted strategy injects the extra-caution line', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'promotional', // restricted under healthcare image
    });
    const composed = composeCreatorImagePrompt({ ...BASE_INPUT, governance: ctx });
    const joined = composed.layers.governance.join('\n');
    expect(joined).toMatch(/extra caution/i);
    expect(joined).toMatch(/governed by industry policy/i);
    expect(joined).toMatch(/promotional/);
  });

  test('selecting a deprioritized strategy injects the deprioritization caution', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Finance' },
      contentType: 'image',
      selectedStrategy: 'product-showcase',
    });
    const composed = composeCreatorImagePrompt({ ...BASE_INPUT, governance: ctx });
    const joined = composed.layers.governance.join('\n');
    expect(joined).toMatch(/deprioritized by industry policy/i);
  });

  test('selecting a recommended/allowed strategy does NOT inject any caution line', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'educational', // recommended under healthcare image
    });
    const composed = composeCreatorImagePrompt({ ...BASE_INPUT, governance: ctx });
    const joined = composed.layers.governance.join('\n');
    expect(joined).not.toMatch(/extra caution/i);
    expect(joined).not.toMatch(/deprioritized/i);
    // But compliance directives still fire.
    expect(joined).toMatch(/clinical claim/i);
  });
});

/* ── Phase 5 — explainability metadata ──────────────────────────── */

describe('Phase 5 — generation_metadata.governance', () => {
  test('healthcare → governance metadata captures industry/risk/strategy/warnings count', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'promotional',
    });
    const composed = composeCreatorImagePrompt({ ...BASE_INPUT, governance: ctx });
    expect(composed.governance.industry).toBe('healthcare');
    expect(composed.governance.riskLevel).toBe('high');
    expect(composed.governance.selectedStrategy).toBe('promotional');
    expect(composed.governance.selectedStrategyIsRestricted).toBe(true);
    expect(composed.governance.warningsApplied).toBeGreaterThan(0);
  });

  test('non-regulated company → governance metadata is industry=none / warnings=0', () => {
    const composed = composeCreatorImagePrompt({ ...BASE_INPUT });
    expect(composed.governance.industry).toBe('none');
    expect(composed.governance.riskLevel).toBe('none');
    expect(composed.governance.warningsApplied).toBe(0);
    expect(composed.governance.selectedStrategyIsRestricted).toBe(false);
  });

  test('governance metadata is always present on composed prompt (back-compat)', () => {
    // Legacy callers never knew about governance — they should still
    // see the field populated with the empty shape.
    const composed = composeCreatorImagePrompt({ ...BASE_INPUT, purposeKey: 'promotional-image' });
    expect(composed.governance).toBeDefined();
    expect(composed.governance.industry).toBe('none');
  });
});

/* ── Phase 6 — validation pins ──────────────────────────────────── */

describe('Validation — pinned scenarios', () => {
  test('Healthcare content prompt contains compliance directives', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const composed = composeCreatorImagePrompt({ ...BASE_INPUT, governance: ctx });
    expect(composed.prompt).toMatch(/clinical/i);
    expect(composed.prompt).toMatch(/treatment guarantee/i);
  });

  test('Finance content prompt contains compliance directives', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Finance' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const composed = composeCreatorImagePrompt({ ...BASE_INPUT, governance: ctx });
    expect(composed.prompt).toMatch(/guaranteed return/i);
    expect(composed.prompt).toMatch(/unsupported financial claim/i);
  });

  test('SaaS content prompt is unchanged (byte-identical) vs no-context legacy', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'SaaS' },
      contentType: 'image',
      selectedStrategy: 'promotional',
    });
    const withCtx = composeCreatorImagePrompt({ ...BASE_INPUT, governance: ctx });
    const legacy = composeCreatorImagePrompt({ ...BASE_INPUT });
    expect(withCtx.prompt).toBe(legacy.prompt);
  });
});

/* ── Policy registry — directive sets exist ─────────────────────── */

describe('Policy registry — directive sets', () => {
  test('every governed industry has a non-empty directive set', () => {
    for (const industry of ['healthcare', 'finance', 'insurance', 'legal'] as const) {
      const policy = getPolicyForIndustry(industry);
      expect(policy.compliancePromptDirectives.length).toBeGreaterThan(0);
    }
  });

  test('"none" policy has zero directives', () => {
    const policy = getPolicyForIndustry('none');
    expect(policy.compliancePromptDirectives).toEqual([]);
  });

  test('buildContextFromPolicy variant produces identical shape', () => {
    const policy = resolveStrategyGovernancePolicy({ industry: 'Healthcare' });
    const a = buildContextFromPolicy({
      policy,
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const b = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    expect(a.compliancePromptDirectives).toEqual(b.compliancePromptDirectives);
    expect(a.industry).toBe(b.industry);
    expect(a.riskLevel).toBe(b.riskLevel);
  });
});

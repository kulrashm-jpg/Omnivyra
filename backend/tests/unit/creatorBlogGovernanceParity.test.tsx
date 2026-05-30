/**
 * @jest-environment jsdom
 *
 * Blog Governance Parity — focused tests:
 *
 *   Phase 1  buildAnglesSystemPrompt prepends compliance preamble
 *   Phase 2  buildGenerationSystemPrompt prepends compliance preamble
 *   Phase 4  No governance → byte-identical to legacy callers
 *   Phase 5  SaaS → byte-identical (industry='none' no-op)
 *   Phase 6  Restricted-strategy caution + maximum-discipline line
 *   Phase 7  Coverage matrix now includes blog / article / newsletter
 *            rows with all signals covered
 */

import '@testing-library/jest-dom';
import {
  buildAnglesSystemPrompt,
  buildGenerationSystemPrompt,
} from '../../../lib/blog/blogGenerationEngine';
import {
  buildGovernancePromptContext,
  buildSystemPromptGovernancePreamble,
} from '../../services/creator/strategyGovernancePromptContext';
import {
  GOVERNANCE_COVERAGE_MATRIX,
  getCoverageRow,
  validateCoverageMatrix,
} from '../../services/creator/governanceCoverageMatrix';

const IDENTITY = {
  companyName: 'Acme',
  industry: 'Healthcare', // identity industry; the governance context owns the policy resolution
};

/* ── Phase 1 — buildAnglesSystemPrompt governance ───────────────── */

describe('Phase 1 — buildAnglesSystemPrompt receives governance', () => {
  test('healthcare context → angles prompt contains compliance policy header', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const prompt = buildAnglesSystemPrompt('blog', IDENTITY, ctx);
    expect(prompt).toMatch(/COMPLIANCE POLICY \(healthcare industry, risk: high\)/i);
    expect(prompt).toMatch(/clinical claim/i);
    expect(prompt).toMatch(/treatment guarantee/i);
  });

  test('finance context → angles prompt contains finance directives', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Finance' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const prompt = buildAnglesSystemPrompt('newsletter', IDENTITY, ctx);
    expect(prompt).toMatch(/COMPLIANCE POLICY \(finance industry/i);
    expect(prompt).toMatch(/guaranteed return/i);
  });

  test('legal context → angles prompt contains legal directives', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Law' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const prompt = buildAnglesSystemPrompt('article', IDENTITY, ctx);
    expect(prompt).toMatch(/COMPLIANCE POLICY \(legal industry/i);
    expect(prompt).toMatch(/legal guarantee/i);
  });

  test('no governance arg → prompt has no compliance header', () => {
    const prompt = buildAnglesSystemPrompt('blog', IDENTITY);
    expect(prompt).not.toMatch(/COMPLIANCE POLICY/i);
  });
});

/* ── Phase 2 — buildGenerationSystemPrompt governance ───────────── */

describe('Phase 2 — buildGenerationSystemPrompt receives governance', () => {
  test('healthcare context → generation prompt contains compliance policy', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const prompt = buildGenerationSystemPrompt(1200, 'blog', undefined, IDENTITY, ctx);
    expect(prompt).toMatch(/COMPLIANCE POLICY \(healthcare industry/i);
    expect(prompt).toMatch(/clinical claim/i);
  });

  test('insurance context → generation prompt contains insurance directives', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Insurance' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const prompt = buildGenerationSystemPrompt(800, 'newsletter', undefined, IDENTITY, ctx);
    expect(prompt).toMatch(/COMPLIANCE POLICY \(insurance industry/i);
    expect(prompt).toMatch(/coverage guarantee/i);
  });

  test('no governance arg → generation prompt has no compliance header', () => {
    const prompt = buildGenerationSystemPrompt(1200, 'blog', undefined, IDENTITY);
    expect(prompt).not.toMatch(/COMPLIANCE POLICY/i);
  });
});

/* ── Phase 4 + 5 — byte-identical for no-policy + SaaS ──────────── */

describe('Phases 4 + 5 — byte-identical system prompts when no policy applies', () => {
  test('no governance vs SaaS governance → identical generation prompt', () => {
    const legacy = buildGenerationSystemPrompt(1200, 'blog', undefined, IDENTITY);
    const saasCtx = buildGovernancePromptContext({
      companyContext: { industry: 'SaaS' },
      contentType: 'image',
      selectedStrategy: 'promotional',
    });
    const withSaas = buildGenerationSystemPrompt(1200, 'blog', undefined, IDENTITY, saasCtx);
    expect(withSaas).toBe(legacy);
  });

  test('healthcare governance produces strictly longer prompt (preamble prepended)', () => {
    const legacy = buildGenerationSystemPrompt(1200, 'blog', undefined, IDENTITY);
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const governed = buildGenerationSystemPrompt(1200, 'blog', undefined, IDENTITY, ctx);
    expect(governed.length).toBeGreaterThan(legacy.length);
    expect(governed.endsWith(legacy)).toBe(true);
  });

  test('SaaS angles prompt is byte-identical to legacy', () => {
    const legacy = buildAnglesSystemPrompt('blog', IDENTITY);
    const saasCtx = buildGovernancePromptContext({
      companyContext: { industry: 'SaaS' },
      contentType: 'image',
      selectedStrategy: 'promotional',
    });
    const withSaas = buildAnglesSystemPrompt('blog', IDENTITY, saasCtx);
    expect(withSaas).toBe(legacy);
  });
});

/* ── Phase 6 — restricted-strategy caution ──────────────────────── */

describe('Phase 6 — restricted strategy adds maximum-discipline line', () => {
  test('healthcare + promotional → angles prompt contains caution line', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'promotional', // restricted under healthcare image
    });
    const prompt = buildAnglesSystemPrompt('blog', IDENTITY, ctx);
    expect(prompt).toMatch(/maximum compliance discipline/i);
  });

  test('preamble shape is shared with theme treatment / visual paths', () => {
    const ctx = buildGovernancePromptContext({
      companyContext: { industry: 'Healthcare' },
      contentType: 'image',
      selectedStrategy: 'educational',
    });
    const preamble = buildSystemPromptGovernancePreamble(ctx)!;
    const blogPrompt = buildGenerationSystemPrompt(1200, 'blog', undefined, IDENTITY, ctx);
    // The blog prompt's preamble prefix matches the canonical builder output.
    expect(blogPrompt.startsWith(preamble)).toBe(true);
  });
});

/* ── Phase 7 — Coverage matrix ──────────────────────────────────── */

describe('Phase 7 — coverage matrix includes blog / article / newsletter rows', () => {
  test('matrix structural validation passes', () => {
    const { ok, issues } = validateCoverageMatrix();
    expect(issues).toEqual([]);
    expect(ok).toBe(true);
  });

  test('every long-form content type is in the matrix', () => {
    const types = GOVERNANCE_COVERAGE_MATRIX.map((r) => r.contentType);
    expect(types).toEqual(expect.arrayContaining(['blog', 'article', 'newsletter']));
  });

  test('blog has audit + prompt + system_prompt + metadata + explainability covered', () => {
    const row = getCoverageRow('blog')!;
    expect(row.covered.audit).toBe(true);
    expect(row.covered.prompt).toBe(true);
    expect(row.covered.system_prompt).toBe(true);
    expect(row.covered.metadata).toBe(true);
    expect(row.covered.explainability).toBe(true);
  });

  test('article has audit + prompt + system_prompt + metadata + explainability covered', () => {
    const row = getCoverageRow('article')!;
    expect(row.covered.audit).toBe(true);
    expect(row.covered.prompt).toBe(true);
    expect(row.covered.system_prompt).toBe(true);
    expect(row.covered.metadata).toBe(true);
    expect(row.covered.explainability).toBe(true);
  });

  test('newsletter has audit + prompt + system_prompt + metadata + explainability covered', () => {
    const row = getCoverageRow('newsletter')!;
    expect(row.covered.audit).toBe(true);
    expect(row.covered.prompt).toBe(true);
    expect(row.covered.system_prompt).toBe(true);
    expect(row.covered.metadata).toBe(true);
    expect(row.covered.explainability).toBe(true);
  });

  test('recommendation/picker are deliberately false for long-form (no purpose picker)', () => {
    for (const ct of ['blog', 'article', 'newsletter']) {
      const row = getCoverageRow(ct)!;
      expect(row.covered.recommendation).toBe(false);
      expect(row.covered.picker).toBe(false);
    }
  });
});

/**
 * PMF-001 §3/§6/§7/§11 — Content Writer migration units: reversible flag,
 * CKC→brand-context parity, single-sourced prompt builders, output compatibility.
 */

import {
  getContentWriterRuntimeMode, servedRuntime, shouldRunPlatform, shouldRunLegacy,
} from '../../services/contentWriter/contentWriterMigrationFlag';
import { knowledgeToBrandContext } from '../../services/contentWriter/contentWriterKnowledge';
import {
  WORKSPACE_SYSTEM_PROMPT, buildWorkspaceUserPrompt, buildContextLines, getPlatformSpec,
} from '../../services/contentWriter/workspaceContentPrompt';
import { compareVariantParity } from '../../services/contentWriter/contentWriterCapability';
import type { KnowledgeContext } from '../../services/knowledgeConsumption/knowledgeContextContracts';

function knowledgeFixture(): KnowledgeContext {
  const dom = (domain: string, fields: Record<string, unknown>) => ({ domain, fields, confidence: 80, sourceFields: [] });
  return {
    companyId: 'org1', consumer: 'CONTENT_WRITER',
    knowledge: {
      IDENTITY: dom('IDENTITY', { name: 'Acme' }),
      INDUSTRY: dom('INDUSTRY', { industry: 'SaaS' }),
      POSITIONING: dom('POSITIONING', { unique_value: 'Ship faster' }),
      BRAND: dom('BRAND', { brand_voice: 'Bold and clear' }),
      AUDIENCE: dom('AUDIENCE', { target_audience: 'SMB founders' }),
      MARKETING: dom('MARKETING', { key_messages: 'Save time' }),
    },
    metadata: {
      version: 5, lifecycle: 'ACTIVE', confidence: { overall: 80, byDomain: {} }, provenance: null,
      freshness: { createdAt: 'T', ageMs: 0, fresh: true }, language: 'en', languageMatch: true, mode: 'summary',
      domainsIncluded: ['IDENTITY', 'INDUSTRY', 'POSITIONING', 'BRAND', 'AUDIENCE', 'MARKETING'], domainsDropped: [],
      tokens: { served: 10, full: 20, saved: 10 },
    },
  } as unknown as KnowledgeContext;
}

describe('PMF-001 §11 — reversible migration flag', () => {
  const orig = process.env.CONTENT_WRITER_RUNTIME;
  afterEach(() => { if (orig === undefined) delete process.env.CONTENT_WRITER_RUNTIME; else process.env.CONTENT_WRITER_RUNTIME = orig; });

  test('defaults to legacy (safe); unknown → legacy', () => {
    delete process.env.CONTENT_WRITER_RUNTIME;
    expect(getContentWriterRuntimeMode()).toBe('legacy');
    process.env.CONTENT_WRITER_RUNTIME = 'garbage';
    expect(getContentWriterRuntimeMode()).toBe('legacy');
  });
  test('platform + dual resolve; dual serves legacy (zero regression)', () => {
    process.env.CONTENT_WRITER_RUNTIME = 'platform';
    expect(servedRuntime()).toBe('platform');
    expect(shouldRunPlatform()).toBe(true);
    process.env.CONTENT_WRITER_RUNTIME = 'dual';
    expect(servedRuntime()).toBe('legacy');       // dual serves legacy
    expect(shouldRunPlatform()).toBe(true);
    expect(shouldRunLegacy()).toBe(true);
    process.env.CONTENT_WRITER_RUNTIME = 'legacy';
    expect(shouldRunPlatform()).toBe(false);
  });
});

describe('PMF-001 §3 — CKC → brand context parity', () => {
  test('maps the exact legacy lines, in order, only for present fields', () => {
    const ctx = knowledgeToBrandContext(knowledgeFixture());
    expect(ctx).toBe([
      'Company: Acme',
      'Industry: SaaS',
      'Value proposition: Ship faster',
      'Tone of voice: Bold and clear',
      'Target audience: SMB founders',
      'Key messages: Save time',
    ].join('\n'));
  });
  test('empty knowledge → empty brand context (legacy behavior when no profile)', () => {
    expect(knowledgeToBrandContext(null)).toBe('');
  });
});

describe('PMF-001 §6 — single-sourced prompt builders', () => {
  test('system prompt preserved verbatim', () => {
    expect(WORKSPACE_SYSTEM_PROMPT.startsWith('You are an expert social media content strategist and copywriter.')).toBe(true);
    expect(WORKSPACE_SYSTEM_PROMPT).toContain('Return ONLY a valid JSON object');
  });
  test('user prompt includes brand context, topic, per-platform blocks, and JSON footer', () => {
    const user = buildWorkspaceUserPrompt({
      brandContext: 'Company: Acme', contextLines: buildContextLines({ theme: 'Launch week' }),
      platforms: ['linkedin', 'x'], topic: '  New feature  ', contentTypes: {},
    });
    expect(user).toContain('BRAND CONTEXT:\nCompany: Acme');
    expect(user).toContain('CAMPAIGN CONTEXT:\nWeekly theme: Launch week');
    expect(user).toContain('TOPIC / ANGLE:\nNew feature'); // trimmed
    expect(user).toContain('=== LINKEDIN ===');
    expect(user).toContain('=== X ===');
    expect(user).toContain('Return JSON: { "linkedin": "...", "x" : "..." }');
  });
  test('content-type note injected and spec resolves for unknown platform', () => {
    const user = buildWorkspaceUserPrompt({ brandContext: '', contextLines: [], platforms: ['linkedin'], topic: 't', contentTypes: { linkedin: 'video' } });
    expect(user).toContain('=== LINKEDIN (video) ===');
    expect(user).toContain('Content-type note: Write a VIDEO SCRIPT');
    expect(getPlatformSpec('unknownplatform').optimal).toBe(600); // default spec
  });
});

describe('PMF-001 §7 — output compatibility helper', () => {
  test('parity compare reports key equality', () => {
    expect(compareVariantParity({ a: '1', b: '2' }, { a: 'x', b: 'y' }).sameKeys).toBe(true);
    expect(compareVariantParity({ a: '1' }, { a: 'x', b: 'y' }).sameKeys).toBe(false);
  });
});

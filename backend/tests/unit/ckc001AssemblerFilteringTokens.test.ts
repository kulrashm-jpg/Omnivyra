/**
 * CKC-001 §2/§3/§4/§5 — deterministic assembler: domain filtering, field
 * selection, confidence gating, freshness, language, token optimization modes.
 */

import { assembleKnowledgeContext, type AssembleInput } from '../../services/knowledgeConsumption/knowledgeContextAssembler';
import { selectorKey } from '../../services/knowledgeConsumption/knowledgeVersionSelector';
import { resolveConsumerProfile } from '../../services/knowledgeConsumption/knowledgeConsumerProfiles';
import { estimateTokens } from '../../services/knowledgeConsumption/knowledgeContextContracts';
import type { KnowledgeDomain, KnowledgeDomainId } from '../../services/knowledge/companyKnowledgeModel';
import type { KnowledgeEntity } from '../../services/knowledge/companyKnowledgeEntity';

const NOW = '2026-07-13T00:00:00.000Z';

function domain(id: KnowledgeDomainId, fields: Record<string, unknown>, sourceFields: string[]): KnowledgeDomain {
  return { domain: id, fields, sourceFields };
}

function buildDomains(): Record<KnowledgeDomainId, KnowledgeDomain> {
  const d = {} as Record<KnowledgeDomainId, KnowledgeDomain>;
  d.IDENTITY = domain('IDENTITY', { name: 'Acme', website_url: 'https://acme.com', language: 'en', empty: '', nothing: null }, ['name', 'website_url']);
  d.BRAND = domain('BRAND', { brand_voice: 'x'.repeat(1000), logo_url: 'https://acme.com/l.png' }, ['brand_voice', 'logo_url']);
  d.AUDIENCE = domain('AUDIENCE', { target_audience: 'SMB founders', target_audience_list: ['a', 'b', 'c'] }, ['target_audience']);
  d.SEO = domain('SEO', { seo_keywords: ['k1', 'k2'] }, []);
  return d;
}

function buildEntity(byDomain: Partial<Record<KnowledgeDomainId, number>>): KnowledgeEntity {
  return {
    companyId: 'org1', version: 7, createdAt: NOW, createdBy: null,
    refreshReason: 'test', refreshPolicy: 'EXECUTE_REFRESH',
    sourceFingerprints: null,
    provenance: { producer: 'crawler', generatedAt: NOW, workflow: 'wf', generationReason: 'r' },
    confidence: { overall: 82, byDomain },
    dependencies: [], lifecycle: 'ACTIVE',
  } as KnowledgeEntity;
}

function baseInput(overrides: Partial<AssembleInput['request']> = {}, byDomain: Partial<Record<KnowledgeDomainId, number>> = { IDENTITY: 90, BRAND: 80, AUDIENCE: 70, SEO: 40 }): AssembleInput {
  return {
    companyId: 'org1', consumer: 'CONTENT_WRITER',
    domains: buildDomains(), entity: buildEntity(byDomain),
    request: { companyId: 'org1', consumer: 'CONTENT_WRITER', domains: ['IDENTITY', 'BRAND', 'AUDIENCE', 'SEO'], ...overrides },
    currentActiveVersion: 7, now: NOW,
  };
}

describe('CKC-001 §3 — domain + confidence filtering', () => {
  test('explicit domains honored; low-confidence domains dropped', () => {
    const ctx = assembleKnowledgeContext(baseInput({ minConfidence: 50 }));
    expect(ctx.metadata.domainsIncluded).toEqual(['IDENTITY', 'BRAND', 'AUDIENCE']);
    expect(ctx.metadata.domainsDropped).toContain('SEO'); // confidence 40 < 50
    expect(ctx.knowledge.SEO).toBeUndefined();
  });

  test('profile default domains used when none requested', () => {
    const input = baseInput();
    input.request.domains = undefined;
    const ctx = assembleKnowledgeContext(input);
    const profile = resolveConsumerProfile('CONTENT_WRITER');
    // Only the intersection that exists in our fixture is included; all included ∈ profile.
    for (const d of ctx.metadata.domainsIncluded) expect(profile.domains).toContain(d);
  });
});

describe('CKC-001 §4 — field selection + token optimization modes', () => {
  test('field allow-list restricts fields', () => {
    const ctx = assembleKnowledgeContext(baseInput({ fields: { IDENTITY: ['name'] }, mode: 'full' }));
    expect(Object.keys(ctx.knowledge.IDENTITY.fields)).toEqual(['name']);
  });

  test('summary drops empty/null and truncates long strings; full keeps everything', () => {
    const full = assembleKnowledgeContext(baseInput({ mode: 'full' }));
    const summary = assembleKnowledgeContext(baseInput({ mode: 'summary' }));
    // full keeps empty + null identity fields
    expect('empty' in full.knowledge.IDENTITY.fields).toBe(true);
    expect('nothing' in full.knowledge.IDENTITY.fields).toBe(true);
    // summary drops them
    expect('empty' in summary.knowledge.IDENTITY.fields).toBe(false);
    expect('nothing' in summary.knowledge.IDENTITY.fields).toBe(false);
    // long brand_voice truncated in summary
    expect((summary.knowledge.BRAND.fields.brand_voice as string).length).toBeLessThan(1000);
    // summary serves fewer tokens than full, with real savings recorded
    expect(summary.metadata.tokens.served).toBeLessThan(full.metadata.tokens.served);
    expect(summary.metadata.tokens.saved).toBeGreaterThan(0);
  });

  test('compressed is the smallest and empties sourceFields', () => {
    const summary = assembleKnowledgeContext(baseInput({ mode: 'summary' }));
    const compressed = assembleKnowledgeContext(baseInput({ mode: 'compressed' }));
    expect(compressed.metadata.tokens.served).toBeLessThanOrEqual(summary.metadata.tokens.served);
    expect(compressed.knowledge.BRAND.sourceFields).toEqual([]);
    expect((compressed.knowledge.BRAND.fields.brand_voice as string).length).toBeLessThanOrEqual(160);
  });

  test('explicit full flag forces full mode regardless of requested mode', () => {
    const ctx = assembleKnowledgeContext(baseInput({ mode: 'compressed', full: true }));
    expect(ctx.metadata.mode).toBe('full');
    expect('empty' in ctx.knowledge.IDENTITY.fields).toBe(true);
  });

  test('token accounting invariant: served <= full and saved = full - served', () => {
    const ctx = assembleKnowledgeContext(baseInput({ mode: 'summary' }));
    expect(ctx.metadata.tokens.served).toBeLessThanOrEqual(ctx.metadata.tokens.full);
    expect(ctx.metadata.tokens.saved).toBe(Math.max(0, ctx.metadata.tokens.full - ctx.metadata.tokens.served));
  });
});

describe('CKC-001 §3 — freshness + language', () => {
  test('freshness flagged not-fresh when older than maxAgeMs', () => {
    const later = '2026-07-20T00:00:00.000Z'; // 7 days after createdAt
    const input = baseInput({ maxAgeMs: 24 * 3600 * 1000 });
    input.now = later;
    const ctx = assembleKnowledgeContext(input);
    expect(ctx.metadata.freshness.fresh).toBe(false);
    expect(ctx.metadata.freshness.ageMs).toBeGreaterThan(0);
  });

  test('language match reported', () => {
    expect(assembleKnowledgeContext(baseInput({ language: 'en' })).metadata.languageMatch).toBe(true);
    expect(assembleKnowledgeContext(baseInput({ language: 'fr' })).metadata.languageMatch).toBe(false);
  });
});

describe('CKC-001 §7 — metadata contract + determinism', () => {
  test('metadata carries version, confidence, provenance, freshness', () => {
    const ctx = assembleKnowledgeContext(baseInput());
    expect(ctx.metadata.version).toBe(7);
    expect(ctx.metadata.lifecycle).toBe('ACTIVE');
    expect(ctx.metadata.confidence.overall).toBe(82);
    expect(ctx.metadata.provenance?.producer).toBe('crawler');
    expect(ctx.metadata.freshness.createdAt).toBe(NOW);
  });

  test('identical inputs → identical output (deterministic)', () => {
    expect(assembleKnowledgeContext(baseInput({ mode: 'summary' }))).toEqual(assembleKnowledgeContext(baseInput({ mode: 'summary' })));
  });
});

describe('CKC-001 §5 — version selector keys', () => {
  test('selectorKey is stable per strategy', () => {
    expect(selectorKey(undefined)).toBe('latest');
    expect(selectorKey({ kind: 'approved' })).toBe('approved');
    expect(selectorKey({ kind: 'specific', version: 4 })).toBe('specific:4');
    expect(selectorKey({ kind: 'rollback', version: 2 })).toBe('rollback:2');
    expect(selectorKey({ kind: 'preview', version: 9 })).toBe('preview:9');
    expect(selectorKey({ kind: 'comparison', fromVersion: 3, toVersion: 7 })).toBe('comparison:3:7');
  });

  test('estimateTokens is deterministic and monotonic with size', () => {
    expect(estimateTokens('a')).toBe(estimateTokens('a'));
    expect(estimateTokens('x'.repeat(400))).toBeGreaterThan(estimateTokens('x'));
  });
});

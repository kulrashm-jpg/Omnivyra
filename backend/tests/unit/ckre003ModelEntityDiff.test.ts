/**
 * CKRE-003 §1/§2/§3/§4/§6 — knowledge model, entity/lifecycle, diff, retention.
 */
import {
  composeKnowledgeDomains, domainConfidence, KNOWLEDGE_DOMAINS, type ProfileRow,
} from '../../services/knowledge/companyKnowledgeModel';
import {
  buildKnowledgeEntity, canKnowledgeTransition, assertKnowledgeTransition, deriveKnowledgeLifecycle,
  KNOWLEDGE_LIFECYCLE_ORDER,
} from '../../services/knowledge/companyKnowledgeEntity';
import { diffKnowledge, type KnowledgeSnapshot } from '../../services/knowledge/knowledgeDiffService';
import { applyRetention, getKnowledgeRetentionConfig } from '../../services/knowledge/knowledgeRetention';

const ROW: ProfileRow = {
  name: 'Acme Inc', industry: 'SaaS', geography: 'US', logo_url: 'https://acme.com/l.png',
  favicon_url: 'https://acme.com/f.ico', products_services: 'Widgets', target_audience: 'B2B teams',
  unique_value: 'Fastest widgets', competitors: 'Globex', brand_voice: 'confident',
  social_profiles: [{ platform: 'linkedin', url: 'https://linkedin.com/company/acme' }],
  overall_confidence: 80,
  field_confidence: { industry: { confidence: 'high' }, name: { confidence: 'medium' } },
  report_settings: { discovered_metadata: { language: 'en', brand_color: '#0A66C2', seo_keywords: ['widgets'], title: 'Acme', description: 'We build widgets' } },
};

describe('CKRE-003 §1 — knowledge model composes domains (no duplicate storage)', () => {
  test('all 14 domains composed from existing fields', () => {
    const k = composeKnowledgeDomains('org1', ROW);
    expect(Object.keys(k.domains).sort()).toEqual([...KNOWLEDGE_DOMAINS].sort());
    expect(k.domains.IDENTITY.fields.name).toBe('Acme Inc');
    expect(k.domains.BRAND.fields.logo_url).toBe('https://acme.com/l.png');
    expect(k.domains.BRAND.fields.brand_color).toBe('#0A66C2');       // from discovered_metadata
    expect(k.domains.INDUSTRY.fields.industry).toBe('SaaS');
    expect(k.domains.SEO.fields.seo_keywords).toEqual(['widgets']);   // composed
    expect(k.domains.WEBSITE.fields.description).toBe('We build widgets');
    expect(k.domains.COMPETITORS.fields.competitors).toBe('Globex');
  });

  test('determinism: same row → identical composition', () => {
    expect(composeKnowledgeDomains('org1', ROW)).toEqual(composeKnowledgeDomains('org1', ROW));
  });

  test('domain confidence derives from field_confidence / overall', () => {
    expect(domainConfidence(ROW, 'INDUSTRY')).toBe(90); // high
    expect(domainConfidence(ROW, 'AUDIENCE')).toBe(80); // falls back to overall (no field_confidence)
  });
});

describe('CKRE-003 §2/§3 — entity + lifecycle', () => {
  test('entity is immutable + carries the required references', () => {
    const e = buildKnowledgeEntity({
      companyId: 'org1', version: 2, createdAt: 't', refreshReason: 'major_change', refreshPolicy: 'REFRESH_FULL',
      confidence: { overall: 80, byDomain: { IDENTITY: 90 } }, dependencies: ['HTML', 'BUSINESS'] as never,
    });
    expect(e.version).toBe(2);
    expect(e.refreshReason).toBe('major_change');
    expect(e.dependencies).toEqual(['HTML', 'BUSINESS']);
    expect(() => { (e as any).version = 3; }).toThrow(); // frozen
  });

  test('lifecycle transitions: legal path + illegal blocked', () => {
    expect(canKnowledgeTransition('CREATED', 'VALIDATED')).toBe(true);
    expect(canKnowledgeTransition('VALIDATED', 'ACTIVE')).toBe(true);
    expect(canKnowledgeTransition('ACTIVE', 'SUPERSEDED')).toBe(true);
    expect(canKnowledgeTransition('SUPERSEDED', 'ACTIVE')).toBe(true); // rollback restore
    expect(canKnowledgeTransition('ARCHIVED', 'ACTIVE')).toBe(false);  // terminal
    expect(canKnowledgeTransition('CREATED', 'ACTIVE')).toBe(false);   // must validate first
    expect(() => assertKnowledgeTransition('ARCHIVED', 'ACTIVE')).toThrow(/ILLEGAL_KNOWLEDGE_LIFECYCLE_TRANSITION/);
    for (const s of KNOWLEDGE_LIFECYCLE_ORDER) expect(canKnowledgeTransition(s, s)).toBe(true);
  });

  test('derived lifecycle: current=ACTIVE, older=SUPERSEDED, markers win', () => {
    expect(deriveKnowledgeLifecycle('ACTIVE', 3, 3)).toBe('ACTIVE');
    expect(deriveKnowledgeLifecycle('ACTIVE', 2, 3)).toBe('SUPERSEDED');
    expect(deriveKnowledgeLifecycle('ARCHIVED', 1, 3)).toBe('ARCHIVED');
    expect(deriveKnowledgeLifecycle('ROLLED_BACK', 2, 3)).toBe('ROLLED_BACK');
  });
});

describe('CKRE-003 §4 — deterministic diff', () => {
  const snap = (version: number, fields: Record<string, unknown>, conf: Record<string, number> = {}): KnowledgeSnapshot => ({
    entity: buildKnowledgeEntity({ companyId: 'org1', version, createdAt: 't', refreshReason: 'r', refreshPolicy: 'REFRESH_FULL', confidence: { overall: 80, byDomain: conf as never }, dependencies: ['BUSINESS'] as never }),
    domains: { ...composeKnowledgeDomains('org1', ROW).domains, IDENTITY: { domain: 'IDENTITY', fields, sourceFields: ['name'] } },
  });

  test('changed / added / removed fields + changed domains', () => {
    const prev = snap(1, { name: 'Acme Inc', geography: 'US' });
    const next = snap(2, { name: 'Globex', geography: null, tagline: 'new' });
    const d = diffKnowledge(prev, next);
    expect(d.changedDomains).toContain('IDENTITY');
    expect(d.changedFields.find((c) => c.field === 'name')).toBeTruthy();
    expect(d.removed.find((c) => c.field === 'geography')).toBeTruthy();
    expect(d.added.find((c) => c.field === 'tagline')).toBeTruthy();
    expect(d.dependencyImpact).toEqual(['BUSINESS']);
    expect(d.identical).toBe(false);
  });

  test('confidence changes captured', () => {
    const prev = snap(1, { name: 'Acme' }, { IDENTITY: 50 });
    const next = snap(2, { name: 'Acme' }, { IDENTITY: 90 });
    const d = diffKnowledge(prev, next);
    expect(d.confidenceChanges).toContainEqual({ domain: 'IDENTITY', from: 50, to: 90 });
  });

  test('identical snapshots → identical diff (no changes)', () => {
    const a = snap(1, { name: 'Acme' });
    const b = snap(1, { name: 'Acme' });
    const d = diffKnowledge(a, b);
    expect(d.identical).toBe(true);
    expect(diffKnowledge(a, b)).toEqual(d); // determinism
  });

  test('null prev → everything present is added', () => {
    const d = diffKnowledge(null, snap(1, { name: 'Acme' }));
    expect(d.fromVersion).toBeNull();
    expect(d.added.length).toBeGreaterThan(0);
  });
});

describe('CKRE-003 §6 — retention never drops the active version', () => {
  const mk = (version: number, ageDays = 0): KnowledgeSnapshot => ({
    entity: buildKnowledgeEntity({ companyId: 'org1', version, createdAt: new Date(1_000_000_000_000 - ageDays * 86_400_000).toISOString(), refreshReason: 'r', refreshPolicy: 'REFRESH_FULL', confidence: { overall: 0, byDomain: {} } }),
    domains: {} as never,
  });

  test('keeps most-recent maxVersions + always the active one', () => {
    const snaps = [mk(5), mk(4), mk(3), mk(2), mk(1)]; // newest-first
    const cfg = { maxVersions: 2, archiveOlderThanDays: 0 };
    const { kept, archived } = applyRetention(snaps, cfg, /*active*/ 1, 1_000_000_000_000);
    expect(kept.map((s) => s.entity.version).sort()).toEqual([1, 4, 5]); // 5,4 by count + 1 active
    expect(archived.map((s) => s.entity.version).sort()).toEqual([2, 3]);
  });

  test('config resolves defaults', () => {
    const cfg = getKnowledgeRetentionConfig();
    expect(cfg.maxVersions).toBeGreaterThan(0);
  });
});

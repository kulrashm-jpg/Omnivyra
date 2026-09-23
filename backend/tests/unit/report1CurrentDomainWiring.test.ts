/**
 * R1-OPEN-01 — the Report 1 composition must HAND the current-domain scope to every reader.
 *
 * `report1CurrentDomainEvidence.test.ts` proves each reader honours a scope. This file proves the
 * composition actually passes one: behaviourally for `composeSnapshotReportFromDecisions`, and by
 * source contract for the two outer call sites that are too wide to run here (the generate path
 * and `composeSnapshotReport`). Dropping any hand-off fails a test below.
 */
import fs from 'fs';
import path from 'path';

const received: Array<{ reader: string; args: unknown[] }> = [];

jest.mock('../../services/websiteIntelligence/websiteIntelligenceRepository', () => {
  const actual = jest.requireActual('../../services/websiteIntelligence/websiteIntelligenceRepository');
  const spy = (reader: string) => async (...args: unknown[]) => { received.push({ reader, args }); return null; };
  return {
    ...actual,
    getWebsiteTechnicalIntelligence: spy('technical'),
    getWebsiteContentIntelligence: spy('content'),
    getWebsiteAccessibilityIntelligence: spy('accessibility'),
    getWebsiteBrandIntelligence: spy('brand'),
  };
});

jest.mock('../../services/digitalExperienceRepository', () => {
  const actual = jest.requireActual('../../services/digitalExperienceRepository');
  return {
    ...actual,
    loadExperiencePages: async (...args: unknown[]) => { received.push({ reader: 'experience', args }); return []; },
  };
});

// Nothing in this file may reach a database: every read is answered with zero rows.
jest.mock('../../db/supabaseClient', () => {
  const actual = jest.requireActual('../../db/supabaseClient');
  const zero = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'not', 'gte', 'lte', 'order', 'limit', 'is', 'neq']) q[m] = () => q;
    q.maybeSingle = async () => ({ data: null, error: null });
    q.single = async () => ({ data: null, error: null });
    q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve, reject);
    return q;
  };
  return { ...actual, supabase: { from: () => zero() } };
});

const { composeSnapshotReportFromDecisions } = require('../../services/snapshotReportService');

jest.setTimeout(120_000);

const ROOT = path.resolve(__dirname, '../../..');
const source = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const EMPTY_AUDIT = {
  site_structure: { homepage: null, product_pages: [], pricing_pages: [], blog_pages: [], contact_pages: [], geo_pages: [], legal_pages: [] },
  geo_aeo_context: {
    queries: [], entities: [], answerable_content_pct: null, structured_content_pct: null, citation_ready_pct: null,
    answer_coverage_score: null, entity_clarity_score: null, topical_authority_score: null,
    citation_readiness_score: null, content_structure_score: null, freshness_score: null,
  },
  declared_evidence: {
    same_as: { count: 0, domains: [], destination_types: {}, source: 'schema_org' },
    declared_certifications: { count: 0, items: [], source: 'schema_org' },
    legal_transparency: { items: [], present_count: 0, source: 'crawler' },
  },
  decisions: [],
};

describe('R1-OPEN-01 — composition hands the scope to every website-evidence reader', () => {
  beforeEach(() => { received.length = 0; });

  it('the four engines and the experience loader all receive the SAME current-domain scope', async () => {
    const domainScope = { domainId: 'd-current' };
    await composeSnapshotReportFromDecisions({
      companyId: 'wiring-co', snapshotDecisions: [], publicAudit: EMPTY_AUDIT, domainScope,
    }).catch(() => undefined);
    const readers = ['technical', 'content', 'accessibility', 'brand', 'experience'];
    for (const reader of readers) {
      const call = received.find((r) => r.reader === reader);
      expect(call).toBeDefined();
      expect(call!.args).toEqual(['wiring-co', domainScope]);
    }
  });

  it('an unresolved scope is handed down unchanged (the readers then abstain)', async () => {
    const domainScope = { domainId: null };
    await composeSnapshotReportFromDecisions({
      companyId: 'wiring-co', snapshotDecisions: [], publicAudit: EMPTY_AUDIT, domainScope,
    }).catch(() => undefined);
    expect(received.filter((r) => r.args[1] === domainScope)).toHaveLength(5);
  });
});

describe('R1-OPEN-01 — outer call sites (source contract)', () => {
  const snapshot = source('backend/services/snapshotReportService.ts');
  const compose = snapshot.slice(snapshot.indexOf('export async function composeSnapshotReport('));

  it('composeSnapshotReport uses the caller\'s scope, else resolves it from the report input — never company-wide', () => {
    expect(compose).toMatch(/const domainScope = options\?\.domainScope\s*\?\? await resolveReportDomainScope\(companyId, options\?\.resolvedInput\?\.resolved\.websiteDomain \?\? null\)/);
  });

  it('composeSnapshotReport passes it to the audit, competitor discovery and the composition', () => {
    const audit = compose.slice(compose.indexOf('buildPublicDomainAuditDecisions({'), compose.indexOf('});', compose.indexOf('buildPublicDomainAuditDecisions({')));
    const competitor = compose.slice(compose.indexOf('buildCompetitorIntelligenceActive({'), compose.indexOf('});', compose.indexOf('buildCompetitorIntelligenceActive({')));
    const fromDecisions = compose.slice(compose.indexOf('composeSnapshotReportFromDecisions({'), compose.indexOf('});', compose.indexOf('composeSnapshotReportFromDecisions({')));
    for (const call of [audit, competitor, fromDecisions]) expect(call).toMatch(/\bdomainScope,/);
  });

  it('competitor discovery scopes both its answer-topic read and the SERP keyword seed', () => {
    const engine = source('backend/services/reportCompetitorIntelligenceServiceEngine.ts');
    const active = engine.slice(engine.indexOf('export async function buildCompetitorIntelligenceActive('));
    expect(active).toMatch(/extractTopKeywords\(\{[^}]*domainScope: params\.domainScope/);
    expect(active).toMatch(/withDomainScope\(\s*supabase\s*\.from\('canonical_pages'\)/);
  });

  it('the generate path scopes composition to the exact website the crawl targeted', () => {
    const assembly = source('backend/services/reportCardServiceAssembly.ts');
    expect(assembly).toMatch(/domainScope = await resolveReportDomainScope\(report\.company_id, crawlResult\.targetUrl \?\? null\)/);
    const call = assembly.slice(assembly.indexOf('composeSnapshotReport(report.company_id, {'));
    expect(call.slice(0, call.indexOf('})'))).toMatch(/\bdomainScope,/);
  });
});

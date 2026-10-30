/**
 * Prospect provenance — source registry completeness.
 *
 * Every `SOURCE_CATEGORIES` value (lib/prospectProvenance/contract.ts) must have:
 *   (a) a fixture — a valid contribution for that category, accepted by the one
 *       writer and persisted with the category VERBATIM (never remapped);
 *   (b) a taxonomy / display mapping onto the display vocabulary
 *       `CanonicalLeadSource` (lib/leadIntelligence) — built by the reader
 *       workstream (Agent 3);
 *   (c) an ingestion path that records contributions under it — built by the
 *       ingestion workstreams (Agents 2 / 4);
 *   (d) a place in the migration CHECK constraint — built by the migration
 *       workstream (Agent 1);
 * and the vocabulary must agree everywhere it is written down (contract doc,
 * code, schema-parity manifest).
 *
 * PENDING MARKERS. (b), (c) and (d) do not exist on this branch; they are
 * `test.todo` entries named per category so that the integration step flips
 * each one into a real assertion. Nothing here is skipped silently: a pending
 * item is visible in every jest summary as "todo".
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  SOURCE_CATEGORIES,
  CONTRIBUTION_ROLES,
  PROVENANCE_DB,
  isSourceCategory,
  namespacedExternalRef,
  parseExternalRef,
  type SourceCategory,
  type SourceContributionInput,
} from '../../../lib/prospectProvenance/contract';
import {
  recordSourceContribution,
  validateContributionInput,
} from '../../../backend/services/prospectProvenance/contributionWriter';

const REPO = path.resolve(__dirname, '../../..');
const ORG = '11111111-1111-4111-8111-111111111111';
const LEAD = '22222222-2222-4222-8222-222222222222';

/**
 * One fixture per category. Typed as a total Record, so a category added to the
 * contract without a fixture is a compile error in typecheck and a runtime
 * failure below (ts-jest here is transpile-only).
 */
const FIXTURES: Record<SourceCategory, { provider: string; id: string; platform: string | null; sourceUrl: string | null }> = {
  marketpulse:      { provider: 'marketpulse',   id: 'sig-001',            platform: 'marketpulse', sourceUrl: null },
  social_listening: { provider: 'listening',     id: 'ls-001',             platform: 'reddit',      sourceUrl: 'https://www.reddit.com/r/example/comments/abc' },
  community:        { provider: 'community',     id: 'feed-001',           platform: 'linkedin',    sourceUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:1' },
  engagement:       { provider: 'engagement',    id: 'msg-001',            platform: 'linkedin',    sourceUrl: null },
  inbound_form:     { provider: 'form',          id: 'sub-001',            platform: 'website',     sourceUrl: 'https://example.com/contact' },
  inbound_webhook:  { provider: 'webhook',       id: 'evt-001',            platform: 'zapier',      sourceUrl: null },
  manual:           { provider: 'manual',        id: 'entry-001',          platform: null,          sourceUrl: null },
  crm:              { provider: 'crm_hubspot',   id: '9001',               platform: 'hubspot',     sourceUrl: null },
  csv:              { provider: 'csv',           id: 'batch-7:row-12',     platform: null,          sourceUrl: null },
  pi_discovery:     { provider: 'apollo',        id: 'person-abc',         platform: 'apollo',      sourceUrl: null },
  pi_enrichment:    { provider: 'apollo_enrich', id: 'person-abc',         platform: 'apollo',      sourceUrl: null },
  website:          { provider: 'website',       id: 'lead-001',           platform: 'website',     sourceUrl: 'https://example.com/' },
};

function fixtureInput(category: SourceCategory): SourceContributionInput {
  const f = FIXTURES[category];
  return {
    organizationId: ORG,
    canonicalLeadId: LEAD,
    leadCreated: true,
    sourceCategory: category,
    externalRef: namespacedExternalRef(f.provider, f.id),
    platform: f.platform,
    sourceUrl: f.sourceUrl,
    observedAt: '2026-10-30T08:00:00.000Z',
    evidence: { fixture: category },
  };
}

describe('provenance source registry — vocabulary agrees everywhere it is written down', () => {
  it('has 12 unique categories (match set is non-empty)', () => {
    expect(SOURCE_CATEGORIES.length).toBe(12);
    expect(new Set(SOURCE_CATEGORIES).size).toBe(SOURCE_CATEGORIES.length);
    expect(CONTRIBUTION_ROLES).toEqual(['originating', 'contributing']);
  });

  it('the contract document lists exactly the code vocabulary', () => {
    const doc = fs.readFileSync(path.join(REPO, 'docs', 'architecture', 'PROSPECT-PROVENANCE-CONTRACT.md'), 'utf8');
    const start = doc.indexOf('`source_category` vocabulary:');
    expect(start).toBeGreaterThan(-1);
    const paragraph = doc.slice(start, doc.indexOf('\n\n', start));
    const listed = [...paragraph.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).filter((v) => v !== 'source_category');
    expect(listed.length).toBeGreaterThan(0);
    expect([...listed].sort()).toEqual([...SOURCE_CATEGORIES].sort());
  });

  it('the schema-parity manifest gates source_category on both provenance stores', () => {
    const verifier = fs.readFileSync(path.join(REPO, 'scripts', 'verify-schema-parity.js'), 'utf8');
    expect(verifier).toMatch(new RegExp(`table: '${PROVENANCE_DB.table}', column: 'source_category'`));
    expect(verifier).toMatch(/table: 'source_records', column: 'source_category'/);
  });
});

describe('provenance source registry — every category has a fixture the writer accepts verbatim', () => {
  it('every category has exactly one fixture and no fixture names an unknown category', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...SOURCE_CATEGORIES].sort());
    for (const k of Object.keys(FIXTURES)) expect(isSourceCategory(k)).toBe(true);
  });

  it.each([...SOURCE_CATEGORIES])('%s: fixture is a valid contribution with a namespaced external ref', (category) => {
    const input = fixtureInput(category);
    expect(validateContributionInput(input)).toBeNull();
    const parsed = parseExternalRef(input.externalRef);
    expect(parsed).toEqual({ provider: FIXTURES[category].provider, id: FIXTURES[category].id });
  });

  it.each([...SOURCE_CATEGORIES])('%s: the writer persists source_category verbatim (never remapped)', async (category) => {
    const rows: Array<Record<string, unknown>> = [];
    const result = await recordSourceContribution(fixtureInput(category), {
      insert: async (row) => { rows.push(row); return { data: { id: `c-${category}` }, error: null }; },
    });
    expect(result).toEqual({ status: 'inserted', id: `c-${category}`, role: 'originating', roleDowngraded: false });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organization_id: ORG,
      canonical_lead_id: LEAD,
      contribution_role: 'originating',
      source_category: category,
      external_ref: fixtureInput(category).externalRef,
      platform: FIXTURES[category].platform,
      source_url: FIXTURES[category].sourceUrl,
      observed_at: '2026-10-30T08:00:00.000Z',
    });
  });

  it('rejects a category outside the vocabulary before any write', async () => {
    let writes = 0;
    const result = await recordSourceContribution(
      { ...fixtureInput('community'), sourceCategory: 'listening' as unknown as SourceCategory },
      { insert: async () => { writes++; return { data: { id: 'x' }, error: null }; } },
    );
    expect(result).toMatchObject({ status: 'error', code: 'invalid_input' });
    expect(writes).toBe(0);
  });
});

// ─── Pending: built by other workstreams; flipped at integration ─────────────

describe('provenance source registry — taxonomy / display mapping (PENDING: reader workstream, Agent 3)', () => {
  for (const category of SOURCE_CATEGORIES) {
    test.todo(`${category}: maps to exactly one CanonicalLeadSource display value (not 'other') and has a display label`);
  }
});

describe('provenance source registry — ingestion path (PENDING: ingestion workstreams, Agents 2 / 4)', () => {
  for (const category of SOURCE_CATEGORIES) {
    test.todo(`${category}: a non-test ingestion path calls recordSourceContribution with sourceCategory '${category}' (or documents why none exists — e.g. 'website' is historical compatibility)`);
  }
});

describe('provenance source registry — migration CHECK constraint (PENDING: migration workstream, Agent 1)', () => {
  test.todo('the prospect_source_contributions source_category CHECK lists exactly SOURCE_CATEGORIES');
  test.todo('the source_records source_category CHECK lists exactly SOURCE_CATEGORIES (nullable)');
});

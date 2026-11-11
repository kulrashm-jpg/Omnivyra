/**
 * PI-LDB D3(b) origin backfill (20270211000008): the migration's OWN
 * classification SQL (its @classify block, read from the file) is run against
 * fixtures and compared with the TypeScript structural classifier
 * (classifyInboundLead + INBOUND_LEAD_PROFILES). Adversarial rows: a free-text
 * `source` that SAYS "form" without a form_id must NOT become inbound_form; a
 * missing leads row, a cross-tenant join and an already-set origin are never
 * classified. Owner decision 2026-11-11 (structural only, never a guess).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { db, inRollback, seedTenants, newPerson, newLead, ORG_A, ORG_B } from './setup';
import { classifyInboundLead } from '../../services/prospectProvenance/ingestion/inboundLeadProvenance';
import { INBOUND_LEAD_PROFILES } from '../../services/prospectProvenance/ingestion/sourceProfiles';

const MIGRATION = readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'migrations',
  '20270211000008_pi_ldb_origin_category_backfill.sql'), 'utf8');
const CLASSIFY = (() => {
  const a = MIGRATION.indexOf('-- @classify-begin');
  const b = MIGRATION.indexOf('-- @classify-end');
  if (a < 0 || b < 0) throw new Error('@classify block not found in 20270211000008');
  return MIGRATION.slice(MIGRATION.indexOf('\n', a) + 1, b);
})();

// inRollback discards fixture rows, so the cached refs are reset per test.
beforeEach(() => REFS.clear());
const UUID = () => (require('crypto').randomUUID as () => string)();

/** form_id / integration_id are FKs (forms, company_integrations), so real rows back them. */
async function refs(org: string): Promise<{ form: string; integration: string }> {
  const { rows: u } = await db.query(`INSERT INTO public.users (email) VALUES ($1) RETURNING id`, [`bf-${UUID()}@example.test`]);
  const { rows: f } = await db.query(`INSERT INTO public.forms (company_id, created_by, name) VALUES ($1, $2, 'f') RETURNING id`, [org, u[0].id]);
  const { rows: i } = await db.query(`INSERT INTO public.company_integrations (company_id, created_by, type, name) VALUES ($1, $2, 'lead_webhook', 'w') RETURNING id`, [org, u[0].id]);
  return { form: f[0].id, integration: i[0].id };
}
const REFS = new Map<string, { form: string; integration: string }>();

async function legacyLead(org: string, cols: { form_id?: boolean; integration_id?: boolean; visitor_session_id?: boolean; source?: string }) {
  if (!REFS.has(org)) REFS.set(org, await refs(org));
  const r = REFS.get(org)!;
  const person = await newPerson(org);
  const { rows } = await db.query(
    `INSERT INTO public.leads (company_id, name, email, unified_person_id, source, form_id, integration_id, visitor_session_id)
     VALUES ($1, 'N', $2, $3, $4, $5, $6, $7) RETURNING id`,
    [org, `${UUID()}@x.test`, person, cols.source ?? 'direct',
      cols.form_id ? r.form : null, cols.integration_id ? r.integration : null, cols.visitor_session_id ? UUID() : null]);
  return rows[0].id as string;
}

async function li(org: string, sourceTable: string, sourceId: string, originCategory: string | null = null) {
  const { rows } = await db.query(
    `INSERT INTO public.lead_intelligence (company_id, dedupe_key, source, source_table, source_id, origin_category, origin_observed_at)
     VALUES ($1, $2, 'website', $3, $4, $5, $6) RETURNING id`,
    [org, `k:${UUID()}`, sourceTable, sourceId, originCategory, originCategory ? new Date().toISOString() : null]);
  return rows[0].id as string;
}

async function classify(ids: string[]): Promise<Map<string, { category: string | null; basis: string | null }>> {
  const { rows } = await db.query(`SELECT id, category, basis FROM (${CLASSIFY}) c WHERE id = ANY($1::uuid[])`, [ids]);
  return new Map(rows.map((r: { id: string; category: string | null; basis: string | null }) => [r.id, { category: r.category, basis: r.basis }]));
}

const tsCategory = (row: { form_id?: boolean; integration_id?: boolean; visitor_session_id?: boolean }) =>
  INBOUND_LEAD_PROFILES[classifyInboundLead({
    form_id: row.form_id ? 'x' : null, integration_id: row.integration_id ? 'x' : null, visitor_session_id: row.visitor_session_id ? 'x' : null,
  })].sourceCategory;

describe('20270211000008 classification == the structural TypeScript classifier', () => {
  it('leads-traced rows: SQL category equals classifyInboundLead for every combination, incl. adversarial free-text sources', () => inRollback(async () => {
    await seedTenants();
    const fixtures = [
      { form_id: true }, { integration_id: true }, { visitor_session_id: true }, {},
      { form_id: true, integration_id: true }, { integration_id: true, visitor_session_id: true },
      // ADVERSARIAL: the free text SAYS form / webhook, the structure does not.
      { source: 'form' }, { source: 'Form Embed' }, { source: 'webhook' },
    ];
    const ids: Array<{ id: string; fx: typeof fixtures[number] }> = [];
    for (const fx of fixtures) ids.push({ id: await li(ORG_A, 'leads', await legacyLead(ORG_A, fx)), fx });
    const got = await classify(ids.map((x) => x.id));
    for (const { id, fx } of ids) {
      expect(got.get(id)).toEqual({ category: tsCategory(fx), basis: 'classifyInboundLead' });
    }
    // The adversarial rows are NOT inbound_form / inbound_webhook.
    expect(got.get(ids[6].id)!.category).toBe('manual');
    expect(got.get(ids[8].id)!.category).toBe('manual');
  }));

  it('canonical prospects: the ORIGINATING contribution category; a contributing-only row is not used', () => inRollback(async () => {
    await seedTenants();
    const withOrig = await newLead(ORG_A);
    const contribOnly = await newLead(ORG_A);
    await db.query(`INSERT INTO public.prospect_source_contributions
        (organization_id, canonical_lead_id, contribution_role, source_category, external_ref, observed_at)
      VALUES ($1, $2, 'originating', 'pi_discovery', $3, now()), ($1, $4, 'contributing', 'csv', $5, now())`,
      [ORG_A, withOrig, `apollo:${UUID()}`, contribOnly, `csv:${UUID()}`]);
    const a = await li(ORG_A, 'canonical_leads', withOrig);
    const b = await li(ORG_A, 'canonical_leads', contribOnly);
    const got = await classify([a, b]);
    expect(got.get(a)).toEqual({ category: 'pi_discovery', basis: 'pi_adapter_profile_contribution' });
    expect(got.get(b)).toEqual({ category: null, basis: null });
  }));

  it('NEVER classified: a missing leads row, a cross-tenant join, an already-set origin, an unknown source_table', () => inRollback(async () => {
    await seedTenants();
    const missing = await li(ORG_A, 'leads', UUID());                          // no such leads row
    const otherTenantLead = await legacyLead(ORG_B, { form_id: true });
    const crossTenant = await li(ORG_A, 'leads', otherTenantLead);            // lead belongs to ORG_B
    const already = await li(ORG_A, 'leads', await legacyLead(ORG_A, { form_id: true }), 'crm');
    const unknownTable = await li(ORG_A, 'something_else', UUID());
    const got = await classify([missing, crossTenant, already, unknownTable]);
    expect(got.get(missing)).toEqual({ category: null, basis: null });
    expect(got.get(crossTenant)).toEqual({ category: null, basis: null });
    expect(got.has(already)).toBe(false);                                     // WHERE origin_category IS NULL
    expect(got.get(unknownTable)).toEqual({ category: null, basis: null });
  }));
});

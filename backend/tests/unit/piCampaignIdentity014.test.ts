/**
 * PI-CAMPAIGN-IDENTITY-014 — the canonical Prospect Campaign.
 *
 * The database's guarantees — the CHECK vocabulary, the immutable-tenant
 * trigger, the (id, organization_id) companion key, RLS, cross-tenant rejection
 * — are proven against real PostgreSQL in
 * `backend/tests/realschema/pi_prospect_campaigns_014.test.ts`.
 *
 * What belongs HERE is what is a decision rather than a constraint: the store's
 * validation, that it is the sole writer, that the campaign carries no list,
 * ICP, Offering, prospect or task dimension, and above all that creating one is
 * INERT.
 */

type Row = Record<string, unknown>;

const db = {
  ops: [] as Array<{ table: string; op: string; payload: Row; filters: Array<[string, unknown]> }>,
  rows: {} as Record<string, Row[]>,
  error: null as null | { code?: string; message?: string },
};

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const st = { op: 'select', payload: {} as Row, filters: [] as Array<[string, unknown]> };
    const exec = async (mode: 'many' | 'one') => {
      if (st.op !== 'select') {
        db.ops.push({ table, op: st.op, payload: st.payload, filters: [...st.filters] });
      }
      if (db.error) { const e = db.error; db.error = null; return { data: null, error: e }; }
      if (st.op === 'insert') {
        const existing = (db.rows[table] ??= []);
        const created = {
          id: `row-${existing.length + 1}`,
          // The DATABASE's default, mirrored: the store deliberately omits
          // `status` on create, so the double must supply what the column does.
          status: 'draft',
          description: null,
          ...st.payload,
          created_at: 't', updated_at: 't',
        };
        existing.push(created);
        return { data: mode === 'one' ? created : [created], error: null };
      }
      const matching = (db.rows[table] ?? []).filter((r) => st.filters.every(([c, v]) => r[c] === v));
      if (st.op === 'update') {
        for (const r of matching) Object.assign(r, st.payload);
        return { data: matching, error: null };
      }
      return { data: mode === 'one' ? matching[0] ?? null : matching, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (row: Row) => { st.op = 'insert'; st.payload = row; return b; },
      update: (row: Row) => { st.op = 'update'; st.payload = row; return b; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      is: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      order: () => exec('many'),
      single: () => exec('one'),
      maybeSingle: () => exec('one'),
      limit: () => exec('many'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

import {
  createProspectCampaign, getProspectCampaign, listProspectCampaigns,
  updateProspectCampaign, setProspectCampaignStatus,
  ProspectCampaignError, PROSPECT_CAMPAIGNS_TABLE, PROSPECT_CAMPAIGN_STATUSES,
} from '../../services/prospectCampaigns/prospectCampaignStore';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const CMP_A = '00000000-0000-4000-8000-0000000000f1';

const campaignRow = (over: Row = {}): Row => ({
  id: CMP_A, organization_id: ORG, name: 'Q4 Enterprise UK', description: null,
  status: 'draft', created_at: 't', updated_at: 't', ...over,
});

beforeEach(() => { db.ops = []; db.rows = {}; db.error = null; });

// ── The campaign is an identity ─────────────────────────────────────────────

describe('014 — a campaign is a tenant-owned identity and nothing more', () => {
  it('(1) creates a campaign', async () => {
    const c = await createProspectCampaign({ organizationId: ORG, name: 'Q4 Enterprise UK' });
    expect(c).toMatchObject({ organizationId: ORG, name: 'Q4 Enterprise UK', description: null });
    // The DATABASE owns the default. The store must not send one.
    const insert = db.ops.find((o) => o.op === 'insert');
    expect(insert?.table).toBe(PROSPECT_CAMPAIGNS_TABLE);
    expect('status' in (insert?.payload ?? {})).toBe(false);
    expect(c.status).toBe('draft');
  });

  it('THE PAYLOAD CARRIES NO LIST, ICP, OFFERING, PROSPECT, PERSON OR TASK', async () => {
    await createProspectCampaign({ organizationId: ORG, name: 'C', description: 'd' });
    const insert = db.ops.find((o) => o.op === 'insert');
    expect(Object.keys(insert?.payload ?? {}).sort())
      .toEqual(['description', 'name', 'organization_id']);
    for (const banned of [
      'list_id', 'icp_id', 'icp_version', 'offering_id', 'prospect_id', 'person_id',
      'lead_id', 'task_id', 'plan_task_id', 'audience_id', 'campaign_id',
      'min_score', 'max_score', 'score', 'readiness',
    ]) {
      expect(insert?.payload).not.toHaveProperty(banned);
    }
  });

  it('refuses a blank name and a tenant-less call', async () => {
    await expect(createProspectCampaign({ organizationId: ORG, name: '   ' }))
      .rejects.toMatchObject({ code: 'invalid_name' });
    await expect(createProspectCampaign({ organizationId: 'nope', name: 'C' }))
      .rejects.toMatchObject({ code: 'tenant_required' });
  });

  it('(7) refuses a status outside the vocabulary, on create and on update', async () => {
    await expect(createProspectCampaign({
      organizationId: ORG, name: 'C', status: 'paused' as never,
    })).rejects.toMatchObject({ code: 'invalid_status' });

    db.rows[PROSPECT_CAMPAIGNS_TABLE] = [campaignRow()];
    await expect(updateProspectCampaign({
      organizationId: ORG, campaignId: CMP_A, status: 'completed' as never,
    })).rejects.toMatchObject({ code: 'invalid_status' });
  });

  it('the vocabulary is exactly draft | active | archived', () => {
    expect([...PROSPECT_CAMPAIGN_STATUSES]).toEqual(['draft', 'active', 'archived']);
    // `paused`/`completed` exist on gtm_campaigns and are deliberately absent.
    expect(PROSPECT_CAMPAIGN_STATUSES).not.toContain('paused');
    expect(PROSPECT_CAMPAIGN_STATUSES).not.toContain('completed');
  });

  it('accepts an explicit status at creation when the caller means it', async () => {
    const c = await createProspectCampaign({ organizationId: ORG, name: 'C', status: 'active' });
    expect(c.status).toBe('active');
    expect(db.ops.find((o) => o.op === 'insert')?.payload.status).toBe('active');
  });

  it('(2) retrieves a campaign, and (5) another tenant’s is null rather than an error', async () => {
    db.rows[PROSPECT_CAMPAIGNS_TABLE] = [campaignRow()];
    expect(await getProspectCampaign(ORG, CMP_A)).toMatchObject({ id: CMP_A, organizationId: ORG });
    // The route maps null to 404, so "not yours" and "does not exist" are one answer.
    expect(await getProspectCampaign(ORG_B, CMP_A)).toBeNull();
  });

  it('(3) lists this tenant’s campaigns, and can narrow by status', async () => {
    db.rows[PROSPECT_CAMPAIGNS_TABLE] = [
      campaignRow(),
      campaignRow({ id: 'c2', status: 'active' }),
      campaignRow({ id: 'c3', organization_id: ORG_B }),
    ];
    const mine = await listProspectCampaigns(ORG);
    expect(mine.map((c) => c.id).sort()).toEqual(['c2', CMP_A].sort());
    const active = await listProspectCampaigns(ORG, { status: 'active' });
    expect(active.map((c) => c.id)).toEqual(['c2']);
    await expect(listProspectCampaigns(ORG, { status: 'paused' as never }))
      .rejects.toMatchObject({ code: 'invalid_status' });
  });

  it('(4) updates in place, and a field not named is NOT touched', async () => {
    db.rows[PROSPECT_CAMPAIGNS_TABLE] = [campaignRow({ description: 'keep me' })];
    const r = await updateProspectCampaign({ organizationId: ORG, campaignId: CMP_A, name: 'Renamed' });
    expect(r.changed).toBe(true);
    expect(r.campaign).toMatchObject({ name: 'Renamed', description: 'keep me' });
    const patch = db.ops.find((o) => o.op === 'update')?.payload ?? {};
    expect(Object.keys(patch)).toEqual(['name']);
    // The tenant is never in a patch — the trigger would refuse it and this never tries.
    expect(patch).not.toHaveProperty('organization_id');
  });

  it('an empty patch is refused rather than issuing a no-op write', async () => {
    await expect(updateProspectCampaign({ organizationId: ORG, campaignId: CMP_A }))
      .rejects.toMatchObject({ code: 'empty_patch' });
    expect(db.ops.filter((o) => o.op === 'update')).toHaveLength(0);
  });

  it('a status transition is a status change, and there is NO delete', async () => {
    db.rows[PROSPECT_CAMPAIGNS_TABLE] = [campaignRow()];
    const r = await setProspectCampaignStatus(ORG, CMP_A, 'archived');
    expect(r.changed).toBe(true);
    expect(r.campaign?.status).toBe('archived');
    // The row survives archiving — a future outcome must still be able to name it.
    expect(db.rows[PROSPECT_CAMPAIGNS_TABLE]).toHaveLength(1);
    const store = require('../../services/prospectCampaigns/prospectCampaignStore');
    expect(Object.keys(store).filter((k) => /delete|remove|destroy|purge/i.test(k))).toEqual([]);
  });

  it('updating something in another tenant reports changed: false, never an error', async () => {
    db.rows[PROSPECT_CAMPAIGNS_TABLE] = [campaignRow()];
    const r = await updateProspectCampaign({ organizationId: ORG_B, campaignId: CMP_A, name: 'X' });
    expect(r).toEqual({ campaign: null, changed: false });
    expect(db.rows[PROSPECT_CAMPAIGNS_TABLE][0].name).toBe('Q4 Enterprise UK');
  });

  it('(8) campaign identity is stable: the id is never written or patched', async () => {
    db.rows[PROSPECT_CAMPAIGNS_TABLE] = [campaignRow()];
    await createProspectCampaign({ organizationId: ORG, name: 'C' });
    await updateProspectCampaign({ organizationId: ORG, campaignId: CMP_A, name: 'Y' });
    await setProspectCampaignStatus(ORG, CMP_A, 'active');
    for (const op of db.ops) {
      expect(op.payload).not.toHaveProperty('id');
      if (op.op === 'update') expect(op.payload).not.toHaveProperty('organization_id');
    }
  });

  it('translates the database’s own refusals into stated errors', async () => {
    db.error = { code: '23514', message: 'violates check constraint "prospect_campaigns_status_valid"' };
    await expect(createProspectCampaign({ organizationId: ORG, name: 'C' }))
      .rejects.toMatchObject({ code: 'invalid_status' });

    db.error = { code: '23514', message: 'prospect_campaigns.organization_id is immutable (campaign x)' };
    db.rows[PROSPECT_CAMPAIGNS_TABLE] = [campaignRow()];
    await expect(updateProspectCampaign({ organizationId: ORG, campaignId: CMP_A, name: 'Z' }))
      .rejects.toMatchObject({ code: 'tenant_immutable' });

    db.error = { code: '23503', message: 'violates foreign key constraint "prospect_campaigns_organization_id_fkey"' };
    await expect(createProspectCampaign({ organizationId: ORG, name: 'C' }))
      .rejects.toMatchObject({ code: 'unknown_tenant' });
  });
});

// ── Tenant scoping ──────────────────────────────────────────────────────────

describe('014 — every statement carries its tenant', () => {
  it('(5) organization_id is the FIRST predicate on every scoped read and write', async () => {
    db.rows[PROSPECT_CAMPAIGNS_TABLE] = [campaignRow()];
    await getProspectCampaign(ORG, CMP_A);
    await listProspectCampaigns(ORG);
    await updateProspectCampaign({ organizationId: ORG, campaignId: CMP_A, name: 'X' });
    await setProspectCampaignStatus(ORG, CMP_A, 'active');
    const scoped = db.ops.filter((o) => o.op !== 'insert');
    expect(scoped.length).toBeGreaterThan(0);
    for (const op of scoped) expect(op.filters[0]).toEqual(['organization_id', ORG]);
  });

  it('reads never cross the tenant boundary, even for the SAME campaign id', async () => {
    db.rows[PROSPECT_CAMPAIGNS_TABLE] = [
      campaignRow(),
      campaignRow({ id: CMP_A, organization_id: ORG_B, name: 'theirs' }),
    ];
    expect((await getProspectCampaign(ORG, CMP_A))?.name).toBe('Q4 Enterprise UK');
    expect((await getProspectCampaign(ORG_B, CMP_A))?.name).toBe('theirs');
    expect(await listProspectCampaigns(ORG)).toHaveLength(1);
  });

  it('every entry point refuses a tenant-less call', async () => {
    for (const call of [
      () => getProspectCampaign('', CMP_A),
      () => listProspectCampaigns(''),
      () => updateProspectCampaign({ organizationId: '', campaignId: CMP_A, name: 'X' }),
      () => setProspectCampaignStatus('', CMP_A, 'active'),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'tenant_required' });
    }
  });
});

// ── CREATION IS INERT ───────────────────────────────────────────────────────

describe('014 — creating a campaign does nothing else at all', () => {
  const read = (rel: string): string =>
    require('fs').readFileSync(require('path').join(process.cwd(), rel), 'utf8') as string;
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const STORE = 'backend/services/prospectCampaigns/prospectCampaignStore.ts';
  const ROUTES = ['pages/api/prospect-campaigns/index.ts', 'pages/api/prospect-campaigns/[id].ts'];

  it('(11,12,13) the ONLY table any write touches is prospect_campaigns', async () => {
    db.rows[PROSPECT_CAMPAIGNS_TABLE] = [campaignRow()];
    await createProspectCampaign({ organizationId: ORG, name: 'C' });
    await updateProspectCampaign({ organizationId: ORG, campaignId: CMP_A, name: 'X' });
    await setProspectCampaignStatus(ORG, CMP_A, 'archived');
    expect([...new Set(db.ops.map((o) => o.table))]).toEqual([PROSPECT_CAMPAIGNS_TABLE]);
  });

  it('(9,10) it names NEITHER existing campaign table, and no legacy audience', () => {
    const src = code(read(STORE)) + ROUTES.map((r) => code(read(r))).join('\n');
    for (const banned of [
      /ownedDbTable\(\s*['"]campaigns['"]\s*\)/,
      /ownedDbTable\(\s*['"]gtm_campaigns['"]\s*\)/,
      /\bgtm_campaigns\b/, /\baudiences\b/, /\baudience_memberships\b/,
      /\bentity_type\b/, /\bentity_id\b/,
      /\bleadKeyFor\b/, /\bCanonicalLeadView\b/, /\bsearchLeads\b/,
      /\bcampaignService\b/, /\baudienceService\b/,
    ]) {
      expect(src).not.toMatch(banned);
    }
    // `campaigns` as a bare word must not appear as a table reference either.
    expect(src).not.toMatch(/['"]campaigns['"]/);
  });

  it('(18) it reaches no list, prospect, person, task, outcome or governance module', () => {
    const src = code(read(STORE)) + ROUTES.map((r) => code(read(r))).join('\n');
    for (const banned of [
      /prospect_lists/, /prospect_list_memberships/, /prospectListStore/,
      /canonical_leads/, /unified_persons/, /outreach_tasks/, /outreach_outcomes/,
      /prospect_icp_qualifications/, /prospect_score_evaluations/, /\bofferings\b/,
      /mayContact/, /contact_governance/, /dispatch/i, /enqueue/i,
      /scoreEvaluation/, /evaluateIcp/, /recommendStrategy/,
    ]) {
      expect(src).not.toMatch(banned);
    }
  });

  it('(17) no score threshold, readiness or temperature was introduced', () => {
    const src = code(read(STORE)) + ROUTES.map((r) => code(read(r))).join('\n');
    for (const banned of [/minScore/, /maxScore/, /threshold/i, /\bhot\b/, /\bwarm\b/, /\bcold\b/, /readiness/i]) {
      expect(src).not.toMatch(banned);
    }
  });

  it('the store imports exactly ONE module — the database surface', () => {
    const src = code(read(STORE));
    const imports = [...src.matchAll(/^import\s+[\s\S]*?from\s+'([^']+)';/gm)].map((m) => m[1]);
    expect(imports).toEqual(['../../db/writeOwner']);
  });

  it('(6) prospectCampaignStore is the SOLE writer of prospect_campaigns', () => {
    const { execSync } = require('child_process') as typeof import('child_process');
    const hits = execSync(
      `grep -rl "ownedDbTable(PROSPECT_CAMPAIGNS_TABLE)\\|ownedDbTable('prospect_campaigns')" backend pages lib || true`,
      { encoding: 'utf8' },
    ).split('\n').filter(Boolean).filter((f) => !/\.test\.tsx?$/.test(f));
    expect(hits).toEqual(['backend/services/prospectCampaigns/prospectCampaignStore.ts']);
  });
});

// ── The schema, and the boundaries it must not cross ────────────────────────

describe('014 — the migration', () => {
  const read = (rel: string): string =>
    require('fs').readFileSync(require('path').join(process.cwd(), rel), 'utf8') as string;
  /** Strips `--` comments AND `COMMENT ON … IS '…'` literals, which name boundaries on purpose. */
  const sql = (s: string) => s.replace(/^\s*--.*$/gm, '').replace(/COMMENT ON [\s\S]*?';/g, '');
  const MIGRATION = 'supabase/migrations/20270111100000_pi_prospect_campaigns.sql';

  it('creates exactly ONE table and alters no existing one', () => {
    const body = sql(read(MIGRATION));
    expect([...body.matchAll(/CREATE TABLE/gi)]).toHaveLength(1);
    expect(body).toMatch(/CREATE TABLE IF NOT EXISTS public\.prospect_campaigns/);
    // The only ALTER is enabling RLS on the table it just created.
    const alters = [...body.matchAll(/ALTER TABLE\s+(?:public\.)?(\w+)([^;]*)/gi)];
    for (const [, table, rest] of alters) {
      expect(table).toBe('prospect_campaigns');
      expect(rest).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    }
  });

  it('(15) carries NO offering_id — and no list, ICP, prospect or task column', () => {
    const body = sql(read(MIGRATION));
    const create = /CREATE TABLE IF NOT EXISTS public\.prospect_campaigns \(([\s\S]*?)\n\);/.exec(body);
    expect(create).not.toBeNull();
    const columns = create![1];
    for (const banned of [
      /\boffering_id\b/, /\blist_id\b/, /\bicp_id\b/, /\bicp_version\b/,
      /\bprospect_id\b/, /\bperson_id\b/, /\blead_id\b/, /\btask_id\b/,
      /\baudience_id\b/, /\bcampaign_id\b/,
    ]) {
      expect(columns).not.toMatch(banned);
    }
  });

  it('publishes (id, organization_id) for the FUTURE campaign target', () => {
    const body = sql(read(MIGRATION));
    expect(body).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_campaigns_id_org\s+ON public\.prospect_campaigns \(id, organization_id\)/,
    );
  });

  it('(13) does NOT create the target table — that is the next workstream', () => {
    const body = sql(read(MIGRATION));
    expect(body).not.toMatch(/campaign_targets/);
  });

  it('uses the uuid tenant model, never company_id text', () => {
    const body = sql(read(MIGRATION));
    expect(body).toMatch(/organization_id\s+uuid NOT NULL/);
    expect(body).not.toMatch(/company_id\s+text/);
    expect(body).toMatch(
      /FOREIGN KEY \(organization_id\) REFERENCES public\.companies \(id\) ON DELETE CASCADE/,
    );
  });

  it('its ONLY foreign key is to the tenant root', () => {
    const body = sql(read(MIGRATION));
    const fks = [...body.matchAll(/FOREIGN KEY[\s\S]*?REFERENCES\s+(public\.\w+)/gi)].map((m) => m[1]);
    expect(fks).toEqual(['public.companies']);
  });

  it('(9,10) it references NEITHER campaigns nor gtm_campaigns as a table', () => {
    const body = sql(read(MIGRATION));
    expect(body).not.toMatch(/ALTER TABLE\s+(public\.)?campaigns/i);
    expect(body).not.toMatch(/ALTER TABLE\s+(public\.)?gtm_campaigns/i);
    expect(body).not.toMatch(/REFERENCES\s+public\.campaigns/i);
    expect(body).not.toMatch(/REFERENCES\s+public\.gtm_campaigns/i);
    expect(body).not.toMatch(/prospect_campaign_id/);
  });

  it('enables RLS with the service-role policy the PI tables use', () => {
    const body = sql(read(MIGRATION));
    expect(body).toMatch(/ALTER TABLE public\.prospect_campaigns ENABLE ROW LEVEL SECURITY/);
    expect(body).toMatch(/CREATE POLICY prospect_campaigns_service_role/);
    expect(body).toMatch(/auth\.role\(\) = 'service_role'/);
  });

  it('guards the tenant against being re-pointed', () => {
    const body = sql(read(MIGRATION));
    expect(body).toMatch(/organization_id IS DISTINCT FROM OLD\.organization_id/);
    expect(body).toMatch(/CREATE TRIGGER trg_prospect_campaigns_guard/);
  });

  it('(19) depends only on `companies`, so it replays without the 2026110x chain', () => {
    const body = sql(read(MIGRATION));
    for (const earlier of [
      /prospect_icps/, /\boffering_icps\b/, /\bofferings\b/,
      /prospect_lists/, /prospect_score_evaluations/, /prospect_icp_qualifications/,
    ]) {
      expect(body).not.toMatch(earlier);
    }
    expect(body).toMatch(/to_regclass\('public\.companies'\) IS NULL/);
  });

  it('exactly ONE migration owns prospect_campaigns', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const dir = path.join(process.cwd(), 'supabase/migrations');
    // The table NAME, word-bounded: `[^;]*prospect_campaigns` also matched the
    // prospect_campaign_lists / prospect_campaign_targets tables of 20261231 and
    // any table that merely REFERENCES prospect_campaigns (2026-10-28).
    const CREATES = /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(public\.)?prospect_campaigns\b/i;
    const owners = fs.readdirSync(dir)
      .filter((f: string) => f.endsWith('.sql'))
      .filter((f: string) => CREATES.test(fs.readFileSync(path.join(dir, f), 'utf8') as string))
      .sort();
    expect(owners).toEqual(['20270111100000_pi_prospect_campaigns.sql']);
  });

  it('it is ordered after the PI chain it must not depend on', () => {
    // A NAMED set, not "it is the newest". The earlier form asserted this was the
    // last PI migration, which became false the moment 016 legitimately added one
    // — a guard on other workstreams' work rather than on 014's own ordering.
    const MINE = '20270111100000_pi_prospect_campaigns.sql';
    for (const earlier of [
      '20261101000000_pi_score_evaluation_icp_identity.sql',
      '20261102000000_pi_prospect_icp_qualification.sql',
      '20261103000000_pi_offerings.sql',
      '20261104000000_pi_prospect_lists.sql',
      '20261105000000_pi_prospect_list_curation.sql',
    ]) {
      expect(earlier < MINE).toBe(true);
    }
  });
});

// ── The domains 014 must not touch ──────────────────────────────────────────

describe('014 — isolation, proven by content', () => {
  const read = (rel: string): string =>
    require('fs').readFileSync(require('path').join(process.cwd(), rel), 'utf8') as string;
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('the content and GTM campaign domains carry NO prospect-campaign coupling', () => {
    // CONTENT, not `git status`: what is durably checkable is that 014's domain
    // did not leak into theirs.
    const files = [
      'backend/services/campaign/campaignService.ts',
      'backend/services/audience/audienceService.ts',
      'pages/api/lead-intelligence/campaigns.ts',
      'pages/api/lead-intelligence/audiences.ts',
    ].filter((f) => require('fs').existsSync(require('path').join(process.cwd(), f)));

    // Non-vacuous: a guard that scanned nothing would pass by matching nothing.
    expect(files.length).toBe(4);
    for (const f of files) {
      const src = code(read(f));
      expect(src).not.toMatch(/prospect_campaigns/);
      expect(src).not.toMatch(/prospectCampaignStore/);
      expect(src).not.toMatch(/prospect_campaign_id/);
    }
  });

  it('the outreach execution and list domains carry NO campaign coupling', () => {
    const files = [
      'backend/services/leadOutreachExecution/materialization.ts',
      'backend/services/leadOutreachExecution/storage.ts',
      'backend/services/leadOutreachExecution/types.ts',
      'backend/services/prospectLists/prospectListStore.ts',
      'backend/services/prospectLists/listEvaluator.ts',
    ].filter((f) => require('fs').existsSync(require('path').join(process.cwd(), f)));
    // The three WS-3 files are always present; the two list files land with the
    // lists slice (LISTS-001) and are checked here as soon as they exist.
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.slice(0, 3).every((f) => f.startsWith('backend/services/leadOutreachExecution/'))).toBe(true);
    for (const f of files) {
      const src = code(read(f));
      expect(src).not.toMatch(/prospect_campaigns/);
      expect(src).not.toMatch(/prospectCampaignStore/);
      expect(src).not.toMatch(/campaignId/);
    }
  });

  it('(14) the outreach task identity is UNCHANGED', () => {
    // The 013 collision stays exactly as documented: 014 may not touch it.
    const migration = read('supabase/migrations/20260910000000_ws3_lead_outreach_execution.sql');
    expect(migration).toMatch(
      /CONSTRAINT outreach_tasks_identity_unique UNIQUE \(company_id, lead_id, plan_task_id\)/,
    );
    // And no migration in this workstream's range alters that table.
    const body = read('supabase/migrations/20270111100000_pi_prospect_campaigns.sql');
    expect(body).not.toMatch(/ALTER TABLE\s+(public\.)?outreach_/i);
    // plan_task_id generation is untouched.
    expect(read('backend/services/automationExecution/taskGenerator.ts'))
      .toMatch(/id: `task-\$\{order\}-\$\{slug\(action\)\}`/);
  });

  it('(15) the outcome schema is UNCHANGED', () => {
    const migration = read('supabase/migrations/20260910000000_ws3_lead_outreach_execution.sql');
    expect(migration).toMatch(
      /CONSTRAINT outreach_outcomes_idempotent UNIQUE \(company_id, task_id, outcome_type, occurred_at\)/,
    );
  });
});

// ── Routes ──────────────────────────────────────────────────────────────────

describe('014 — the routes follow the established convention', () => {
  const read = (rel: string): string =>
    require('fs').readFileSync(require('path').join(process.cwd(), rel), 'utf8') as string;
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const ROUTES = ['pages/api/prospect-campaigns/index.ts', 'pages/api/prospect-campaigns/[id].ts'];

  it('(6) every route authenticates, verifies the tenant and gates on a capability', () => {
    for (const r of ROUTES) {
      const src = code(read(r));
      expect(src).toMatch(/enforceCompanyAccess\(\{ req, res, companyId \}\)/);
      expect(src).toMatch(/if \(!access\) return;/);
      expect(src).toMatch(/requireCapability\(req, res, \{/);
      expect(src).toMatch(/capability: PROSPECT_ICP_MANAGE/);
      expect(src).toMatch(/if \(guard\.ok !== true\) return;/);
    }
  });

  it('it uses PROSPECT_ICP_MANAGE and NOT the content domain’s campaign.* grants', () => {
    for (const r of ROUTES) {
      const src = code(read(r));
      expect(src).not.toMatch(/CAMPAIGN_EXECUTE|CAMPAIGN_VIEW|CAMPAIGN_DELETE/);
      expect(src).not.toMatch(/campaign\.execute|campaign\.view|campaign\.delete/);
    }
  });

  it('no new capability was added to the frozen registry', () => {
    const caps = read('shared/contracts/security/SecurityCapabilities.ts');
    expect(caps).not.toMatch(/PROSPECT_CAMPAIGN/);
    expect(caps).not.toMatch(/prospect\.campaign/);
  });

  it('(6) every route operates on the VERIFIED tenant, never the body’s', () => {
    for (const r of ROUTES) {
      const src = code(read(r));
      expect(src).toMatch(/organizationId: companyId/);
      // The only body read of company_id is the fallback that is then verified.
      const bodyCompanyReads = [...src.matchAll(/\(req\.body \?\? \{\}\)\.company_id/g)];
      expect(bodyCompanyReads.length).toBe(1);
    }
  });

  it('no database read happens before authorization', () => {
    for (const r of ROUTES) {
      const src = code(read(r));
      const auth = src.indexOf('requireCapability');
      const firstStoreCall = Math.min(
        ...['getProspectCampaign(', 'listProspectCampaigns(', 'createProspectCampaign(',
          'updateProspectCampaign(', 'setProspectCampaignStatus(']
          .map((f) => { const i = src.indexOf(`await ${f}`); return i === -1 ? Number.MAX_SAFE_INTEGER : i; }),
      );
      expect(auth).toBeGreaterThan(-1);
      expect(firstStoreCall).toBeGreaterThan(auth);
    }
  });

  it('(7) there is no DELETE route, and no outreach/task/outcome route', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const dir = path.join(process.cwd(), 'pages/api/prospect-campaigns');
    const entries = fs.readdirSync(dir).sort();
    // The CAMPAIGN RESOURCE's own routes, which is what 014 owns. The earlier form
    // asserted the directory contained nothing else, which became false when 016
    // legitimately added the Campaign × List edge underneath it.
    expect(entries).toContain('index.ts');
    expect(entries).toContain('[id].ts');
    // 014 forbids an outreach, task, outcome, prospect or member route — by name,
    // at any depth.
    //
    // `targets.ts` WAS in this set, and no longer is. 014 forbade it because at
    // 014's time a Campaign Target did not exist and could not be built — 015
    // recorded why. PI-CAMPAIGN-TARGET-029 implemented it under an explicit
    // programme decision, so the premise of that one clause expired; it is not
    // being weakened because it became inconvenient. Everything 014 forbade for a
    // reason that still holds stays forbidden, and the EXECUTION dimension —
    // outreach, task, outcome — is the part that matters and is untouched.
    const walk = (rel: string): string[] => {
      const abs = path.join(process.cwd(), rel);
      if (fs.statSync(abs).isFile()) return [rel];
      return fs.readdirSync(abs).flatMap((e: string) => walk(`${rel}/${e}`));
    };
    const all = walk('pages/api/prospect-campaigns');
    expect(all.length).toBeGreaterThan(1);
    for (const f of all) {
      expect(f).not.toMatch(/\/(outreach|tasks?|outcomes?|prospects?|members?)\.ts$/);
      expect(f).not.toMatch(/\/(targets?|outreach|tasks?|outcomes?|prospects?)\//);
    }
    // And the ONE Target route that is now permitted is 029's, read-only. A second
    // one, or a writable one, is still a finding.
    const targetRoutes = all.filter((f) => /targets?\.ts$/.test(f));
    // PORT 2026-10-28: 029's read-only Target route lands with the lists/targets
    // slice; until then there is NO Target route at all.
    expect(targetRoutes).toEqual([]);
    for (const r of ROUTES) {
      const src = code(read(r));
      expect(src).not.toMatch(/'DELETE'/);
      expect(src).toMatch(/Allow', '(GET, POST|GET, PATCH)'/);
    }
  });

  it('the collection route accepts NO targeting parameter', () => {
    const src = code(read('pages/api/prospect-campaigns/index.ts'));
    for (const banned of [/body\.listId/, /body\.icpId/, /body\.offeringId/, /body\.prospectId/, /body\.audienceId/]) {
      expect(src).not.toMatch(banned);
    }
  });
});

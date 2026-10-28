/**
 * ORCHESTRATION TARGETING — static contract of the migration, its rollback and
 * the routes that expose it.
 *
 * Reads files only. It proves what the SQL and route SOURCE say; it does not
 * prove the SQL applies (no database is reached — see the report).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, 'supabase/migrations');
const MINE = '20261231000000_orchestration_campaign_targeting.sql';
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sql = read(`supabase/migrations/${MINE}`);
const rollback = read('supabase/migrations/rollbacks/orchestration_campaign_targeting_rollback.sql');
const migrations = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
const sha = (rel: string): string =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 16);

/** The body of `CREATE TABLE ... <name> ( ... );`. */
function tableBody(source: string, name: string): string {
  const start = source.search(new RegExp(`CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?public\\.${name}\\s*\\(`, 'i'));
  if (start < 0) throw new Error(`no CREATE TABLE ${name}`);
  return source.slice(start, source.indexOf('\n);', start));
}

describe('20261231000000 — depends on the canonical tables, competes with none', () => {
  it('the canonical lists migration is the LISTS-001 file, byte-identical', () => {
    expect(sha('supabase/migrations/20261127000000_pi_prospect_lists.sql')).toBe('01315600d26291f7');
  });

  it('is ordered after everything it requires, and checks for each before acting', () => {
    for (const dep of [
      '20261012000000_d1_tenant_icp_model.sql',
      '20261031000000_pi_score_evaluations.sql',
      '20261127000000_pi_prospect_lists.sql',
      '20261226000000_pi_prospect_campaigns.sql',
      '20261228000000_pi_execution_instances.sql',
    ]) {
      expect(migrations).toContain(dep);
      expect(dep < MINE).toBe(true);
    }
    const pre = sql.slice(0, sql.indexOf('-- 1. An OPTIONAL ICP'));
    for (const t of ['prospect_lists', 'prospect_list_members', 'prospect_campaigns', 'execution_instances', 'prospect_icp_versions', 'prospect_score_evaluations']) {
      expect(pre).toMatch(new RegExp(`to_regclass\\('public\\.${t}'\\) IS NULL`));
    }
  });

  it('every companion tenant key it requires is created by an EARLIER migration', () => {
    const keys = [...sql.matchAll(/to_regclass\('public\.((?:uq|idx)_[a-z_]+)'\) IS NULL/g)].map((m) => m[1])
      .filter((k) => !k.startsWith('uq_prospect_campaign_targets'));
    expect(keys.length).toBeGreaterThanOrEqual(6);
    for (const key of keys) {
      const owners = migrations.filter((f) => f < MINE
        && new RegExp(`(INDEX\\s+(IF\\s+NOT\\s+EXISTS\\s+)?|CONSTRAINT\\s+)${key}\\b`).test(fs.readFileSync(path.join(MIG_DIR, f), 'utf8')));
      expect({ key, owners: owners.length > 0 }).toEqual({ key, owners: true });
    }
  });

  it('creates no competing list, membership, campaign, contact, ICP or outcome store', () => {
    const created = [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-z_]+)/gi)].map((m) => m[1]).sort();
    expect(created).toEqual(['prospect_campaign_lists', 'prospect_campaign_targets']);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+(IF\s+EXISTS\s+)?public\.prospect_list_members\b/i);
    expect(sql).toMatch(/to_regclass\('public\.prospect_list_memberships'\) IS NOT NULL/);
    // The parked pi-consol lists migrations are not ported.
    expect(migrations.filter((f) => /^2026110[45]/.test(f))).toEqual([]);
  });

  it('exactly ONE migration owns each new table', () => {
    for (const t of ['prospect_campaign_lists', 'prospect_campaign_targets']) {
      const re = new RegExp(`CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?(public\\.)?${t}\\b`, 'i');
      expect(migrations.filter((f) => re.test(fs.readFileSync(path.join(MIG_DIR, f), 'utf8')))).toEqual([MINE]);
    }
  });
});

describe('20261231000000 — ICP association, tenant safety and immutability', () => {
  it('a list ICP is optional and tenant-bound', () => {
    expect(sql).toMatch(/ALTER TABLE public\.prospect_lists ADD COLUMN IF NOT EXISTS icp_id uuid;/);
    expect(sql).toMatch(/prospect_lists_icp_tenant_fk\s+FOREIGN KEY \(icp_id, organization_id\)\s+REFERENCES public\.prospect_icps \(id, organization_id\)/);
  });

  it('an ICP campaign names exactly one version of its own tenant; a manual one names none', () => {
    expect(sql).toMatch(/targeting_mode = 'manual' AND icp_id IS NULL AND icp_version IS NULL AND min_icp_score IS NULL/);
    expect(sql).toMatch(/targeting_mode = 'icp' AND icp_id IS NOT NULL AND icp_version IS NOT NULL/);
    expect(sql).toMatch(/FOREIGN KEY \(organization_id, icp_id, icp_version\)\s+REFERENCES public\.prospect_icp_versions \(organization_id, icp_id, version\)/);
    expect(sql).toMatch(/min_icp_score >= 0 AND min_icp_score <= 1/);
  });

  it('the guard refuses an unratified version and freezes targeting once targets exist — with the markers the store maps', () => {
    expect(sql).toMatch(/IF v_status IS DISTINCT FROM 'ratified' THEN\s+RAISE EXCEPTION 'campaign_icp_not_ratified/);
    expect(sql).toMatch(/RAISE EXCEPTION 'campaign_targeting_locked/);
    const store = read('backend/services/prospectCampaigns/prospectCampaignStore.ts');
    expect(store).toMatch(/message\.includes\('campaign_icp_not_ratified'\)/);
    expect(store).toMatch(/message\.includes\('campaign_targeting_locked'\)/);
  });

  it('targets carry six foreign keys: erasure cascades from the person and tenant; history is NO ACTION', () => {
    const body = tableBody(sql, 'prospect_campaign_targets');
    expect((body.match(/FOREIGN KEY/g) ?? []).length).toBe(6);
    expect(body).toMatch(/\(prospect_id, organization_id\)\s+REFERENCES public\.canonical_leads \(id, company_id\) ON DELETE CASCADE/);
    expect(body).toMatch(/REFERENCES public\.companies \(id\) ON DELETE CASCADE/);
    for (const ref of ['prospect_campaigns \\(id, organization_id\\)', 'prospect_lists \\(id, organization_id\\)',
      'prospect_icp_versions \\(organization_id, icp_id, version\\)', 'prospect_score_evaluations \\(id, organization_id\\)']) {
      expect(body).toMatch(new RegExp(`REFERENCES public\\.${ref} ON DELETE NO ACTION`));
    }
    expect(body).toMatch(/CHECK \(selection_event_key ~ '\^\(human\|derived\):\[A-Za-z0-9\._-\]\{1,200\}\$'\)/);
    expect(body).toMatch(/origin = 'human' AND actor_user_id IS NOT NULL/);
  });

  it('selection is idempotent per occurrence, and a target is never updated', () => {
    expect(sql).toMatch(/uq_prospect_campaign_targets_selection\s+ON public\.prospect_campaign_targets \(organization_id, campaign_id, list_id, prospect_id, selection_event_key\)/);
    expect(sql).toMatch(/BEFORE UPDATE ON public\.prospect_campaign_targets/);
    expect(read('backend/services/prospectCampaigns/campaignTargetStore.ts')).not.toMatch(/\.(update|delete|upsert)\(/);
  });

  it('adds the foreign key 20261228000000 deferred, and asserts the resulting counts', () => {
    expect(read('supabase/migrations/20261228000000_pi_execution_instances.sql')).toMatch(/ei_create:targets_not_installed/);
    expect(sql).toMatch(/execution_instances_target_tenant_fk\s+FOREIGN KEY \(target_id, organization_id\)\s+REFERENCES public\.prospect_campaign_targets \(id, organization_id\)/);
    expect(sql).toMatch(/IF n <> 5 THEN/);
    expect(sql).toMatch(/IF n <> 6 THEN/);
    expect(read('backend/services/executionInstances/executionInstanceStore.ts')).toMatch(/'ei_create:targets_not_installed',[^\n]*'targets_not_installed'\]/);
  });

  it('is re-runnable: every constraint, trigger and policy is guarded', () => {
    const constraints = (sql.match(/ADD CONSTRAINT (\w+)/g) ?? []).map((s) => s.split(' ')[2]);
    for (const c of constraints) expect(sql).toMatch(new RegExp(`conname = '${c}'`));
    for (const m of sql.matchAll(/CREATE TRIGGER (\w+)/g)) expect(sql).toMatch(new RegExp(`DROP TRIGGER IF EXISTS ${m[1]}\\b`));
    for (const m of sql.matchAll(/CREATE POLICY (\w+)/g)) expect(sql).toMatch(new RegExp(`DROP POLICY IF EXISTS ${m[1]}\\b`));
    expect(sql).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
    expect(sql).toMatch(/REVOKE ALL ON public\.prospect_campaign_targets FROM anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON public\.prospect_campaign_lists FROM anon, authenticated/);
  });
});

// Found by real-PostgreSQL verification (2026-10-28); see the commit for detail.
describe('agreement between the SQL and the application', () => {
  it('the publish function accepts exactly the channels the validator does', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { WORKFLOW_STEP_CHANNELS } = require('../../services/workflows/workflowStore') as { WORKFLOW_STEP_CHANNELS: readonly string[] };
    // The function is defined by 20261227000000 and REPLACED by later migrations
    // (20261231000004 adds `social_post`); the applied vocabulary is the LATEST one.
    const definers = migrations.filter((f) =>
      /CREATE OR REPLACE FUNCTION public\.publish_workflow_version\(/.test(fs.readFileSync(path.join(MIG_DIR, f), 'utf8')));
    expect(definers[0]).toBe('20261227000000_pi_workflow_definitions.sql');
    const wf = read(`supabase/migrations/${definers[definers.length - 1]}`);
    const m = /\(s\.value ->> 'channel'\) NOT IN \(([^)]*)\)/.exec(wf);
    expect(m).not.toBeNull();
    const sqlChannels = [...(m as RegExpExecArray)[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(sqlChannels).toEqual([...WORKFLOW_STEP_CHANNELS].sort());
  });

  it('a missing or foreign ICP version is "not found" (23503), decided BEFORE ratification', () => {
    const guard = sql.slice(sql.indexOf('FUNCTION public.prospect_campaigns_targeting_guard'), sql.indexOf('CREATE TRIGGER trg_prospect_campaigns_targeting_guard'));
    const notFound = guard.indexOf('IF NOT FOUND THEN');
    expect(notFound).toBeGreaterThan(0);
    expect(guard.slice(notFound, notFound + 200)).toMatch(/campaign_icp_version_not_found[\s\S]*ERRCODE = '23503'/);
    expect(notFound).toBeLessThan(guard.indexOf("IS DISTINCT FROM 'ratified'"));
  });

  it('earlier postconditions accept exactly what 20261231 adds, so a re-run after it holds', () => {
    const c = read('supabase/migrations/20261226000000_pi_prospect_campaigns.sql');
    expect(c).toMatch(/created_at,description,icp_id,icp_version,id,min_icp_score,name,organization_id,status,targeting_mode,updated_at'\s+AND EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'prospect_campaigns_targeting_mode_valid'\)/);
    expect(c).toMatch(/'prospect_campaigns_icp_version_tenant_fk,prospect_campaigns_organization_id_fkey'/);
    const i = read('supabase/migrations/20261228000000_pi_execution_instances.sql');
    expect(i).toMatch(/IF n <> 4 AND NOT \(n = 5 AND EXISTS \([\s\S]{0,200}conname = 'execution_instances_target_tenant_fk'\)\) THEN/);
  });
});

describe('rollback', () => {
  it('is transactional, refuses while journeys reference targets, and drops the deferred FK before the table', () => {
    expect(rollback).toMatch(/^BEGIN;/m);
    expect(rollback).toMatch(/^COMMIT;/m);
    expect(rollback).toMatch(/EXISTS \(SELECT 1 FROM public\.execution_instances WHERE target_id IS NOT NULL\)/);
    const fk = rollback.indexOf('DROP CONSTRAINT IF EXISTS execution_instances_target_tenant_fk');
    expect(fk).toBeGreaterThan(0);
    expect(fk).toBeLessThan(rollback.indexOf('DROP TABLE IF EXISTS public.prospect_campaign_targets'));
    // It never touches the canonical membership rows.
    expect(rollback).not.toMatch(/prospect_list_members/);
  });

  it('is not in the migrations directory proper (never applied by a migration run)', () => {
    // (20260406_…_rollback.sql is a pre-existing legacy file; this one lives in rollbacks/.)
    expect(migrations.some((f) => /orchestration_campaign_targeting/.test(f) && f !== MINE)).toBe(false);
    expect(fs.existsSync(path.join(MIG_DIR, 'rollbacks/orchestration_campaign_targeting_rollback.sql'))).toBe(true);
  });
});

describe('routes — verified tenant, then capability, then work', () => {
  const ROUTES = [
    'pages/api/prospect-campaigns/[id]/targeting.ts',
    'pages/api/prospect-campaigns/[id]/lists.ts',
    'pages/api/prospect-campaigns/[id]/select.ts',
    'pages/api/prospect-campaigns/[id]/enroll.ts',
    'pages/api/prospect-lists/icp.ts',
  ];

  it.each(ROUTES)('%s authenticates the tenant, then checks PROSPECT_ICP_MANAGE, before any store call', (rel) => {
    const src = read(rel);
    const handler = src.slice(src.indexOf('async function handler'));
    const access = handler.indexOf('await enforceCompanyAccess(');
    const guard = handler.indexOf('await requireCapability(');
    expect(access).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(access);
    expect(handler).toMatch(/capability: PROSPECT_ICP_MANAGE/);
    const firstWork = handler.search(/await (getCampaignTargeting|setCampaignTargeting|attachListToCampaign|detachListFromCampaign|listCampaignListAttachments|selectCampaignTargets|enrollCampaignTargets|productionListStore\.|evaluateIcpList)\(?/);
    expect(firstWork).toBeGreaterThan(guard);
  });

  it.each(ROUTES)('%s takes the tenant from the query it authenticated — never from the body', (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/body\.(companyId|company_id|organizationId|organization_id)/);
    expect(src).toMatch(/organizationId: companyId/);
  });

  it('a human selection is attributed to the VERIFIED actor', () => {
    const src = read('pages/api/prospect-campaigns/[id]/select.ts');
    expect(src).toMatch(/origin: 'human'/);
    expect(src).toMatch(/actorUserId: access\.userId/);
    expect(src).not.toMatch(/body\.(actorUserId|userId|actor)/);
  });

  it('enrollment accepts no version — the store pins the published one', () => {
    const src = read('pages/api/prospect-campaigns/[id]/enroll.ts');
    expect(src).not.toMatch(/body\.\w*[Vv]ersion/);
    expect(src).not.toMatch(/autonom|approve/i);
  });

  it('adds no cron schedule and no new route-auth exemption', () => {
    const vercel = read('vercel.json');
    expect(vercel).not.toMatch(/prospect-campaigns|prospect-lists/);
    const allow = read('scripts/route-auth-allowlist.json');
    for (const rel of ROUTES) expect(allow).not.toContain(rel);
  });
});

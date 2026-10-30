/**
 * Prospect provenance — `prospect_source_contributions` against real PostgreSQL
 * (migration 20270107000000_pi_prospect_source_contributions.sql).
 *
 * A green run here concerns a disposable database built from the committed
 * baseline plus replayed migrations. It is NOT evidence about the production
 * database and must not be reported as production verification.
 *
 * What only PostgreSQL can prove, and this suite asserts:
 *   - composite tenant FKs reject a cross-tenant pointer with 23503;
 *   - the partial unique index allows exactly one originating row per lead;
 *   - the contract unique constraint makes a source event idempotent per lead;
 *   - privileges make the table append-only (service_role SELECT+INSERT only);
 *   - each ON DELETE action does what the migration rationale says — including
 *     the PG15+ `SET NULL (col)` form keeping organization_id intact, and a
 *     lead_signals delete that cascades through a feed item clearing BOTH
 *     pointers on the same contribution;
 *   - the writer's error recognition works on PostgreSQL's real error text.
 *
 * Conventions follow the other suites: every mutation runs inside `inRollback`;
 * `attempt` returns 'ok' or the SQLSTATE.
 */
jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: () => { throw new Error('the realschema suite injects its own inserter'); },
}));

import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newLead } from './setup';
import { recordSourceContribution } from '../../services/prospectProvenance/contributionWriter';
import type { SourceContributionInput } from '../../../lib/prospectProvenance/contract';

const T = 'public.prospect_source_contributions';

const INS = `INSERT INTO ${T}
  (organization_id, canonical_lead_id, contribution_role, source_category, external_ref,
   source_record_id, contact_id, lead_signal_id, opportunity_feed_item_id, engagement_message_id,
   observed_at, evidence)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), coalesce($11::jsonb, '{}'::jsonb)) RETURNING id`;

type Opt = {
  role?: 'originating' | 'contributing'; category?: string; ref?: string;
  sourceRecord?: string | null; contact?: string | null; signal?: string | null;
  feed?: string | null; message?: string | null; evidence?: string | null;
};
const params = (org: string, lead: string, o: Opt = {}) => [
  org, lead, o.role ?? 'contributing', o.category ?? 'community', o.ref ?? 'community:1',
  o.sourceRecord ?? null, o.contact ?? null, o.signal ?? null, o.feed ?? null, o.message ?? null,
  o.evidence ?? null,
];
async function contrib(org: string, lead: string, o: Opt = {}): Promise<string> {
  const { rows } = await db.query(INS, params(org, lead, o));
  return rows[0].id;
}
const tryContrib = (org: string, lead: string, o: Opt = {}) => attempt(INS, params(org, lead, o));

/** Attempt and return the violated constraint name ('ok' when it succeeded). */
async function violated(sql: string, p: unknown[]): Promise<string> {
  await db.query('SAVEPOINT v');
  try {
    await db.query(sql, p);
    await db.query('ROLLBACK TO SAVEPOINT v');
    return 'ok';
  } catch (e: any) {
    await db.query('ROLLBACK TO SAVEPOINT v');
    return `${e.code}:${e.constraint ?? ''}`;
  }
}

// ── fixtures ────────────────────────────────────────────────────────────────
async function sourceRecord(org: string, rid = 'R1'): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.source_records (organization_id, provider, source_entity_type, source_record_id, payload_hash)
     VALUES ($1,'psc-test','person',$2,repeat('c',64)) RETURNING id`, [org, rid]);
  return rows[0].id;
}
async function contact(org: string, key = 'k1'): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.contacts (organization_id, platform, platform_user_id, contact_key)
     VALUES ($1,'reddit',$2,$2) RETURNING id`, [org, `psc-${key}`]);
  return rows[0].id;
}
async function signal(org: string, src = 's1'): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.lead_signals (organization_id, source_type, source_id, platform, detected_at, migration_source)
     VALUES ($1,'listening',$2,'reddit',now(),'psc-test') RETURNING id`, [org, `psc-${src}`]);
  return rows[0].id;
}
async function feed(org: string, signalId: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.opportunity_feed_items (organization_id, signal_id, opportunity_type, detected_reason, platform)
     VALUES ($1,$2,'generic_interest','psc-test','reddit') RETURNING id`, [org, signalId]);
  return rows[0].id;
}
async function message(org: string, key = 'm1'): Promise<string> {
  const t = await db.query(
    `INSERT INTO public.engagement_threads (organization_id, platform, platform_thread_id)
     VALUES ($1,'reddit',$2) RETURNING id`, [org, `psc-thread-${key}`]);
  const { rows } = await db.query(
    `INSERT INTO public.engagement_messages (thread_id, platform, platform_message_id, direction, content)
     VALUES ($1,'reddit',$2,'inbound','psc body') RETURNING id, organization_id`, [t.rows[0].id, `psc-msg-${key}`]);
  expect(rows[0].organization_id).toBe(org); // derived from the thread (ENG-004)
  return rows[0].id;
}
const row = async (id: string) => (await db.query(`SELECT * FROM ${T} WHERE id=$1`, [id])).rows[0];
const count = async (where = 'true', p: unknown[] = []) =>
  (await db.query(`SELECT count(*)::int n FROM ${T} WHERE ${where}`, p)).rows[0].n as number;

// ───────────────────────────────────────────────────────────────────────────

describe('PSC — schema shape', () => {
  it('table exists, RLS enabled and not forced, one service_role policy', async () => {
    const { rows } = await db.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = '${T}'::regclass`);
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: false });
    const pol = await db.query(
      `SELECT policyname, roles::text[] AS roles FROM pg_policies
        WHERE schemaname='public' AND tablename='prospect_source_contributions'`);
    expect(pol.rows).toEqual([{ policyname: 'prospect_source_contributions_service_role', roles: ['service_role'] }]);
  });

  it('carries the contract unique constraint and the partial originating index', async () => {
    const c = await db.query(
      `SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='uq_psc_org_lead_external_ref'`);
    expect(c.rows[0].d).toBe('UNIQUE (organization_id, canonical_lead_id, external_ref)');
    const i = await db.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='uq_psc_one_originating_per_lead'`);
    expect(i.rows[0].indexdef).toMatch(/UNIQUE INDEX .*\(canonical_lead_id\) WHERE \(contribution_role = 'originating'::text\)/);
  });

  it('has the designed ON DELETE action on every FK, and SET NULL never names organization_id', async () => {
    const { rows } = await db.query(
      `SELECT c.conname, c.confdeltype,
              (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
                WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.confdelsetcols)) AS setcols
         FROM pg_constraint c WHERE c.conrelid = '${T}'::regclass AND c.contype = 'f'
         ORDER BY c.conname`);
    const by = Object.fromEntries(rows.map((r: any) => [r.conname, [r.confdeltype, r.setcols]]));
    expect(by).toMatchObject({
      psc_lead_tenant_fk: ['c', null],
      psc_source_record_tenant_fk: ['n', ['source_record_id']],
      psc_contact_tenant_fk: ['n', ['contact_id']],
      psc_lead_signal_tenant_fk: ['n', ['lead_signal_id']],
      psc_opportunity_feed_item_tenant_fk: ['n', ['opportunity_feed_item_id']],
      psc_engagement_message_tenant_fk: ['n', ['engagement_message_id']],
    });
    expect(rows).toHaveLength(7); // 6 composite + organization_id → companies
  });

  it('adds (id, organization_id) unique keys to contacts, lead_signals, opportunity_feed_items', async () => {
    for (const [tbl, idx] of [['contacts', 'uq_contacts_id_org'], ['lead_signals', 'uq_lead_signals_id_org'],
      ['opportunity_feed_items', 'uq_opportunity_feed_items_id_org']]) {
      const { rows } = await db.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1 AND indexname=$2`, [tbl, idx]);
      expect(rows[0]?.indexdef).toMatch(/^CREATE UNIQUE INDEX .* \(id, organization_id\)$/);
    }
  });

  it('source_records gains nullable source_category (CHECKed), platform, source_url', async () => {
    const { rows } = await db.query(
      `SELECT column_name, is_nullable, data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='source_records'
          AND column_name IN ('source_category','platform','source_url') ORDER BY column_name`);
    expect(rows).toEqual([
      { column_name: 'platform', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'source_category', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'source_url', is_nullable: 'YES', data_type: 'text' },
    ]);
    await inRollback(async () => {
      await seedTenants();
      const id = await sourceRecord(ORG_A);
      expect(await attempt(`UPDATE public.source_records SET source_category='twitter' WHERE id=$1`, [id])).toBe('23514');
      expect(await attempt(`UPDATE public.source_records SET source_category='social_listening', platform='reddit' WHERE id=$1`, [id])).toBe('ok');
      // Existing rows are unaffected: the new columns are NULL with no default.
      const r = await db.query(`SELECT source_category, platform, source_url FROM public.source_records WHERE id=$1`, [id]);
      expect(r.rows[0]).toEqual({ source_category: null, platform: null, source_url: null });
    });
  });
});

describe('PSC — CHECK constraints', () => {
  it.each([
    ['unknown role', { role: 'primary' as never }],
    ['unknown category', { category: 'twitter' }],
    ['un-namespaced ref', { ref: 'feed-123' }],
    ['upper-case provider', { ref: 'Community:1' }],
    ['empty id', { ref: 'community:' }],
    ['array evidence', { evidence: '[]' }],
    ['scalar evidence', { evidence: '"x"' }],
  ])('rejects %s with 23514', async (_l, o) => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      expect(await tryContrib(ORG_A, lead, o as Opt)).toBe('23514');
    });
  });

  it('accepts all 12 categories', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      const cats = ['marketpulse', 'social_listening', 'community', 'engagement', 'inbound_form', 'inbound_webhook',
        'manual', 'crm', 'csv', 'pi_discovery', 'pi_enrichment', 'website'];
      for (const c of cats) expect(await tryContrib(ORG_A, lead, { category: c, ref: `p:${c}` })).toBe('ok');
    });
  });
});

describe('PSC — tenant isolation (composite FKs)', () => {
  it('rejects every cross-tenant pointer with 23503', async () => {
    await inRollback(async () => {
      await seedTenants();
      const leadA = await newLead(ORG_A);
      const leadB = await newLead(ORG_B);
      const sigB = await signal(ORG_B);
      // Lead of tenant B claimed by tenant A.
      expect(await violated(INS, params(ORG_A, leadB))).toBe('23503:psc_lead_tenant_fk');
      expect(await violated(INS, params(ORG_A, leadA, { sourceRecord: await sourceRecord(ORG_B) })))
        .toBe('23503:psc_source_record_tenant_fk');
      expect(await violated(INS, params(ORG_A, leadA, { contact: await contact(ORG_B) })))
        .toBe('23503:psc_contact_tenant_fk');
      expect(await violated(INS, params(ORG_A, leadA, { signal: sigB })))
        .toBe('23503:psc_lead_signal_tenant_fk');
      expect(await violated(INS, params(ORG_A, leadA, { feed: await feed(ORG_B, sigB) })))
        .toBe('23503:psc_opportunity_feed_item_tenant_fk');
      expect(await violated(INS, params(ORG_A, leadA, { message: await message(ORG_B) })))
        .toBe('23503:psc_engagement_message_tenant_fk');
      expect(await count()).toBe(0);
    });
  });

  it('accepts same-tenant pointers on every reference', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      const sig = await signal(ORG_A);
      expect(await tryContrib(ORG_A, lead, {
        sourceRecord: await sourceRecord(ORG_A), contact: await contact(ORG_A), signal: sig,
        feed: await feed(ORG_A, sig), message: await message(ORG_A),
      })).toBe('ok');
    });
  });
});

describe('PSC — roles and idempotency', () => {
  it('allows one originating row per lead; a second fails on uq_psc_one_originating_per_lead', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      await contrib(ORG_A, lead, { role: 'originating', ref: 'community:a' });
      expect(await violated(INS, params(ORG_A, lead, { role: 'originating', ref: 'apollo:b' })))
        .toBe('23505:uq_psc_one_originating_per_lead');
      // Another lead may have its own originator.
      expect(await tryContrib(ORG_A, await newLead(ORG_A), { role: 'originating', ref: 'community:a' })).toBe('ok');
    });
  });

  it('a duplicate external_ref per lead fails on uq_psc_org_lead_external_ref, in either role', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      await contrib(ORG_A, lead, { ref: 'crm_hubspot:42' });
      expect(await violated(INS, params(ORG_A, lead, { ref: 'crm_hubspot:42' })))
        .toBe('23505:uq_psc_org_lead_external_ref');
      // A retried ORIGINATING event reports the idempotency constraint (declared first).
      const lead2 = await newLead(ORG_A);
      await contrib(ORG_A, lead2, { role: 'originating', ref: 'community:x' });
      expect(await violated(INS, params(ORG_A, lead2, { role: 'originating', ref: 'community:x' })))
        .toBe('23505:uq_psc_org_lead_external_ref');
      // The same ref on a different lead is a different contribution.
      expect(await tryContrib(ORG_A, await newLead(ORG_A), { ref: 'crm_hubspot:42' })).toBe('ok');
    });
  });

  it('allows many contributing rows per lead', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      await contrib(ORG_A, lead, { role: 'originating', ref: 'community:0' });
      for (let i = 1; i <= 5; i += 1) await contrib(ORG_A, lead, { ref: `apollo:${i}` });
      expect(await count('canonical_lead_id=$1', [lead])).toBe(6);
      expect(await count(`canonical_lead_id=$1 AND contribution_role='originating'`, [lead])).toBe(1);
    });
  });
});

describe('PSC — privileges (append-only)', () => {
  it('service_role holds SELECT+INSERT only; anon, authenticated and PUBLIC hold nothing', async () => {
    const { rows } = await db.query(
      `SELECT r.rolname, p.priv,
              has_table_privilege(r.rolname, '${T}', p.priv) AS has
         FROM (VALUES ('service_role'), ('anon'), ('authenticated')) r(rolname)
         CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)`);
    const held = rows.filter((r: any) => r.has).map((r: any) => `${r.rolname}:${r.priv}`).sort();
    expect(held).toEqual(['service_role:INSERT', 'service_role:SELECT']);
    const pub = await db.query(
      `SELECT count(*)::int n FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE c.oid = '${T}'::regclass AND a.grantee = 0`);
    expect(pub.rows[0].n).toBe(0);
  });

  it('as service_role: INSERT and SELECT work, UPDATE and DELETE are refused (42501)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      const id = await contrib(ORG_A, lead);
      await db.query('SET LOCAL ROLE service_role');
      expect(await tryContrib(ORG_A, lead, { ref: 'manual:2' })).toBe('ok');
      expect(await attempt(`SELECT * FROM ${T} WHERE id=$1`, [id])).toBe('ok');
      expect(await attempt(`UPDATE ${T} SET platform='x' WHERE id=$1`, [id])).toBe('42501');
      expect(await attempt(`DELETE FROM ${T} WHERE id=$1`, [id])).toBe('42501');
      await db.query('RESET ROLE');
    });
  });

  it('as anon / authenticated: SELECT and INSERT are refused (42501)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      for (const role of ['anon', 'authenticated']) {
        await db.query(`SET LOCAL ROLE ${role}`);
        expect(await attempt(`SELECT 1 FROM ${T} LIMIT 1`)).toBe('42501');
        expect(await tryContrib(ORG_A, lead, { ref: `manual:${role}` })).toBe('42501');
        await db.query('RESET ROLE');
      }
    });
  });
});

describe('PSC — ON DELETE behaviour', () => {
  it('deleting a feed item clears only its pointer; the contribution and its tenant survive', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      const sig = await signal(ORG_A);
      const f = await feed(ORG_A, sig);
      const id = await contrib(ORG_A, lead, { signal: sig, feed: f, evidence: '{"feed_item":"kept-as-evidence"}' });
      await db.query('DELETE FROM public.opportunity_feed_items WHERE id=$1', [f]);
      const r = await row(id);
      expect(r.opportunity_feed_item_id).toBeNull();
      expect(r.lead_signal_id).toBe(sig);
      expect(r.organization_id).toBe(ORG_A);
      expect(r.evidence).toEqual({ feed_item: 'kept-as-evidence' });
    });
  });

  it('deleting a lead signal (which cascades its feed items) clears BOTH pointers and keeps the row', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      const sig = await signal(ORG_A);
      const f = await feed(ORG_A, sig);
      const id = await contrib(ORG_A, lead, { role: 'originating', signal: sig, feed: f });
      await db.query('DELETE FROM public.lead_signals WHERE id=$1', [sig]);
      const r = await row(id);
      expect([r.lead_signal_id, r.opportunity_feed_item_id, r.organization_id, r.contribution_role])
        .toEqual([null, null, ORG_A, 'originating']);
    });
  });

  it('deleting a source record, contact or engagement message clears only that pointer', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      const sr = await sourceRecord(ORG_A);
      const c = await contact(ORG_A);
      const m = await message(ORG_A);
      const id = await contrib(ORG_A, lead, { sourceRecord: sr, contact: c, message: m });
      await db.query('DELETE FROM public.source_records WHERE id=$1', [sr]);
      expect((await row(id)).source_record_id).toBeNull();
      expect((await row(id)).contact_id).toBe(c);
      await db.query('DELETE FROM public.contacts WHERE id=$1', [c]);
      expect((await row(id)).contact_id).toBeNull();
      await db.query('DELETE FROM public.engagement_messages WHERE id=$1', [m]);
      const r = await row(id);
      expect([r.engagement_message_id, r.organization_id, r.canonical_lead_id]).toEqual([null, ORG_A, lead]);
    });
  });

  it('deleting the canonical lead removes its contributions (erasure follows the prospect)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      const other = await newLead(ORG_A);
      await contrib(ORG_A, lead, { role: 'originating', ref: 'community:1' });
      await contrib(ORG_A, lead, { ref: 'apollo:1' });
      const keep = await contrib(ORG_A, other, { ref: 'apollo:1' });
      await db.query('DELETE FROM public.canonical_leads WHERE id=$1', [lead]);
      expect(await count('canonical_lead_id=$1', [lead])).toBe(0);
      expect(await row(keep)).toBeDefined();
    });
  });

  it('deleting a tenant removes its contributions only', async () => {
    await inRollback(async () => {
      await seedTenants();
      await contrib(ORG_A, await newLead(ORG_A));
      const b = await contrib(ORG_B, await newLead(ORG_B));
      await db.query('DELETE FROM public.companies WHERE id=$1', [ORG_A]);
      expect(await count('organization_id=$1', [ORG_A])).toBe(0);
      expect(await row(b)).toBeDefined();
    });
  });
});

describe('PSC — writer against real PostgreSQL errors', () => {
  /** Inserter over the pg client, relaying error code + message the way PostgREST does. */
  const pgInserter = async (r: Record<string, unknown>) => {
    const cols = Object.keys(r);
    const vals = cols.map((c) => (c === 'evidence' || c === 'source_metadata' ? JSON.stringify(r[c]) : r[c]));
    await db.query('SAVEPOINT w');
    try {
      const { rows } = await db.query(
        `INSERT INTO ${T} (${cols.join(',')}) VALUES (${cols.map((_c, i) => `$${i + 1}`).join(',')}) RETURNING id`, vals);
      await db.query('RELEASE SAVEPOINT w');
      return { data: { id: rows[0].id as string }, error: null };
    } catch (e: any) {
      await db.query('ROLLBACK TO SAVEPOINT w');
      return { data: null, error: { code: e.code, message: e.message, details: e.detail } };
    }
  };
  const input = (lead: string, o: Partial<SourceContributionInput> = {}): SourceContributionInput => ({
    organizationId: ORG_A, canonicalLeadId: lead, leadCreated: true, sourceCategory: 'community',
    externalRef: 'community:feed-1', observedAt: '2026-10-30T10:00:00.000Z', ...o,
  });

  it('originating → duplicate → downgraded → tenant mismatch', async () => {
    await inRollback(async () => {
      await seedTenants();
      const lead = await newLead(ORG_A);
      const first = await recordSourceContribution(input(lead), { insert: pgInserter });
      expect(first).toMatchObject({ status: 'inserted', role: 'originating', roleDowngraded: false });

      expect(await recordSourceContribution(input(lead), { insert: pgInserter }))
        .toEqual({ status: 'duplicate', role: null });

      const second = await recordSourceContribution(input(lead, { externalRef: 'apollo:p-1', sourceCategory: 'pi_enrichment' }), { insert: pgInserter });
      expect(second).toMatchObject({ status: 'inserted', role: 'contributing', roleDowngraded: true });

      // Retrying the downgraded event converges to duplicate.
      expect(await recordSourceContribution(input(lead, { externalRef: 'apollo:p-1', sourceCategory: 'pi_enrichment' }), { insert: pgInserter }))
        .toEqual({ status: 'duplicate', role: null });

      const cross = await recordSourceContribution(input(lead, { organizationId: ORG_B, externalRef: 'community:x' }), { insert: pgInserter });
      expect(cross).toMatchObject({ status: 'error', code: '23503' });

      expect(await count('canonical_lead_id=$1', [lead])).toBe(2);
    });
  });
});

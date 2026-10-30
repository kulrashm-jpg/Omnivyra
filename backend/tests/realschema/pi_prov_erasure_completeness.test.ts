/**
 * Closure A (privacy) — migration 20270109000000_pi_provenance_erasure_completeness.sql
 * against real PostgreSQL.
 *
 * A green run here concerns a disposable database built from the committed
 * baseline plus replayed migrations. It is NOT evidence about the production
 * database and must not be reported as production verification.
 *
 * Proves, for `public.pi_erase_prospect_provenance`:
 *   - the FULL graph of an erased person is redacted: after the erasure and the
 *     person delete, no personal value (nor the sha256 of one) remains in ANY
 *     mapped table (docs/architecture/PROSPECT-PROVENANCE-ERASURE-POLICY.md);
 *   - the audit tombstone is minimal and carries no recoverable value;
 *   - repeated erasure is idempotent (no row changes, zero counts);
 *   - a failing step inside the call leaves NOTHING changed and no tombstone,
 *     and the person is not deleted;
 *   - cross-tenant attempts are refused with no change;
 *   - erased values cannot be recovered by external_ref / provider-id lookup or
 *     by hash comparison;
 *   - service_role still cannot UPDATE/DELETE contributions or write tombstones.
 *
 * Conventions follow the other suites: every mutation runs inside `inRollback`;
 * `attempt` returns 'ok' or the SQLSTATE.
 */
jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: () => { throw new Error('the realschema suite talks to PostgreSQL directly'); },
  ownedDbRpc: () => { throw new Error('the realschema suite talks to PostgreSQL directly'); },
}));

import { createHash } from 'crypto';
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson, newLead } from './setup';

const FN = 'public.pi_erase_prospect_provenance';
const LEGACY_FN = 'public.pi_redact_prospect_source_contributions';
const PSC = 'public.prospect_source_contributions';
const TOMB = 'public.prospect_source_contribution_redactions';
const EVENTS = 'public.prospect_provenance_erasures';

/** Every table the policy maps for a person/prospect (engagement_authors is global — see its own test). */
const MAPPED_TABLES = [
  'prospect_source_contributions', 'prospect_source_contribution_redactions', 'prospect_provenance_erasures',
  'source_records', 'source_assertions', 'contacts', 'lead_signals', 'opportunity_feed_items',
  'engagement_threads', 'engagement_messages', 'engagement_message_sources', 'engagement_insight_evidence',
  'engagement_opportunities', 'engagement_thread_memory', 'engagement_thread_intelligence',
  'engagement_lead_signals', 'engagement_identity_candidates',
  'lead_intelligence', 'lead_intelligence_events', 'lead_intelligence_profiles',
  'canonical_leads', 'canonical_users', 'identity_claims', 'prospect_problem_observations', 'unified_persons',
];

const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

/** The personal values of one synthetic subject; every one must vanish. */
function subject(tag: string) {
  return {
    email: `${tag}@example.test`,
    name: `${tag} Fullname`,
    phone: `+1555${tag.length}0100${tag}`,
    handle: `${tag}_handle`,
    providerPersonId: `apollo-person-${tag}`,
    crmId: `crm-${tag}`,
    url: `https://www.linkedin.com/in/${tag}-profile`,
    threadId: `t3_${tag}`,
    messageId: `t1_${tag}`,
    snippet: `${tag} wrote: we are evaluating vendors`,
  };
}
type Subject = ReturnType<typeof subject>;
const personalValues = (s: Subject) => Object.values(s);
/** Hashes an attacker could recompute from a guessed value. */
const guessableHashes = (s: Subject) => [s.email, s.url, s.handle, s.providerPersonId, s.phone].map(sha);

interface Graph {
  person: string; lead: string; user: string; sr: string; srAccount: string; assertion: string;
  contact: string; thread: string; message: string; signal: string; feed: string; li: string;
  author: string; contribution: string; contributionAccount: string;
}

const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];

/** A person with a complete provenance/evidence graph in `org`. Caller is inside inRollback(). */
async function seedGraph(org: string, s: Subject): Promise<Graph> {
  const person = await newPerson(org);
  await db.query(`UPDATE public.unified_persons SET primary_email=$2, full_name=$3, primary_phone=$4 WHERE id=$1`,
    [person, s.email, s.name, s.phone]);
  const lead = await newLead(org, { personId: person });
  const { user_id: user } = await one('SELECT user_id FROM public.canonical_leads WHERE id=$1', [lead]);
  await db.query(`UPDATE public.canonical_leads SET external_lead_key=$2, lead_metadata=$3::jsonb WHERE id=$1`,
    [lead, `apollo:${s.providerPersonId}`, JSON.stringify({ email: s.email, name: s.name })]);
  await db.query(`UPDATE public.canonical_users SET email=$2, full_name=$3, phone=$4, external_user_key=$5,
                         geo='Berlin', user_metadata=$6::jsonb WHERE id=$1`,
    [user, s.email, s.name, s.phone, s.crmId, JSON.stringify({ handle: s.handle })]);

  await db.query(`INSERT INTO public.identity_claims (organization_id, person_id, claim_type, normalized_value, source)
                  VALUES ($1,$2,'email',$3,'w6')`, [org, person, s.email]);

  const sr = (await one(
    `INSERT INTO public.source_records (organization_id, provider, source_entity_type, source_record_id, person_id,
                                        raw_payload, payload_hash, source_url, platform, source_category)
     VALUES ($1,'apollo','person',$2,$3,$4::jsonb,$5,$6,'apollo','pi_enrichment') RETURNING id`,
    [org, s.providerPersonId, person, JSON.stringify({ email: s.email, name: s.name, linkedin: s.url }),
      sha(JSON.stringify({ email: s.email })), s.url])).id;
  const srAccount = (await one(
    `INSERT INTO public.source_records (organization_id, provider, source_entity_type, source_record_id,
                                        raw_payload, payload_hash, source_url)
     VALUES ($1,'apollo','account',$2,'{"domain":"acme.test"}'::jsonb,$3,'https://acme.test') RETURNING id`,
    [org, `acct-${lead}`, sha('acme')])).id;
  const assertion = (await one(
    `INSERT INTO public.source_assertions (organization_id, source_record_id, entity_type, person_id, attribute,
                                           raw_value, normalized_value, value_hash, provider)
     VALUES ($1,$2,'person',$3,'email',$4,$4,$5,'apollo') RETURNING id`,
    [org, sr, person, s.email, sha(s.email)])).id;
  await db.query(
    `INSERT INTO public.prospect_problem_observations (organization_id, entity_type, person_id, statement,
                                                       statement_hash, origin_store, origin_record_id, origin)
     VALUES ($1,'person',$2,$3,$4,'w6','r1','provider')`, [org, person, s.snippet, sha(s.snippet)]);

  const contact = (await one(
    `INSERT INTO public.contacts (organization_id, platform, platform_user_id, contact_key, display_name, profile_url,
                                  unified_person_id)
     VALUES ($1,'reddit',$2,$3,$4,$5,$6) RETURNING id`,
    [org, s.handle, `reddit:${s.handle}`, s.name, s.url, person])).id;
  const thread = (await one(
    `INSERT INTO public.engagement_threads (organization_id, platform, platform_thread_id, contact_id, unified_person_id,
                                            raw_payload)
     VALUES ($1,'reddit',$2,$3,$4,$5::jsonb) RETURNING id`,
    [org, s.threadId, contact, person, JSON.stringify({ author: s.handle })])).id;
  const author = (await one(
    `INSERT INTO public.engagement_authors (platform, platform_user_id, username) VALUES ('reddit',$1,$1) RETURNING id`,
    [`${s.handle}_global`])).id;
  const message = (await one(
    `INSERT INTO public.engagement_messages (organization_id, thread_id, platform, platform_message_id, content,
                                             raw_payload, actor_external_id, author_id, platform_parent_id, sync_thread_id)
     VALUES ($1,$2,'reddit',$3,$4,$5::jsonb,$6,$7,$8,$9) RETURNING id`,
    [org, thread, s.messageId, s.snippet, JSON.stringify({ body: s.snippet }), s.handle, author, s.threadId, s.threadId])).id;
  await db.query(`INSERT INTO public.engagement_message_sources (engagement_message_id, source, platform_message_id, platform)
                  VALUES ($1,'api',$2,'reddit')`, [message, s.messageId]);
  const insight = (await one(
    `INSERT INTO public.engagement_insights (organization_id, insight_type, insight_title) VALUES ($1,'trend','t') RETURNING id`,
    [org])).id;
  await db.query(`INSERT INTO public.engagement_insight_evidence (insight_id, thread_id, message_id, platform, author_name, text_snippet)
                  VALUES ($1,$2,$3,'reddit',$4,$5)`, [insight, thread, message, s.name, s.snippet]);
  await db.query(`INSERT INTO public.engagement_opportunities (organization_id, platform, source_thread_id, source_message_id,
                                                               opportunity_type, opportunity_text, author_id)
                  VALUES ($1,'reddit',$2,$3,'lead',$4,$5)`, [org, thread, message, s.snippet, author]);
  await db.query(`INSERT INTO public.engagement_thread_memory (thread_id, organization_id, conversation_summary)
                  VALUES ($1,$2,$3)`, [thread, org, s.snippet]);
  await db.query(`INSERT INTO public.engagement_thread_intelligence (thread_id, priority_reason) VALUES ($1,$2)`,
    [thread, s.snippet]);
  await db.query(`INSERT INTO public.engagement_lead_signals (organization_id, message_id, thread_id, author_id, lead_intent)
                  VALUES ($1,$2,$3,$4,'buying')`, [org, message, thread, author]);
  await db.query(`INSERT INTO public.engagement_identity_candidates (platform, external_id, identity_type, unified_person_id)
                  VALUES ('reddit',$1,'handle',$2)`, [s.handle, person]);

  const signal = (await one(
    `INSERT INTO public.lead_signals (organization_id, source_type, source_id, platform, detected_at, migration_source,
                                      content_text, platform_user_id, contact_key, crm_lead_id, metadata, contact_id, thread_id)
     VALUES ($1,'engagement',$2,'reddit','2026-10-01T00:00:00Z','w6',$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING id`,
    [org, s.messageId, s.snippet, s.handle, `reddit:${s.handle}`, s.crmId, JSON.stringify({ author: s.name }), contact, thread])).id;
  const feed = (await one(
    `INSERT INTO public.opportunity_feed_items (organization_id, signal_id, opportunity_type, opportunity_score,
                                                confidence_score, urgency_score, detected_reason, platform,
                                                source_identifier, author_metadata, source_context, explanation,
                                                recommendation_context)
     VALUES ($1,$2,'buying_intent',0.5,0.5,0.5,$3,'reddit',$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb) RETURNING id`,
    [org, signal, s.snippet, s.url, JSON.stringify({ handle: s.handle, name: s.name }),
      JSON.stringify({ excerpt: s.snippet }), JSON.stringify({ why: s.snippet }), JSON.stringify({ to: s.name })])).id;

  const li = (await one(
    `INSERT INTO public.lead_intelligence (company_id, dedupe_key, source, unified_person_id, identity, metadata,
                                           attribution, content, source_table, source_id)
     VALUES ($1,$2,'engagement',$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,'lead_signals',$8) RETURNING id`,
    [org, `email:${s.email}`, person, JSON.stringify({ email: s.email, name: s.name }), JSON.stringify({ phone: s.phone }),
      JSON.stringify({ url: s.url }), JSON.stringify({ text: s.snippet }), s.crmId])).id;
  await db.query(`INSERT INTO public.lead_intelligence_events (company_id, lead_id, origin, source, event_type, entity_id, metadata)
                  VALUES ($1,$2,'w6','engagement','created',$3,$4::jsonb)`,
    [org, li, s.handle, JSON.stringify({ email: s.email })]);
  await db.query(`INSERT INTO public.lead_intelligence_profiles (company_id, lead_id, intelligence, diagnostics, input_fingerprint,
                                                                 engine_version, generated_at)
                  VALUES ($1,$2,$3::jsonb,$4::jsonb,'fp','v1',now())`,
    [org, li, JSON.stringify({ summary: `${s.name} is evaluating` }), JSON.stringify({ input: s.email })]);

  const contribution = (await one(
    `INSERT INTO ${PSC} (organization_id, canonical_lead_id, contribution_role, source_category, external_ref,
                         source_record_id, platform, source_url, contact_id, lead_signal_id, opportunity_feed_item_id,
                         engagement_message_id, observed_at, evidence, source_metadata)
     VALUES ($1,$2,'originating','community',$3,$4,'reddit',$5,$6,$7,$8,$9,'2026-10-01T00:00:00Z',$10::jsonb,$11::jsonb)
     RETURNING id`,
    [org, lead, `apollo:${s.providerPersonId}`, sr, s.url, contact, signal, feed, message,
      JSON.stringify({ excerpt: s.snippet, authorHandle: s.handle }), JSON.stringify({ contactKey: `reddit:${s.handle}` })])).id;
  const contributionAccount = (await one(
    `INSERT INTO ${PSC} (organization_id, canonical_lead_id, contribution_role, source_category, external_ref,
                         source_record_id, observed_at)
     VALUES ($1,$2,'contributing','pi_enrichment',$3,$4,'2026-10-02T00:00:00Z') RETURNING id`,
    [org, lead, `crm:${s.crmId}`, srAccount])).id;

  return { person, lead, user, sr, srAccount, assertion, contact, thread, message, signal, feed, li, author,
    contribution, contributionAccount };
}

const erase = (org: string, person: string | null, leads: string[] = [], reason = 'gdpr art.17 request', by = 'admin:u1') =>
  db.query(`SELECT ${FN}($1::uuid, $2::uuid, $3::uuid[], $4, $5) AS r`, [org, person, leads, reason, by]).then((x) => x.rows[0].r);

async function snapshot(tables = MAPPED_TABLES): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const t of tables) {
    out[t] = (await db.query(`SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text), '[]'::jsonb) AS j FROM public.${t} x`)).rows[0].j;
  }
  return out;
}

/** Every occurrence of any needle in any mapped table, as `table: needle`. */
async function residue(needles: string[], tables = MAPPED_TABLES): Promise<string[]> {
  const hits: string[] = [];
  for (const t of tables) {
    const { rows } = await db.query(`SELECT to_jsonb(x)::text AS j FROM public.${t} x`);
    for (const r of rows) for (const n of needles) if (r.j.toLowerCase().includes(n.toLowerCase())) hits.push(`${t}: ${n}`);
  }
  return [...new Set(hits)];
}

async function asServiceRole<T>(body: () => Promise<T>): Promise<T> {
  await db.query('SET LOCAL ROLE service_role');
  try { return await body(); } finally { await db.query('RESET ROLE'); }
}

// ───────────────────────────────────────────────────────────────────────────

describe('20270109000000 — shape, privileges and retired hashing', () => {
  it('function: SECURITY DEFINER, search_path pinned, EXECUTE service_role only (both entry points)', async () => {
    for (const sig of [`${FN}(uuid, uuid, uuid[], text, text)`, `${LEGACY_FN}(uuid, uuid[], text, text)`]) {
      const { rows } = await db.query(
        `SELECT p.prosecdef, p.proconfig,
                has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authd
           FROM pg_proc p WHERE p.oid = $1::regprocedure`, [sig]);
      expect(rows[0]).toEqual({ prosecdef: true, proconfig: ['search_path=""'], svc: true, anon: false, authd: false });
    }
  });

  it('tombstone tables: service_role SELECT only; contributions still SELECT+INSERT; client roles nothing', async () => {
    const priv = async (t: string, role: string) => (await db.query(
      `SELECT array_agg(p ORDER BY p) AS ps FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
        WHERE has_table_privilege($2, $1::regclass, p)`, [t, role])).rows[0].ps;
    expect(await priv(EVENTS, 'service_role')).toEqual(['SELECT']);
    expect(await priv(TOMB, 'service_role')).toEqual(['SELECT']);
    expect(await priv(PSC, 'service_role')).toEqual(['INSERT', 'SELECT']);
    for (const t of [EVENTS, TOMB, PSC]) for (const r of ['anon', 'authenticated']) expect(await priv(t, r)).toBeNull();
  });

  it('the erasure event table has no person reference and no value/hash column', async () => {
    const { rows } = await db.query(
      `SELECT array_agg(column_name::text ORDER BY column_name) AS c FROM information_schema.columns
        WHERE table_schema='public' AND table_name='prospect_provenance_erasures'`);
    expect(rows[0].c).toEqual(['canonical_lead_ids', 'erased_at', 'id', 'organization_id', 'reason',
      'redacted_fields', 'requested_by', 'subject_kind', 'table_counts']);
  });

  it('a value hash can never be written to a tombstone again (CHECK, even by the owner)', () => inRollback(async () => {
    await seedTenants();
    const lead = await newLead(ORG_A);
    expect(await attempt(
      `INSERT INTO ${TOMB} (organization_id, canonical_lead_id, reason, requested_by, redacted_fields, values_sha256)
       VALUES ($1,$2,'r','x','{}',$3)`, [ORG_A, lead, sha('guess@example.test')])).toBe('23514');
    expect((await one(`SELECT count(*)::int n FROM ${TOMB} WHERE values_sha256 IS NOT NULL`)).n).toBe(0);
  }));
});

describe('closure A — complete erasure of a person (real PG)', () => {
  it('redacts the full graph: after erasure + person delete no personal value or its hash remains in any mapped table', () => inRollback(async () => {
    await seedTenants();
    const jane = subject('jane');
    const g = await seedGraph(ORG_A, jane);
    // Controls that must NOT change: another person of the same tenant, and another tenant.
    const bob = subject('bob');
    await seedGraph(ORG_A, bob);
    const carol = subject('carol');
    await seedGraph(ORG_B, carol);
    expect((await residue(personalValues(jane))).length).toBeGreaterThan(15);   // the fixture is real

    // Without the erasure the person cannot even be deleted (lead_intelligence is RESTRICT).
    expect(await attempt('DELETE FROM public.unified_persons WHERE id=$1', [g.person])).toBe('23503');

    const r = await asServiceRole(() => erase(ORG_A, g.person));
    expect(r.redacted).toBe(2);
    expect(r.already_redacted).toBe(0);
    expect([...r.contribution_ids].sort()).toEqual([g.contribution, g.contributionAccount].sort());
    expect(r.canonical_lead_ids).toEqual([g.lead]);
    expect(r.counts).toMatchObject({
      prospect_source_contributions: 2, source_records: 1, source_assertions: 1, contacts: 1, lead_signals: 1,
      opportunity_feed_items: 1, engagement_threads: 1, engagement_messages: 1, engagement_message_sources: 1,
      engagement_insight_evidence: 1, engagement_opportunities: 1, engagement_thread_memory: 1,
      engagement_thread_intelligence: 1, engagement_lead_signals: 1, engagement_identity_candidates: 1,
      lead_intelligence: 1, lead_intelligence_events: 1, lead_intelligence_profiles: 1, canonical_leads: 1,
      canonical_users: 1,
    });

    // The caller (personErasure.ts) deletes the person only after success.
    await db.query('DELETE FROM public.unified_persons WHERE id=$1', [g.person]);

    expect(await residue([...personalValues(jane), ...guessableHashes(jane)])).toEqual([]);

    // Rows survive (redacted, never deleted) where the policy says so.
    expect((await one(`SELECT count(*)::int n FROM ${PSC} WHERE canonical_lead_id=$1`, [g.lead])).n).toBe(2);
    expect(await one('SELECT id FROM public.source_records WHERE id=$1', [g.sr])).toBeDefined();
    expect(await one('SELECT id FROM public.engagement_messages WHERE id=$1', [g.message])).toBeDefined();
    expect(await one('SELECT id FROM public.canonical_leads WHERE id=$1', [g.lead])).toBeDefined();
    // The account record (company data, policy: keep) is untouched; only its contribution is redacted.
    expect(await one('SELECT source_url, raw_payload FROM public.source_records WHERE id=$1', [g.srAccount]))
      .toEqual({ source_url: 'https://acme.test', raw_payload: { domain: 'acme.test' } });
    // The global author profile is not this tenant's to erase, but no tenant row links to it any more.
    for (const [t, c] of [['engagement_messages', 'author_id'], ['engagement_opportunities', 'author_id'], ['engagement_lead_signals', 'author_id']]) {
      expect((await one(`SELECT count(*)::int n FROM public.${t} WHERE ${c}=$1`, [g.author])).n).toBe(0);
    }

    // Controls: bob (same tenant) and carol (other tenant) keep every value.
    expect((await residue(personalValues(bob))).length).toBeGreaterThan(15);
    expect((await residue(personalValues(carol))).length).toBeGreaterThan(15);
  }));

  it('audit tombstone: minimal fields, no person id, no values, no hashes', () => inRollback(async () => {
    await seedTenants();
    const jane = subject('jane');
    const g = await seedGraph(ORG_A, jane);
    const r = await erase(ORG_A, g.person, [], ' gdpr art.17 request ', 'admin:u1');
    const ev = await one(`SELECT * FROM ${EVENTS} WHERE id=$1`, [r.erasure_id]);
    expect(ev).toMatchObject({
      organization_id: ORG_A, subject_kind: 'person', reason: 'gdpr art.17 request', requested_by: 'admin:u1',
      canonical_lead_ids: [g.lead], table_counts: r.counts,
    });
    expect(ev.redacted_fields).toEqual(expect.arrayContaining([
      'prospect_source_contributions.external_ref', 'source_records.raw_payload', 'contacts.display_name',
      'engagement_messages.content', 'lead_intelligence.identity', 'canonical_users.email',
    ]));
    expect(ev.redacted_fields.every((f: string) => /^[a-z_]+\.[a-z_*]+$/.test(f))).toBe(true);
    expect(JSON.stringify(ev)).not.toContain(g.person);

    const tombs = (await db.query(`SELECT * FROM ${TOMB} WHERE erasure_id=$1`, [r.erasure_id])).rows;
    expect(tombs).toHaveLength(2);
    for (const t of tombs) {
      expect(t.values_sha256).toBeNull();
      expect(t.redacted_fields).toContain('external_ref');
    }
    const serialized = JSON.stringify({ ev, tombs });
    for (const v of [...personalValues(jane), ...guessableHashes(jane)]) expect(serialized).not.toContain(v);
  }));

  it('repeated erasure is idempotent: no row changes, all counts zero', () => inRollback(async () => {
    await seedTenants();
    const g = await seedGraph(ORG_A, subject('jane'));
    await erase(ORG_A, g.person);
    const tables = MAPPED_TABLES.filter((t) => t !== 'prospect_provenance_erasures');
    const after1 = await snapshot(tables);
    const r2 = await erase(ORG_A, g.person, [g.lead], 'retry');
    expect(r2.redacted).toBe(0);
    expect(r2.already_redacted).toBe(2);
    expect(Object.values(r2.counts).every((n) => n === 0)).toBe(true);
    expect(await snapshot(tables)).toEqual(after1);
    // After the person is gone a retry by lead id is still a no-op.
    await db.query('DELETE FROM public.unified_persons WHERE id=$1', [g.person]);
    const after2 = await snapshot(tables);
    const r3 = await erase(ORG_A, null, [g.lead], 'retry after delete');
    expect(Object.values(r3.counts).every((n) => n === 0)).toBe(true);
    expect(await snapshot(tables)).toEqual(after2);
  }));

  it('a failing step inside the call changes nothing, writes no tombstone, and the person is not deleted', () => inRollback(async () => {
    await seedTenants();
    const g = await seedGraph(ORG_A, subject('jane'));
    // Fail the LAST write the function makes, so every earlier step has run.
    await db.query(`CREATE FUNCTION public.w6_fail_erasure() RETURNS trigger LANGUAGE plpgsql AS
                    $$ BEGIN RAISE EXCEPTION 'w6 injected failure' USING ERRCODE = 'P0001'; END $$`);
    await db.query('CREATE TRIGGER w6_fail BEFORE UPDATE ON public.canonical_users FOR EACH ROW EXECUTE FUNCTION public.w6_fail_erasure()');
    const before = await snapshot();
    expect(await attempt(`SELECT ${FN}($1::uuid, $2::uuid, ARRAY[]::uuid[], 'r', 'x')`, [ORG_A, g.person])).toBe('P0001');
    expect(await snapshot()).toEqual(before);
    expect((await one(`SELECT count(*)::int n FROM ${EVENTS}`)).n).toBe(0);
    expect((await one(`SELECT count(*)::int n FROM ${TOMB}`)).n).toBe(0);
    expect(await one('SELECT id FROM public.unified_persons WHERE id=$1', [g.person])).toBeDefined();
    await db.query('DROP TRIGGER w6_fail ON public.canonical_users');
  }));

  it('cross-tenant attempts are refused (42501) and nothing changes', () => inRollback(async () => {
    await seedTenants();
    const g = await seedGraph(ORG_A, subject('jane'));
    const gb = await seedGraph(ORG_B, subject('carol'));
    const before = await snapshot();
    expect(await attempt(`SELECT ${FN}($1::uuid, $2::uuid, ARRAY[]::uuid[], 'r', 'x')`, [ORG_B, g.person])).toBe('42501');
    expect(await attempt(`SELECT ${FN}($1::uuid, NULL, $2::uuid[], 'r', 'x')`, [ORG_B, [g.lead]])).toBe('42501');
    expect(await attempt(`SELECT ${FN}($1::uuid, $2::uuid, $3::uuid[], 'r', 'x')`, [ORG_B, gb.person, [g.lead]])).toBe('42501');
    expect(await attempt(`SELECT ${LEGACY_FN}($1::uuid, $2::uuid[], 'r', 'x')`, [ORG_B, [g.lead, gb.lead]])).toBe('42501');
    expect(await snapshot()).toEqual(before);
  }));

  it('argument validation is 22023 and changes nothing', () => inRollback(async () => {
    await seedTenants();
    const g = await seedGraph(ORG_A, subject('jane'));
    const before = await snapshot();
    expect(await attempt(`SELECT ${FN}(NULL::uuid, $1::uuid, ARRAY[]::uuid[], 'r', 'x')`, [g.person])).toBe('22023');
    expect(await attempt(`SELECT ${FN}($1::uuid, NULL, ARRAY[]::uuid[], 'r', 'x')`, [ORG_A])).toBe('22023');
    expect(await attempt(`SELECT ${FN}($1::uuid, $2::uuid, ARRAY[]::uuid[], ' ', 'x')`, [ORG_A, g.person])).toBe('22023');
    expect(await attempt(`SELECT ${FN}($1::uuid, $2::uuid, ARRAY[]::uuid[], 'r', '')`, [ORG_A, g.person])).toBe('22023');
    expect(await attempt(`SELECT ${FN}($1::uuid, NULL, ARRAY[NULL]::uuid[], 'r', 'x')`, [ORG_A])).toBe('22023');
    expect(await snapshot()).toEqual(before);
  }));

  it('erased values cannot be recovered by external_ref / provider id lookup or by hash comparison', () => inRollback(async () => {
    await seedTenants();
    const jane = subject('jane');
    const g = await seedGraph(ORG_A, jane);
    await erase(ORG_A, g.person);
    await db.query('DELETE FROM public.unified_persons WHERE id=$1', [g.person]);
    const count = async (sql: string, p: unknown[]) => (await one(sql, p)).n;
    // Provider-keyed lookups an attacker (or a resync) would try.
    expect(await count(`SELECT count(*)::int n FROM ${PSC} WHERE external_ref = ANY($1)`,
      [[`apollo:${jane.providerPersonId}`, `crm:${jane.crmId}`]])).toBe(0);
    expect(await count(`SELECT count(*)::int n FROM public.source_records WHERE source_record_id=$1`, [jane.providerPersonId])).toBe(0);
    expect(await count(`SELECT count(*)::int n FROM public.contacts WHERE platform_user_id=$1 OR contact_key=$2`,
      [jane.handle, `reddit:${jane.handle}`])).toBe(0);
    expect(await count(`SELECT count(*)::int n FROM public.lead_signals WHERE source_id=$1`, [jane.messageId])).toBe(0);
    expect(await count(`SELECT count(*)::int n FROM public.engagement_messages WHERE platform_message_id=$1`, [jane.messageId])).toBe(0);
    expect(await count(`SELECT count(*)::int n FROM public.engagement_threads WHERE platform_thread_id=$1`, [jane.threadId])).toBe(0);
    expect(await count(`SELECT count(*)::int n FROM public.canonical_leads WHERE external_lead_key=$1`, [`apollo:${jane.providerPersonId}`])).toBe(0);
    expect(await count(`SELECT count(*)::int n FROM public.lead_intelligence WHERE dedupe_key=$1`, [`email:${jane.email}`])).toBe(0);
    // Hash comparison: recomputing the sha256 of a guessed value matches nothing anywhere.
    for (const h of guessableHashes(jane)) {
      expect(await count(`SELECT count(*)::int n FROM public.source_assertions WHERE value_hash=$1`, [h])).toBe(0);
      expect(await count(`SELECT count(*)::int n FROM public.source_records WHERE payload_hash=$1`, [h])).toBe(0);
    }
    expect(await residue(guessableHashes(jane))).toEqual([]);
    // The replacement markers are derived from row ids, not from values.
    const c = await one(`SELECT external_ref FROM ${PSC} WHERE id=$1`, [g.contribution]);
    expect(c.external_ref).toBe(`redacted:${g.contribution}`);
  }));

  it('contributions remain append-only for service_role; tombstones are not writable by it', () => inRollback(async () => {
    await seedTenants();
    const g = await seedGraph(ORG_A, subject('jane'));
    const r = await erase(ORG_A, g.person);
    const [t] = (await db.query(`SELECT id FROM ${TOMB} WHERE contribution_id=$1`, [g.contribution])).rows;
    await db.query('SET LOCAL ROLE service_role');
    const codes = [
      await attempt(`UPDATE ${PSC} SET source_url='https://x' WHERE id=$1`, [g.contribution]),
      await attempt(`DELETE FROM ${PSC} WHERE id=$1`, [g.contribution]),
      await attempt(`UPDATE ${TOMB} SET reason='edited' WHERE id=$1`, [t.id]),
      await attempt(`DELETE FROM ${TOMB} WHERE id=$1`, [t.id]),
      await attempt(`UPDATE ${EVENTS} SET reason='edited' WHERE id=$1`, [r.erasure_id]),
      await attempt(`DELETE FROM ${EVENTS} WHERE id=$1`, [r.erasure_id]),
      await attempt(`INSERT INTO ${EVENTS} (organization_id, subject_kind, reason, requested_by) VALUES ($1,'person','r','x')`, [ORG_A]),
    ];
    await db.query('RESET ROLE');
    expect(codes).toEqual(Array(7).fill('42501'));
  }));

  it('prospect-only erasure via the 20270108000001 entry point: same redaction, legacy result shape', () => inRollback(async () => {
    await seedTenants();
    const lead = await newLead(ORG_A);
    const c = (await one(
      `INSERT INTO ${PSC} (organization_id, canonical_lead_id, contribution_role, source_category, external_ref,
                           source_url, observed_at, evidence)
       VALUES ($1,$2,'originating','inbound_form','inbound_person:abc','https://x.test/p','2026-10-01T00:00:00Z','{"email":"p@x.test"}')
       RETURNING id`, [ORG_A, lead])).id;
    const r = await asServiceRole(async () => (await db.query(
      `SELECT ${LEGACY_FN}($1::uuid, $2::uuid[], 'r', 'x') AS r`, [ORG_A, [lead]])).rows[0].r);
    expect(r).toEqual({ redacted: 1, already_redacted: 0, contribution_ids: [c] });
    const row = await one(`SELECT external_ref, source_url, evidence FROM ${PSC} WHERE id=$1`, [c]);
    expect(row.external_ref).toBe(`redacted:${c}`);
    expect(row.source_url).toBeNull();
    expect(JSON.stringify(row)).not.toContain('p@x.test');
    expect((await one(`SELECT subject_kind FROM ${EVENTS} WHERE organization_id=$1`, [ORG_A])).subject_kind).toBe('prospect');
  }));
});

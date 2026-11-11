/**
 * 20270212000000: a contact-governance restriction is never "not yet in force" because a provider's
 * (or the application's) clock runs ahead of the database. effective_from := LEAST(supplied, now()),
 * computed by PostgreSQL in a BEFORE INSERT OR UPDATE OF effective_from trigger.
 *
 * Proven on real PostgreSQL after a full replay:
 *   - THE RULING'S CASE: a restriction written through the real writer (recordContactGovernance) with
 *     a provider time 2 h AHEAD of the database is stored at the database instant and BLOCKS contact
 *     immediately when judged at that instant (what read_at reports for a read in this transaction).
 *   - The stored value differs from the supplied one ON PURPOSE; the provider's time stays in
 *     evidence.occurredAt, so nothing is lost.
 *   - A PAST effective_from is stored unchanged (LEAST never flattens history; person-erasure
 *     re-inserts carry preserved past values).
 *   - An UPDATE moving effective_from into the future is clamped too (no second-statement window).
 *   - NEGATIVE CONTROL: with the trigger dropped (rolled back), the same write leaves contact ALLOWED,
 *     so the clamp is what closes the window, not something else.
 *   - PREMISE: the migration's own postcondition block, read from the migration file, holds; and it
 *     RAISES when the trigger is set to ENABLE REPLICA or DISABLE (fires on no ordinary write).
 *
 * The verdict is computed by mayContact at transaction_timestamp(), the instant read_at returns for a
 * read in this transaction; the PostgREST computed-field path itself is proven by
 * pi-contact-governance-postgrest.yml.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { db, inRollback, seedTenants, newPerson, attempt, ORG_A } from './setup';

/**
 * A minimal PostgREST double for the ONE call the writer makes on a fresh insert:
 * ownedDbTable('contact_governance_records').insert(row).select('id').single().
 * This A2 base predates the shared realschema transport. The insert itself is real SQL on the
 * real table, so the trigger under test runs exactly as it would behind PostgREST.
 */
jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => ({
    insert: (row: Record<string, unknown>) => ({
      select: (cols: string) => ({
        single: async () => {
          const { db: c } = require('./setup');
          const keys = Object.keys(row);
          const vals = keys.map((k) => { const v = row[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; });
          await c.query('SAVEPOINT w');
          try {
            const res = await c.query(
              `INSERT INTO public."${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_k, i) => `$${i + 1}`).join(', ')}) RETURNING ${cols}`,
              vals);
            await c.query('RELEASE SAVEPOINT w');
            return { data: res.rows[0], error: null };
          } catch (err) {
            await c.query('ROLLBACK TO SAVEPOINT w');
            return { data: null, error: err };
          }
        },
      }),
    }),
  }),
}));
jest.mock('../../db/supabaseClient', () => ({ __esModule: true, supabase: {} }));
jest.mock('@/config', () => ({ config: { ENCRYPTION_KEY: 'a'.repeat(64) }, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { recordContactGovernance } = require('../../services/prospectIdentity/contactGovernanceWriter');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mayContact } = require('../../services/prospectIdentity/contactGovernance');

const MIG = '20270212000000_contact_governance_records_clamp_effective_from.sql';
const POSTCONDITION = (() => {
  const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'migrations', MIG), 'utf8');
  const start = sql.indexOf('DO $post$');
  const end = sql.indexOf('$post$;', start + 'DO $post$'.length);
  if (start < 0 || end < 0) throw new Error(`postcondition block not found in ${MIG}`);
  return sql.slice(start, end + '$post$;'.length);
})();

const HOUR = 3600_000;
const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as Record<string, unknown>;
/** The database instant, as PostgreSQL renders it (what read_at carries for this transaction). */
const dbInstant = async (): Promise<string> => String((await one(`SELECT to_json(transaction_timestamp()) #>> '{}' AS t`)).t);
const shift = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();

async function record(person: string, effectiveFrom: string): Promise<string> {
  const r = await recordContactGovernance({
    organizationId: ORG_A, governanceType: 'unsubscribe', channel: 'email', personId: person,
    source: 'clamp-test', evidence: { occurredAt: effectiveFrom }, effectiveFrom,
  });
  const id = (r as { id?: string; recordId?: string }).id ?? (r as { recordId?: string }).recordId;
  if (!id) throw new Error(`writer returned no id: ${JSON.stringify(r)}`);
  return String(id);
}
async function stored(id: string) {
  const r = await one(`SELECT effective_from = transaction_timestamp() AS at_now, to_json(effective_from) #>> '{}' AS from_text,
                              evidence ->> 'occurredAt' AS occurred FROM public.contact_governance_records WHERE id = $1`, [id]);
  return { atNow: r.at_now === true, fromText: String(r.from_text), occurred: String(r.occurred) };
}
async function verdictAtDbInstant(person: string): Promise<string> {
  const rows = (await db.query(`SELECT id, organization_id, person_id, target_normalized, channel, governance_type,
      to_json(effective_from) #>> '{}' AS effective_from, to_json(effective_until) #>> '{}' AS effective_until,
      revoked_at, purpose_scope FROM public.contact_governance_records WHERE organization_id = $1 AND person_id = $2`, [ORG_A, person])).rows;
  const records = rows.map((r: Record<string, unknown>) => ({
    id: String(r.id), organizationId: String(r.organization_id), personId: String(r.person_id), targetNormalized: null,
    channel: String(r.channel), governanceType: String(r.governance_type), effectiveFrom: String(r.effective_from),
    effectiveUntil: r.effective_until === null ? null : String(r.effective_until), revokedAt: null, purposeScope: null,
  }));
  return mayContact({ organizationId: ORG_A, personId: person, targetNormalized: null, channel: 'email', now: await dbInstant(), records }).decision;
}

beforeAll(seedTenants);

describe('20270212000000: effective_from is clamped to the database instant', () => {
  it("THE RULING'S CASE: a provider time 2 h AHEAD is stored at the database instant and blocks contact immediately", () => inRollback(async () => {
    const person = await newPerson(ORG_A);
    const ahead = shift(await dbInstant(), 2 * HOUR);
    const id = await record(person, ahead);
    const s = await stored(id);
    expect(s.atNow).toBe(true);                              // stored = the database instant
    expect(Date.parse(s.fromText)).toBeLessThan(Date.parse(ahead)); // DIFFERS from the supplied value, on purpose
    expect(s.occurred).toBe(ahead);                          // the provider's claim is kept as evidence
    expect(await verdictAtDbInstant(person)).not.toBe('allowed');
  }));

  it('a PAST effective_from is stored unchanged (LEAST never flattens history)', () => inRollback(async () => {
    const person = await newPerson(ORG_A);
    const past = shift(await dbInstant(), -HOUR);
    const id = await record(person, past);
    const s = await stored(id);
    expect(s.atNow).toBe(false);
    expect(Date.parse(s.fromText)).toBe(Date.parse(past));
    expect(await verdictAtDbInstant(person)).not.toBe('allowed');
  }));

  it('an UPDATE moving effective_from into the future is clamped as well (no second-statement window)', () => inRollback(async () => {
    const person = await newPerson(ORG_A);
    const id = await record(person, shift(await dbInstant(), -HOUR));
    await db.query(`UPDATE public.contact_governance_records SET effective_from = transaction_timestamp() + interval '2 hours' WHERE id = $1`, [id]);
    expect((await stored(id)).atNow).toBe(true);
    expect(await verdictAtDbInstant(person)).not.toBe('allowed');
  }));

  it('NEGATIVE CONTROL: without the trigger, the same 2 h-ahead write leaves contact ALLOWED (the clamp is what closes it)', () => inRollback(async () => {
    await db.query('DROP TRIGGER trg_contact_governance_records_clamp_effective_from ON public.contact_governance_records'); // rolled back
    const person = await newPerson(ORG_A);
    const ahead = shift(await dbInstant(), 2 * HOUR);
    const id = await record(person, ahead);
    expect(Date.parse((await stored(id)).fromText)).toBe(Date.parse(ahead));
    expect(await verdictAtDbInstant(person)).toBe('allowed');
  }));

  it("PREMISE: the migration's postcondition holds, and RAISES for ENABLE REPLICA and DISABLE", () => inRollback(async () => {
    expect(await attempt(POSTCONDITION)).toBe('ok');
    for (const mode of ['ENABLE REPLICA', 'DISABLE']) {
      await db.query('SAVEPOINT premise');
      await db.query(`ALTER TABLE public.contact_governance_records ${mode} TRIGGER trg_contact_governance_records_clamp_effective_from`);
      expect(await attempt(POSTCONDITION)).toBe('P0001');
      await db.query('ROLLBACK TO SAVEPOINT premise');
    }
    expect(await attempt(POSTCONDITION)).toBe('ok');
  }));

  it('PREMISE: a trigger broadened to EVERY update (no column restriction) makes the postcondition RAISE (tgattr is asserted)', () => inRollback(async () => {
    await db.query('DROP TRIGGER trg_contact_governance_records_clamp_effective_from ON public.contact_governance_records');
    await db.query(`CREATE TRIGGER trg_contact_governance_records_clamp_effective_from
      BEFORE INSERT OR UPDATE ON public.contact_governance_records
      FOR EACH ROW EXECUTE FUNCTION public.contact_governance_records_clamp_effective_from()`); // rolled back
    expect(await attempt(POSTCONDITION)).toBe('P0001');
  }));

  it('PREMISE: a function body that loses the NULL guard makes the postcondition RAISE (the guard is pinned, not only tested)', () => inRollback(async () => {
    await db.query(`CREATE OR REPLACE FUNCTION public.contact_governance_records_clamp_effective_from()
      RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
      BEGIN NEW.effective_from := LEAST(NEW.effective_from, now()); RETURN NEW; END $f$`); // rolled back
    expect(await attempt(POSTCONDITION)).toBe('P0001');
  }));

  it('an explicitly supplied NULL is NOT silently clamped: NOT NULL still refuses it (23502)', () => inRollback(async () => {
    const person = await newPerson(ORG_A);
    expect(await attempt(
      `INSERT INTO public.contact_governance_records (organization_id, person_id, channel, governance_type, source, effective_from)
       VALUES ($1, $2, 'email', 'unsubscribe', 'clamp-test', NULL)`, [ORG_A, person])).toBe('23502');
  }));
});

/**
 * Orchestration's two contact-governance call sites judge "in force" at the DATABASE instant,
 * never the application clock (folded into S by virality-e9, 2026-11-11; the same P0 class
 * fix/pi-contact-governance-clock closed for PI with 20270202000000 + evaluateGovernanceReads).
 *
 *   individualIntelligence.durableIntelligencePort.channelPermission  (journey facts: may we contact?)
 *   journeyResponses.durableJourneyResponsePort.personRestrictions     (journey exits on a restriction)
 *
 * The defect being closed: both used to evaluate effective_from / effective_until against the
 * caller's `now`. An application clock running AHEAD of the database could see a still-active
 * deferral as expired and UNLOCK contact. Here every read is judged at its own `read_at`
 * (transaction_timestamp() of the read), so the caller's clock is irrelevant.
 *
 * Proven on real PostgreSQL:
 *   - NEGATIVE CONTROL (the defect): with the caller's clock 2 hours AHEAD of the database, a
 *     deferral that the DATABASE still has in force keeps contact BLOCKED and stays a restriction.
 *   - POSITIVE CONTROL (not vacuous): a deferral the DATABASE has already ended allows contact and
 *     is not a restriction, even with the caller's clock 2 hours BEHIND (before it ended).
 *   - The caller's `now` changes nothing: the same answers for a far-past and a far-future clock.
 */
import { db, inRollback, seedTenants, newPerson, ORG_A } from './setup';

jest.mock('../../db/writeOwner', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, ownedDbTable: (t: string) => pgTable(client, t), ownedDbRpc: pgRpc(client) };
});
jest.mock('../../db/supabaseClient', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, supabase: { from: (t: string) => pgTable(client, t), rpc: pgRpc(client) } };
});
jest.mock('@/config', () => ({ config: { ENCRYPTION_KEY: 'a'.repeat(64) }, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { durableIntelligencePort } = require('../../services/orchestration/individualIntelligence');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { durableJourneyResponsePort } = require('../../services/orchestration/journeyResponses');

const HOUR = 3600_000;
const dbNowMs = async (): Promise<number> =>
  Date.parse(String((await db.query(`SELECT to_json(transaction_timestamp()) #>> '{}' AS t`)).rows[0].t));

/** A person-anchored email deferral with an explicit window, relative to the DATABASE clock. */
async function deferral(person: string, fromOffset: string, untilOffset: string): Promise<void> {
  await db.query(
    `INSERT INTO public.contact_governance_records
       (organization_id, person_id, target_normalized, channel, governance_type, source, effective_from, effective_until)
     VALUES ($1, $2, NULL, 'email', 'deferred', 'orch-read-at-test', transaction_timestamp() + $3::interval, transaction_timestamp() + $4::interval)`,
    [ORG_A, person, fromOffset, untilOffset],
  );
}

beforeAll(seedTenants);

describe('Orchestration governance is judged at the database instant, not the app clock', () => {
  it('NEGATIVE CONTROL: app clock 2 h AHEAD of the database does NOT unlock a deferral the database still has in force', () => inRollback(async () => {
    const person = await newPerson(ORG_A);
    await deferral(person, '-1 hour', '+1 hour');                 // in force at the DB instant; "expired" at DB+2h
    const appAhead = new Date((await dbNowMs()) + 2 * HOUR).toISOString();
    expect(await durableIntelligencePort.channelPermission(ORG_A, person, 'email', null, appAhead)).toBe(false);
    expect(await durableJourneyResponsePort.personRestrictions(ORG_A, person, appAhead)).toContain('deferred');
  }));

  it('POSITIVE CONTROL: a deferral the database has ENDED allows contact, even with the app clock 2 h BEHIND', () => inRollback(async () => {
    const person = await newPerson(ORG_A);
    await deferral(person, '-3 hours', '-1 hour');                // ended at the DB instant; "in force" at DB-2h
    const appBehind = new Date((await dbNowMs()) - 2 * HOUR).toISOString();
    expect(await durableIntelligencePort.channelPermission(ORG_A, person, 'email', null, appBehind)).toBe(true);
    expect(await durableJourneyResponsePort.personRestrictions(ORG_A, person, appBehind)).not.toContain('deferred');
  }));

  it("the caller's clock changes nothing: far past and far future give the same database-instant answers", () => inRollback(async () => {
    const active = await newPerson(ORG_A);
    const ended = await newPerson(ORG_A);
    await deferral(active, '-1 hour', '+1 hour');
    await deferral(ended, '-3 hours', '-1 hour');
    for (const clock of ['1970-01-01T00:00:00.000Z', '2999-01-01T00:00:00.000Z']) {
      expect(await durableIntelligencePort.channelPermission(ORG_A, active, 'email', null, clock)).toBe(false);
      expect(await durableIntelligencePort.channelPermission(ORG_A, ended, 'email', null, clock)).toBe(true);
      expect(await durableJourneyResponsePort.personRestrictions(ORG_A, active, clock)).toContain('deferred');
      expect(await durableJourneyResponsePort.personRestrictions(ORG_A, ended, clock)).not.toContain('deferred');
    }
  }));
});

/**
 * RECOMMENDATION LIFECYCLE STATUS — against real PostgreSQL.
 *
 * Three things can only be proven here rather than against a mock:
 *   - the CHECK actually ACCEPTS `no_longer_surfaced`, which is what the writer
 *     now emits. If the migration has not been applied this fails, and that is
 *     the point: the application union and the database constraint must agree or
 *     every snapshot write breaks;
 *   - the CHECK still REJECTS a value outside the closed vocabulary, so the
 *     column cannot silently accept anything;
 *   - the four PRE-EXISTING values remain valid, which is what makes the
 *     migration backward compatible with an older application version.
 *
 * WHY THE WRITE PATH MATTERS HERE. `SupabaseHistoryStore.writeSnapshot` inserts
 * the snapshot bundle as serial awaited statements and throws on the first
 * error, with `report_recommendation_history` fourth of five. Its retries are
 * not idempotent — `id` is the primary key and (company_id, observed_at) is
 * UNIQUE — so a rejected status leaves a partially written snapshot that no
 * retry can repair. A rejection must therefore be LOUD, which the last block
 * pins.
 *
 * LEGACY ROWS ARE NEVER TOUCHED. Nothing here updates or deletes a row written
 * by anything other than this suite; every insert uses this suite's own
 * company_id and is removed afterwards.
 *
 * NOT EXECUTED BY THE AUTHOR: this suite requires `W6_DB_URL` and a disposable
 * database (scripts/ci/real-schema-ci.sh). It is written to the same contract as
 * its siblings and has not been run locally.
 */
import { db, constraintDef } from './setup';

const COMPANY = 'rec-status-vocab-suite';
const CONSTRAINT = 'report_recommendation_history_status_check';

/** Every value the application may write. Mirrors `RecommendationHistoryRecord['status']`. */
const ALLOWED = ['first_seen', 'persistent', 'resolved', 'regressed', 'no_longer_surfaced'] as const;

/** The four that existed before the lifecycle correction. */
const LEGACY = ['first_seen', 'persistent', 'resolved', 'regressed'] as const;

let seq = 0;
/** Insert one row with the given status. Unique id and observed_at per call. */
async function insertStatus(status: string): Promise<void> {
  seq += 1;
  await db.query(
    `INSERT INTO public.report_recommendation_history
       (id, company_id, observed_at, action_id, title, pillar, severity, leverage_score, status)
     VALUES (gen_random_uuid(), $1, now() + ($2 || ' seconds')::interval,
             $3, 'Fix titles', 'foundation', 'moderate', 7, $4)`,
    [COMPANY, String(seq), `seo:Fix titles ${seq}`, status],
  );
}

afterEach(async () => {
  await db.query(`DELETE FROM public.report_recommendation_history WHERE company_id = $1`, [COMPANY]);
});

describe('the status constraint exists and names the full vocabulary', () => {
  it('the CHECK is present and lists every allowed value', async () => {
    const def = await constraintDef(CONSTRAINT);
    expect(def).not.toBeNull();
    for (const status of ALLOWED) expect(def).toContain(status);
  });
});

describe('every value the application writes is accepted', () => {
  for (const status of ALLOWED) {
    it(`accepts ${status}`, async () => {
      await expect(insertStatus(status)).resolves.toBeUndefined();
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.report_recommendation_history
          WHERE company_id = $1 AND status = $2`, [COMPANY, status],
      );
      expect(rows[0].n).toBe(1);
    });
  }
});

describe('the four pre-existing values remain valid after the migration', () => {
  it('an older application version, which writes only these, still succeeds', async () => {
    for (const status of LEGACY) await insertStatus(status);
    const { rows } = await db.query(
      `SELECT count(*)::int n FROM public.report_recommendation_history WHERE company_id = $1`,
      [COMPANY],
    );
    expect(rows[0].n).toBe(LEGACY.length);
  });
});

describe('the vocabulary is CLOSED — a rejection is loud, not swallowed', () => {
  // `'new'` is the value a fixture in report1DurableHistoryPersistence carried
  // behind `as unknown as` until this slice corrected it. It must be refused.
  for (const status of ['new', 'completed', 'no_longer_surfaced ', '']) {
    it(`rejects ${JSON.stringify(status)} with a check violation`, async () => {
      await expect(insertStatus(status)).rejects.toMatchObject({ code: '23514' });
    });
  }

  it('a rejected insert writes NOTHING — the failure is not partially applied', async () => {
    await insertStatus('persistent');
    await expect(insertStatus('definitely_not_a_status')).rejects.toMatchObject({ code: '23514' });
    const { rows } = await db.query(
      `SELECT count(*)::int n FROM public.report_recommendation_history WHERE company_id = $1`,
      [COMPANY],
    );
    // Only the valid row survives; the rejected one left no trace.
    expect(rows[0].n).toBe(1);
  });
});

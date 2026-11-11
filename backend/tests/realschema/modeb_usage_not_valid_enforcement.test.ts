/**
 * 20270209000000 adds its attempt-table CHECKs NOT VALID; a SEPARATE migration
 * validates them. Between the two, the ONLY protection is enforcement on new
 * and updated rows (PI review, 2026-11-11). An empty-table apply cannot show
 * that, so this suite reproduces the in-between state and proves the two
 * decision-bearing CHECKs REJECT illegitimate rows:
 *   pda_screening_within_observed  R3 accounting (screened <= observed)
 *   pea_tenant_funding_uncharged   the owner's funding rule (own key => 0 credits)
 *
 * The in-between state is rebuilt inside a rolled-back transaction: the
 * constraint is dropped and re-added NOT VALID with its OWN current definition
 * (read from the catalogue, not retyped), and `convalidated = false` is
 * asserted before the probe, so the test cannot silently run against a
 * validated constraint.
 */
import { db, inRollback, seedTenants, newAccount, ORG_A } from './setup';

/** Run a statement under a savepoint; return 'ok' or `<sqlstate>:<constraint>`. */
async function probe(sql: string, params: unknown[] = []): Promise<string> {
  await db.query('SAVEPOINT p');
  try {
    await db.query(sql, params);
    await db.query('ROLLBACK TO SAVEPOINT p');
    return 'ok';
  } catch (err: any) {
    await db.query('ROLLBACK TO SAVEPOINT p');
    return `${err.code ?? 'unknown'}:${err.constraint ?? ''}`;
  }
}

/** Put a constraint into the state 20270209 leaves it in: present, NOT VALID. */
async function makeNotValid(table: string, name: string): Promise<void> {
  const { rows } = await db.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = $1 AND conrelid = $2::regclass`, [name, table]);
  expect(rows).toHaveLength(1);
  await db.query(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`);
  await db.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${rows[0].def} NOT VALID`);
  const v = await db.query(
    `SELECT convalidated FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass`, [name, table]);
  expect(v.rows[0].convalidated).toBe(false);
}

const DIGEST = 'a'.repeat(64);

async function discoveryRow(): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.prospect_discovery_attempts (organization_id, provider_key, search_criteria, search_digest,
        max_pages, max_results, max_provider_calls, attempt_number, correlation_id, started_at)
     VALUES ($1, 'modeb-nv', '{}'::jsonb, $2, 1, 10, 1, 1, 'c-nv', now()) RETURNING id`, [ORG_A, DIGEST]);
  return rows[0].id;
}

async function enrichmentRow(): Promise<string> {
  const account = await newAccount(ORG_A);
  const { rows } = await db.query(
    `INSERT INTO public.prospect_enrichment_attempts (organization_id, account_id, provider_key, requested_attributes,
        attempt_number, correlation_id, started_at, provider_call_state, outcome)
     VALUES ($1, $2, 'modeb-nv', '{employee_count}', 1, 'c-nv', now(), 'not_called', NULL) RETURNING id`,
    [ORG_A, account]);
  return rows[0].id;
}

describe('20270209 NOT VALID window: new rows are still enforced', () => {
  it('pda_screening_within_observed REJECTS screened counts exceeding observed (R3 accounting)', async () => {
    await inRollback(async () => {
      await seedTenants();
      await makeNotValid('public.prospect_discovery_attempts', 'pda_screening_within_observed');
      const id = await discoveryRow();      // observed 0, ingested 0
      expect(await probe(
        `UPDATE public.prospect_discovery_attempts SET results_held_for_review = 1 WHERE id = $1`, [id],
      )).toBe('23514:pda_screening_within_observed');
      // NEGATIVE CONTROL: within observed is admitted.
      expect(await probe(
        `UPDATE public.prospect_discovery_attempts SET results_held_for_review = 0, results_skipped_duplicate = 0 WHERE id = $1`, [id],
      )).toBe('ok');
    });
  });

  it('pea_tenant_funding_uncharged REJECTS credits on an own-key (tenant) call (owner funding rule)', async () => {
    await inRollback(async () => {
      await seedTenants();
      await makeNotValid('public.prospect_enrichment_attempts', 'pea_tenant_funding_uncharged');
      const id = await enrichmentRow();
      expect(await probe(
        `UPDATE public.prospect_enrichment_attempts SET funding = 'tenant', credits_charged = 1 WHERE id = $1`, [id],
      )).toBe('23514:pea_tenant_funding_uncharged');
      // NEGATIVE CONTROLS: own key at 0 credits, and platform funding with credits, are admitted.
      expect(await probe(
        `UPDATE public.prospect_enrichment_attempts SET funding = 'tenant', credits_charged = 0 WHERE id = $1`, [id],
      )).toBe('ok');
      expect(await probe(
        `UPDATE public.prospect_enrichment_attempts SET funding = 'platform', credits_charged = 18, provider_cost_units = 1 WHERE id = $1`, [id],
      )).toBe('ok');
    });
  });

  it('the other seven NOT VALID CHECKs also refuse one illegitimate value each', async () => {
    await inRollback(async () => {
      await seedTenants();
      const e = await enrichmentRow();
      const d = await discoveryRow();
      const cases: Array<[string, string, string, string]> = [
        ['public.prospect_enrichment_attempts', 'pea_funding_valid', `funding = 'someone'`, e],
        ['public.prospect_enrichment_attempts', 'pea_cost_units_nonnegative', `provider_cost_units = -1`, e],
        ['public.prospect_enrichment_attempts', 'pea_credits_nonnegative', `credits_charged = -1`, e],
        ['public.prospect_discovery_attempts', 'pda_funding_valid', `funding = 'someone'`, d],
        ['public.prospect_discovery_attempts', 'pda_credits_nonnegative', `credits_charged = -1`, d],
        ['public.prospect_discovery_attempts', 'pda_tenant_funding_uncharged', `funding = 'tenant', credits_charged = 2`, d],
        ['public.prospect_discovery_attempts', 'pda_screening_nonnegative', `results_probe_unknown = -1`, d],
      ];
      for (const [table, name, set, id] of cases) {
        await makeNotValid(table, name);
        expect(await probe(`UPDATE ${table} SET ${set} WHERE id = $1`, [id])).toBe(`23514:${name}`);
      }
    });
  });
});

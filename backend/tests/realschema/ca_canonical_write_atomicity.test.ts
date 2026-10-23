/**
 * CA — `pi_apply_canonical_decisions` against real PostgreSQL.
 *
 * This is the contract of the function that replaced the boundary's three
 * separately-committed writes. Every property here is one a unit test cannot
 * establish, and the first two are ones a unit test would have asserted
 * FALSELY: whether a failure late in the write rolls the canonical column back
 * is a property of a transaction, and a fake store has no transaction.
 *
 * The forced failures below are real. A trigger is created inside the test's own
 * rolled-back transaction so the decision insert or the provenance stamp
 * genuinely raises inside the function — nothing is mocked, stubbed or
 * simulated, and the canonical column is then read back with a separate query.
 *
 * The function is called DIRECTLY here. That is deliberate: this file is about
 * the function's own contract, and arbitration is not involved in any of it.
 * The boundary-level proof — that `ingestSourceRecord` as a whole is now atomic
 * — lives in `b1b_arbitration.test.ts`, which already drives the real boundary.
 */
import {
  db, inRollback, seedTenants, ORG_A, ORG_B, newPerson, newAccount,
} from './setup';
import {
  PERSON_ATTRIBUTE_COLUMNS, ACCOUNT_ATTRIBUTE_COLUMNS,
} from '../../services/prospectIdentity/attributes';

const NOW = '2026-03-01T00:00:00.000Z';
const HASH = 'a'.repeat(64);

/** A source record, because `source_assertions` has a composite FK onto one. */
async function newSourceRecord(org: string, ref = 'CA-REC-1'): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.source_records
       (organization_id, provider, source_entity_type, source_record_id, payload_hash)
     VALUES ($1, 'alpha', 'person', $2, $3) RETURNING id`,
    [org, ref, HASH],
  );
  return rows[0].id;
}

interface AssertionOpts {
  attribute?: string;
  value?: string | null;
  entityType?: 'person' | 'account';
  personId?: string | null;
  accountId?: string | null;
  supersededAt?: string | null;
  appliedAt?: string | null;
  appliedReason?: string | null;
}

/** One live assertion. Returns its id. */
async function newAssertion(
  org: string, sourceRecordId: string, opts: AssertionOpts = {},
): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.source_assertions
       (organization_id, source_record_id, entity_type, person_id, account_id,
        attribute, normalized_value, value_hash, provider, observed_at,
        superseded_at, applied_to_canonical_at, applied_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'alpha',$9,$10,$11,$12) RETURNING id`,
    [
      org, sourceRecordId, opts.entityType ?? 'person',
      opts.personId ?? null, opts.accountId ?? null,
      opts.attribute ?? 'job_title', opts.value ?? 'VP Sales', HASH,
      NOW, opts.supersededAt ?? null,
      opts.appliedAt ?? null, opts.appliedReason ?? null,
    ],
  );
  return rows[0].id;
}

/** Call the function. Returns the applied count, or throws the SQLSTATE. */
async function apply(
  org: string, entityType: string, targetId: string,
  decisions: Array<Record<string, unknown>>,
  provider = 'alpha', now: string = NOW,
): Promise<number> {
  const { rows } = await db.query(
    `SELECT public.pi_apply_canonical_decisions(
       p_organization_id => $1, p_entity_type => $2, p_target_id => $3,
       p_provider => $4, p_now => $5, p_decisions => $6) AS applied`,
    [org, entityType, targetId, provider, now, JSON.stringify(decisions)],
  );
  return Number(rows[0].applied);
}

/** Call it and return the error message, or null when it succeeded. */
async function refusal(
  org: string, entityType: string, targetId: string,
  decisions: Array<Record<string, unknown>>,
): Promise<string | null> {
  await db.query('SAVEPOINT ca');
  try {
    await apply(org, entityType, targetId, decisions);
    await db.query('ROLLBACK TO SAVEPOINT ca');
    return null;
  } catch (err: any) {
    await db.query('ROLLBACK TO SAVEPOINT ca');
    return String(err.message ?? err);
  }
}

const titleOf = async (personId: string): Promise<string | null> => {
  const { rows } = await db.query(
    'SELECT job_title FROM public.unified_persons WHERE id=$1', [personId],
  );
  return rows[0]?.job_title ?? null;
};

const decisionCount = async (org: string): Promise<number> => {
  const { rows } = await db.query(
    'SELECT count(*)::int c FROM public.canonical_attribute_decisions WHERE organization_id=$1', [org],
  );
  return rows[0].c;
};

const decision = (assertionId: string, over: Record<string, unknown> = {}) => ({
  attribute: 'job_title', value: 'VP Sales',
  assertion_id: assertionId, reason: 'single_uncontested_assertion',
  ...over,
});

describe('CA — the function exists with the expected shape', () => {
  it('1. is plpgsql and is NOT security definer, so it adds no privilege path', async () => {
    const { rows } = await db.query(
      `SELECT l.lanname, p.prosecdef
         FROM pg_proc p
         JOIN pg_language l ON l.oid = p.prolang
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname='pi_apply_canonical_decisions'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].lanname).toBe('plpgsql');
    // SECURITY DEFINER would let a caller write these tables with the function
    // owner's rights. The precedent (pi_relationship_set_primary) is invoker
    // rights and so is this.
    expect(rows[0].prosecdef).toBe(false);
  });

  it('2. the SQL allowlist EQUALS the TypeScript allowlist, per entity type', async () => {
    // Two copies of one list is a drift risk. This is the test that makes drift
    // a failure instead of a silent widening of the canonical write surface.
    for (const [entity, expected] of [
      ['person', PERSON_ATTRIBUTE_COLUMNS],
      ['account', ACCOUNT_ATTRIBUTE_COLUMNS],
    ] as const) {
      const { rows } = await db.query(
        'SELECT public.pi_canonical_attribute_allowlist($1) AS cols', [entity],
      );
      const sql: string[] = rows[0].cols;
      expect(sql).not.toBeNull();
      expect([...sql].sort()).toEqual([...expected].sort());
      // A duplicate would make the set comparison pass while the list is wrong.
      expect(new Set(sql).size).toBe(sql.length);
    }
  });

  it('3. an unknown entity type has no allowlist at all', async () => {
    const { rows } = await db.query(
      `SELECT public.pi_canonical_attribute_allowlist('relationship') AS cols`,
    );
    expect(rows[0].cols).toBeNull();
  });
});

describe('CA — atomicity: a later failure rolls the canonical update back', () => {
  it('4. a failing DECISION INSERT leaves the canonical column unchanged', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const rec = await newSourceRecord(ORG_A);
      const a = await newAssertion(ORG_A, rec, { personId: person });

      await db.query(
        `UPDATE public.unified_persons SET job_title='Head of Sales' WHERE id=$1`, [person],
      );
      expect(await titleOf(person)).toBe('Head of Sales');

      // A REAL failure, inside the function, after the canonical update.
      await db.query(`
        CREATE OR REPLACE FUNCTION public.ca_block_decisions() RETURNS trigger
        LANGUAGE plpgsql AS $fn$
        BEGIN RAISE EXCEPTION 'ca: decision insert blocked'; END $fn$;`);
      await db.query(`
        CREATE TRIGGER ca_block_decisions BEFORE INSERT
          ON public.canonical_attribute_decisions
          FOR EACH ROW EXECUTE FUNCTION public.ca_block_decisions();`);

      const err = await refusal(ORG_A, 'person', person, [decision(a)]);
      expect(err).toContain('ca: decision insert blocked');

      // THE PROPERTY. Before this change the canonical update had already
      // committed by the time the decision insert ran, so this read returned
      // 'VP Sales' with no decision row to explain it — permanently, because a
      // retry skips an attribute whose canonical value already matches.
      expect(await titleOf(person)).toBe('Head of Sales');
      expect(await decisionCount(ORG_A)).toBe(0);
    });
  });

  it('5. a failing PROVENANCE STAMP also leaves the canonical column unchanged', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const rec = await newSourceRecord(ORG_A);
      const a = await newAssertion(ORG_A, rec, { personId: person });
      await db.query(
        `UPDATE public.unified_persons SET job_title='Head of Sales' WHERE id=$1`, [person],
      );

      // The stamp is the LAST of the three writes, so this is the narrowest
      // window the old code had and the easiest one to have dismissed.
      await db.query(`
        CREATE OR REPLACE FUNCTION public.ca_block_stamp() RETURNS trigger
        LANGUAGE plpgsql AS $fn$
        BEGIN
          IF NEW.applied_to_canonical_at IS NOT NULL THEN
            RAISE EXCEPTION 'ca: stamp blocked';
          END IF;
          RETURN NEW;
        END $fn$;`);
      await db.query(`
        CREATE TRIGGER ca_block_stamp BEFORE UPDATE
          ON public.source_assertions
          FOR EACH ROW EXECUTE FUNCTION public.ca_block_stamp();`);

      const err = await refusal(ORG_A, 'person', person, [decision(a)]);
      expect(err).toContain('ca: stamp blocked');
      expect(await titleOf(person)).toBe('Head of Sales');
      expect(await decisionCount(ORG_A)).toBe(0);
    });
  });

  it('6. on success the canonical value, the decision and the stamp are ALL present', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const rec = await newSourceRecord(ORG_A);
      const a = await newAssertion(ORG_A, rec, { personId: person });

      expect(await apply(ORG_A, 'person', person, [decision(a)])).toBe(1);

      expect(await titleOf(person)).toBe('VP Sales');
      const { rows: d } = await db.query(
        `SELECT entity_type, person_id, account_id, attribute, value, reason, assertion_id
           FROM public.canonical_attribute_decisions WHERE organization_id=$1`, [ORG_A],
      );
      expect(d).toHaveLength(1);
      expect(d[0]).toMatchObject({
        entity_type: 'person', person_id: person, account_id: null,
        attribute: 'job_title', value: 'VP Sales',
        reason: 'single_uncontested_assertion', assertion_id: a,
      });
      const { rows: s } = await db.query(
        `SELECT applied_reason, applied_to_canonical_at FROM public.source_assertions WHERE id=$1`, [a],
      );
      expect(s[0].applied_reason).toBe('single_uncontested_assertion');
      expect(s[0].applied_to_canonical_at).not.toBeNull();

      // The provider metadata travels with the write, as it did before.
      const { rows: m } = await db.query(
        `SELECT attributes_source FROM public.unified_persons WHERE id=$1`, [person],
      );
      expect(m[0].attributes_source).toBe('alpha');
    });
  });

  it('7. in a MULTI-attribute batch, one bad element writes NOTHING', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const rec = await newSourceRecord(ORG_A);
      const good = await newAssertion(ORG_A, rec, { personId: person });
      const bad = await newAssertion(ORG_A, rec, {
        personId: person, attribute: 'department', value: 'Sales',
      });

      const err = await refusal(ORG_A, 'person', person, [
        decision(good),
        // Same assertion, but claiming a value it does not attest.
        decision(bad, { attribute: 'department', value: 'Marketing' }),
      ]);
      expect(err).toContain('does not attest attribute department');

      expect(await titleOf(person)).toBeNull();
      expect(await decisionCount(ORG_A)).toBe(0);
    });
  });
});

describe('CA — the write surface cannot be widened by a caller', () => {
  it('8. a non-allowlisted column is refused, and nothing is written', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const rec = await newSourceRecord(ORG_A);
      // The assertion genuinely attests it, so the ONLY thing standing between
      // the caller and the column is the allowlist.
      const a = await newAssertion(ORG_A, rec, {
        personId: person, attribute: 'company_id', value: ORG_B,
      });

      const err = await refusal(ORG_A, 'person', person, [
        decision(a, { attribute: 'company_id', value: ORG_B }),
      ]);
      expect(err).toContain('not writable for entity type person');

      const { rows } = await db.query(
        'SELECT company_id FROM public.unified_persons WHERE id=$1', [person],
      );
      expect(rows[0].company_id).toBe(ORG_A);
      expect(await decisionCount(ORG_A)).toBe(0);
    });
  });

  it('9. an ACCOUNT-only attribute is refused on a person', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const rec = await newSourceRecord(ORG_A);
      const a = await newAssertion(ORG_A, rec, {
        personId: person, attribute: 'industry', value: 'Software',
      });
      const err = await refusal(ORG_A, 'person', person, [
        decision(a, { attribute: 'industry', value: 'Software' }),
      ]);
      expect(err).toContain('not writable for entity type person');
    });
  });

  it('10. the relationship entity type is refused outright', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      // The relationship path has its own writer and its own remediation scope.
      // This function must never become a second way in.
      const err = await refusal(ORG_A, 'relationship', person, []);
      expect(err).toContain('unsupported entity type relationship');
    });
  });
});

describe('CA — tenant and subject binding', () => {
  it('11. another tenant\'s canonical row is refused', async () => {
    await inRollback(async () => {
      await seedTenants();
      // The subject and its evidence both live in ORG_B, correctly. ORG_A then
      // tries to write that row.
      //
      // Note what this test CANNOT do: it cannot give ORG_A an assertion about
      // an ORG_B person, because `source_assertions_person_tenant_fk` is the
      // composite key (person_id, organization_id) -> unified_persons(id,
      // company_id), so that row is unconstructible. The refusal below is
      // therefore the SECOND line of defence and the schema is the first.
      const person = await newPerson(ORG_B);
      const recB = await newSourceRecord(ORG_B, 'CA-REC-B11');
      const a = await newAssertion(ORG_B, recB, { personId: person });

      const err = await refusal(ORG_A, 'person', person, [decision(a)]);
      expect(err).toContain('no unified_persons row');
      expect(await titleOf(person)).toBeNull();
    });
  });

  it('12. another tenant\'s assertion cannot justify this tenant\'s write', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const other = await newPerson(ORG_B);
      const recB = await newSourceRecord(ORG_B, 'CA-REC-B');
      const foreign = await newAssertion(ORG_B, recB, { personId: other });

      const err = await refusal(ORG_A, 'person', person, [decision(foreign)]);
      expect(err).toContain('does not attest attribute job_title');
      expect(await titleOf(person)).toBeNull();
    });
  });

  it('13. an assertion about a DIFFERENT subject in the same tenant is refused', async () => {
    await inRollback(async () => {
      await seedTenants();
      const target = await newPerson(ORG_A);
      const someoneElse = await newPerson(ORG_A);
      const rec = await newSourceRecord(ORG_A);
      const a = await newAssertion(ORG_A, rec, { personId: someoneElse });

      // Same tenant, same attribute, same value — but it is evidence about
      // another person, so it cannot justify writing this one.
      const err = await refusal(ORG_A, 'person', target, [decision(a)]);
      expect(err).toContain('does not attest attribute job_title');
      expect(await titleOf(target)).toBeNull();
    });
  });

  it('14. a person-leg assertion cannot justify an ACCOUNT write', async () => {
    await inRollback(async () => {
      await seedTenants();
      const account = await newAccount(ORG_A);
      const person = await newPerson(ORG_A);
      const rec = await newSourceRecord(ORG_A);
      // entity_type='person' with the account id on the account leg: the
      // historical shape O-5 closed for new writes but did not erase.
      const a = await newAssertion(ORG_A, rec, {
        entityType: 'person', personId: person, accountId: account,
        attribute: 'industry', value: 'Software',
      });
      const err = await refusal(ORG_A, 'account', account, [
        decision(a, { attribute: 'industry', value: 'Software' }),
      ]);
      expect(err).toContain('does not attest attribute industry');
    });
  });

  it('15. a missing canonical row fails CLOSED rather than silently skipping', async () => {
    await inRollback(async () => {
      await seedTenants();
      const rec = await newSourceRecord(ORG_A);
      const ghost = '00000000-0000-4000-8000-0000000000ff';
      const a = await newAssertion(ORG_A, rec, { personId: null });
      const err = await refusal(ORG_A, 'person', ghost, [decision(a)]);
      expect(err).toContain('no unified_persons row');
    });
  });
});

describe('CA — evidence semantics are preserved exactly', () => {
  it('16. a value the assertion does not carry is refused', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const rec = await newSourceRecord(ORG_A);
      const a = await newAssertion(ORG_A, rec, { personId: person, value: 'VP Sales' });

      // The function verifies the decision against its evidence. It does not
      // re-run arbitration — it has no ordering or comparison in it — but it
      // will not write a value no assertion attests.
      const err = await refusal(ORG_A, 'person', person, [
        decision(a, { value: 'Chief Revenue Officer' }),
      ]);
      expect(err).toContain('does not attest attribute job_title');
      expect(await titleOf(person)).toBeNull();
    });
  });

  it('17. the refusal message does NOT leak the attribute value', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const rec = await newSourceRecord(ORG_A);
      const a = await newAssertion(ORG_A, rec, { personId: person });
      // A canonical attribute value can be a person's name, title or city, and
      // a refusal travels into application logs.
      const err = await refusal(ORG_A, 'person', person, [
        decision(a, { value: 'Fredrik Oestergaard-Lindqvist' }),
      ]);
      expect(err).not.toContain('Fredrik');
    });
  });

  it('18. a SUPERSEDED assertion still attests, so its liveness is not re-decided here', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const rec = await newSourceRecord(ORG_A);
      const a = await newAssertion(ORG_A, rec, {
        personId: person, supersededAt: '2026-02-01T00:00:00.000Z',
      });

      // Arbitration upstream decides that a superseded assertion cannot WIN.
      // This function must not make that judgement a second time: filtering on
      // `superseded_at` here would silently change the ratified attestation
      // semantics, and the function's job is to write the decision it is given.
      expect(await apply(ORG_A, 'person', person, [decision(a)])).toBe(1);
      expect(await titleOf(person)).toBe('VP Sales');
    });
  });

  it('19. an ALREADY-stamped assertion keeps its original stamp', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      const rec = await newSourceRecord(ORG_A);
      const first = '2026-01-01T00:00:00.000Z';
      const a = await newAssertion(ORG_A, rec, {
        personId: person, appliedAt: first, appliedReason: 'authoritative_source',
      });

      expect(await apply(ORG_A, 'person', person, [decision(a)])).toBe(1);

      // Never cleared, never overwritten: the decision LOG carries the re-win.
      const { rows } = await db.query(
        `SELECT applied_to_canonical_at, applied_reason
           FROM public.source_assertions WHERE id=$1`, [a],
      );
      expect(new Date(rows[0].applied_to_canonical_at).toISOString()).toBe(first);
      expect(rows[0].applied_reason).toBe('authoritative_source');
      // and the decision row still records that it won again.
      expect(await decisionCount(ORG_A)).toBe(1);
    });
  });

  it('20. an empty decision list writes nothing and does not touch the row', async () => {
    await inRollback(async () => {
      await seedTenants();
      const person = await newPerson(ORG_A);
      // `unified_persons_attributes_provenance_coherent` ties the two columns
      // together ((attributes_source IS NULL) = (attributes_updated_at IS
      // NULL)), so the fixture must set both or neither.
      await db.query(
        `UPDATE public.unified_persons
            SET attributes_source='earlier', attributes_updated_at=$2 WHERE id=$1`,
        [person, '2026-01-01T00:00:00.000Z'],
      );
      expect(await apply(ORG_A, 'person', person, [])).toBe(0);
      // Notably it must NOT stamp attributes_source, because no decision was
      // applied and the provider did not win anything.
      const { rows } = await db.query(
        'SELECT attributes_source FROM public.unified_persons WHERE id=$1', [person],
      );
      expect(rows[0].attributes_source).toBe('earlier');
      expect(await decisionCount(ORG_A)).toBe(0);
    });
  });

  it('21. an account write lands on the account, with the account leg set', async () => {
    await inRollback(async () => {
      await seedTenants();
      const account = await newAccount(ORG_A);
      const rec = await newSourceRecord(ORG_A, 'CA-REC-ACC');
      const a = await newAssertion(ORG_A, rec, {
        entityType: 'account', accountId: account,
        attribute: 'industry', value: 'Software',
      });

      expect(await apply(ORG_A, 'account', account, [
        decision(a, { attribute: 'industry', value: 'Software' }),
      ])).toBe(1);

      const { rows } = await db.query(
        'SELECT industry FROM public.prospect_accounts WHERE id=$1', [account],
      );
      expect(rows[0].industry).toBe('Software');
      const { rows: d } = await db.query(
        `SELECT entity_type, person_id, account_id FROM public.canonical_attribute_decisions
          WHERE organization_id=$1`, [ORG_A],
      );
      expect(d[0]).toMatchObject({ entity_type: 'account', person_id: null, account_id: account });
    });
  });
});

/**
 * X-1 — SEC-B (20270110000004) and privacy/erasure 20270112000002 on the same
 * database, against real PostgreSQL.
 *
 * 20270112000002 recreates public.prospect_score_evaluations_immutable() as
 * SECURITY DEFINER with search_path = '' (state S2). SEC-B was reviewed against
 * the 20261031000000 original: INVOKER, search_path = public, pg_temp (state
 * S1). SEC-B accepts EXACTLY those two states and refuses every other one,
 * null-safely, in both its $preflight$ and its $verify$ block.
 *
 * Expects the merged replay: SEC-B applied, then the erasure migrations (S2).
 * Every test runs inside a rolled-back transaction; nothing persists. A green
 * run concerns a disposable database, not production.
 */
import * as fs from 'fs';
import * as path from 'path';
import { db, inRollback, seedTenants, attempt, ORG_A, ORG_B, newPerson, newLead } from './setup';

const MIG = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const ROLLBACKS = path.join(MIG, 'rollbacks');
const SEC_B_FILE = process.env.SEC_B_MIGRATION_FILE
  || path.join(MIG, '20270110000004_function_execute_classwide_hardening.sql');
const read = (f: string) => fs.readFileSync(f, 'utf8');
const stripTxn = (sql: string) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gim, '');

const SEC_B = stripTxn(read(SEC_B_FILE));
const SEC_B_ROLLBACK = stripTxn(read(path.join(ROLLBACKS, 'function_execute_classwide_hardening_rollback.sql')));
const ERASURE_02 = stripTxn(read(path.join(MIG, '20270112000002_prospect_score_evaluations_erasure_redaction.sql')));
const PSE = 'public.prospect_score_evaluations_immutable()';

/** The `CREATE OR REPLACE FUNCTION public.prospect_score_evaluations_immutable() ... $$;` block of a file. */
function pseDefinition(file: string): string {
  const m = /CREATE OR REPLACE FUNCTION public\.prospect_score_evaluations_immutable\(\)[\s\S]*?\n\$\$;/.exec(read(path.join(MIG, file)));
  if (!m) throw new Error(`no prospect_score_evaluations_immutable() definition in ${file}`);
  return m[0];
}
const S1_DEF = pseDefinition('20261031000000_pi_score_evaluations.sql');
const S2_DEF = pseDefinition('20270112000002_prospect_score_evaluations_erasure_redaction.sql');

/** SEC-B's standalone re-verifier: its `DO $verify$ ... $verify$;` block. */
const SEC_B_VERIFY = (() => {
  const m = /DO \$verify\$[\s\S]*?\n\$verify\$;/.exec(SEC_B);
  if (!m) throw new Error('SEC-B has no $verify$ block');
  return m[0];
})();

const q = (sql: string, params: unknown[] = []) => db.query(sql, params);
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params)).rows[0];

/** Run sql under a savepoint; 'ok' or `${sqlstate}|${message}`. The txn stays usable. */
async function outcome(sql: string, params: unknown[] = []): Promise<string> {
  await q('SAVEPOINT x1');
  try {
    await q(sql, params);
    await q('RELEASE SAVEPOINT x1');
    return 'ok';
  } catch (e: any) {
    await q('ROLLBACK TO SAVEPOINT x1');
    return `${e.code}|${e.message}`;
  }
}

async function state(): Promise<{ secdef: boolean; cfg: string[] | null; ownerIsTableOwner: boolean; held: boolean }> {
  return one(
    `SELECT p.prosecdef AS secdef, p.proconfig AS cfg,
            p.proowner = (SELECT relowner FROM pg_class WHERE oid = 'public.prospect_score_evaluations'::regclass) AS "ownerIsTableOwner",
            position('pi_erasure_authorization_held' IN p.prosrc) > 0 AS held
       FROM pg_proc p WHERE p.oid = $1::regprocedure`, [PSE]);
}

async function clientExec(): Promise<{ anon: boolean; authenticated: boolean; pub: boolean }> {
  return one(
    `SELECT has_function_privilege('anon', $1::regprocedure, 'EXECUTE') AS anon,
            has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') AS authenticated,
            EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                     WHERE p.oid = $1::regprocedure AND x.grantee = 0) AS pub`, [PSE]);
}

async function scoreEval(org: string, prospect: string, person: string, digest: string): Promise<string> {
  return (await one(
    `INSERT INTO public.prospect_score_evaluations
       (organization_id, prospect_id, person_id, rules_version, scored_at, score_overall, confidence,
        contributions, evidence, reasoning, facets, context_gaps, input_digest)
     VALUES ($1,$2,$3,'rules-v1',now(),0.5,0.7,
        '[{"dimension":"icp","note":"CTO at Example Corp"}]','[{"kind":"title","value":"CTO"}]',
        '[{"because":["CTO at Example Corp"]}]','{"seniority":"cxo"}','["no_intent"]',$4)
     RETURNING id`, [org, prospect, person, digest])).id;
}

async function asRole(role: string, sql: string, params: unknown[] = []): Promise<string> {
  await q('SAVEPOINT r');
  try {
    await q(`SET LOCAL ROLE ${role}`);
    await q(sql, params);
    await q('RESET ROLE');
    await q('ROLLBACK TO SAVEPOINT r');
    return 'ok';
  } catch (e: any) {
    await q('ROLLBACK TO SAVEPOINT r');
    return e.code ?? 'unknown';
  }
}

const NEITHER = /is in neither reviewed state/;

// ─────────────────────────────────────────────────────────────────────────────

describe('X-1 contract shape', () => {
  it('the replay is in S2: SECURITY DEFINER, search_path="", table owner, erasure-authorization body', async () => {
    expect(await state()).toEqual({ secdef: true, cfg: ['search_path=""'], ownerIsTableOwner: true, held: true });
  });

  it('the two-state predicate is byte-identical in $preflight$ and $verify$, and null-safe', () => {
    const preds = [...SEC_B.matchAll(/-- X-1 state predicate[^\n]*\n(\s*IF NOT COALESCE\(\(SELECT[\s\S]*?\), false\) THEN)/g)].map((m) => m[1]);
    expect(preds).toHaveLength(2);
    expect(preds[0]).toBe(preds[1]);
    expect(preds[0]).toContain('COALESCE(');
  });

  it('the NULL sentinel exists for exactly one signature', () => {
    const rows = SEC_B.split('\n').filter((l) => /^\s*\('public\.[^']+', '[TBA]', NULL::boolean/.test(l));
    expect(rows).toHaveLength(2); // $preflight$ + $verify$
    for (const r of rows) expect(r).toContain(`'${PSE}'`);
  });
});

describe('SEC-B is re-runnable in both reviewed states', () => {
  it('S2 (after erasure 02): SEC-B applies and its re-verifier passes; the function is unchanged', async () => {
    await inRollback(async () => {
      const before = await state();
      expect(await outcome(SEC_B)).toBe('ok');
      expect(await outcome(SEC_B_VERIFY)).toBe('ok');
      expect(await state()).toEqual(before);
      expect(await clientExec()).toEqual({ anon: false, authenticated: false, pub: false });
    });
  });

  it('S1 -> SEC-B -> erasure 02 -> SEC-B again: every step passes, ending in S2 with no client EXECUTE', async () => {
    await inRollback(async () => {
      await q(S1_DEF);
      // production's pre-SEC-B ACL for this function: authenticated only
      await q(`REVOKE ALL ON FUNCTION ${PSE} FROM PUBLIC, anon, authenticated`);
      await q(`GRANT EXECUTE ON FUNCTION ${PSE} TO authenticated`);
      expect((await state()).secdef).toBe(false);
      expect(await outcome(SEC_B)).toBe('ok');
      expect(await clientExec()).toEqual({ anon: false, authenticated: false, pub: false });
      expect(await outcome(ERASURE_02)).toBe('ok');
      expect(await state()).toEqual({ secdef: true, cfg: ['search_path=""'], ownerIsTableOwner: true, held: true });
      expect(await outcome(SEC_B)).toBe('ok');
      expect(await outcome(SEC_B_VERIFY)).toBe('ok');
    });
  });

  it('erasure 02 re-applied on top of S2 + SEC-B keeps the state SEC-B accepts', async () => {
    await inRollback(async () => {
      expect(await outcome(ERASURE_02)).toBe('ok');
      expect(await outcome(SEC_B)).toBe('ok');
    });
  });
});

describe('every third state fails closed, in the migration AND in the standalone re-verifier', () => {
  const mutants: Array<[string, string[]]> = [
    ['S2 with search_path RESET (unpinned definer: the J3-8 NULL hole)', [S2_DEF, `ALTER FUNCTION ${PSE} RESET search_path`]],
    ['S1 with search_path RESET (NULL proconfig)', [S1_DEF, `ALTER FUNCTION ${PSE} RESET search_path`]],
    ['definer pinned to the S1 path', [S2_DEF, `ALTER FUNCTION ${PSE} SET search_path = public, pg_temp`]],
    ['invoker pinned to the S2 path', [S1_DEF, `ALTER FUNCTION ${PSE} SET search_path = ''`]],
    ['S1 flipped to SECURITY DEFINER', [S1_DEF, `ALTER FUNCTION ${PSE} SECURITY DEFINER`]],
    ['S2 flipped to SECURITY INVOKER (bypass body under the caller)', [S2_DEF, `ALTER FUNCTION ${PSE} SECURITY INVOKER`]],
    ['S2 flags with a body that no longer consults the authorization', [
      `CREATE OR REPLACE FUNCTION ${PSE} RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN RETURN NEW; END $$`]],
    ['S2 flags with a body that consults another scope', [
      S2_DEF.replace(`'score_evaluations'`, `'outreach_decisions'`)]],
    ['S2 owned by a role that does not own the table', [
      S2_DEF, 'CREATE ROLE x1_other_owner NOLOGIN', `ALTER FUNCTION ${PSE} OWNER TO x1_other_owner`]],
  ];
  for (const [name, setup] of mutants) {
    it(name, async () => {
      await inRollback(async () => {
        for (const s of setup) await q(s);
        const viaMigration = await outcome(SEC_B);
        expect(viaMigration).toMatch(/^P0001\|SEC-B preflight: public\.prospect_score_evaluations_immutable\(\) is in neither reviewed state/);
        const viaVerifier = await outcome(SEC_B_VERIFY);
        expect(viaVerifier).toMatch(/^P0001\|SEC-B postcondition: public\.prospect_score_evaluations_immutable\(\) is in neither reviewed state/);
      });
    });
  }

  it('a client grant on the function fails the standalone re-verifier (and SEC-B itself revokes it again)', async () => {
    await inRollback(async () => {
      for (const grantee of ['anon', 'authenticated', 'PUBLIC']) {
        await q('SAVEPOINT g');
        await q(`GRANT EXECUTE ON FUNCTION ${PSE} TO ${grantee}`);
        expect(await outcome(SEC_B_VERIFY)).toMatch(/^P0001\|SEC-B postcondition: (a client role still has EXECUTE|PUBLIC still holds a privilege) on public\.prospect_score_evaluations_immutable\(\)/);
        expect(await outcome(SEC_B)).toBe('ok');
        expect(await clientExec()).toEqual({ anon: false, authenticated: false, pub: false });
        await q('ROLLBACK TO SAVEPOINT g');
      }
    });
  });

  it('the NULL sentinel on any other signature is refused (no silent widening of the manifest)', async () => {
    await inRollback(async () => {
      const mutant = SEC_B.replace(
        /\('public\.raise_audit_immutable\(\)', 'T', false, true, '\{"search_path=pg_catalog, public"\}'::text\[\], 1\)/,
        `('public.raise_audit_immutable()', 'T', NULL::boolean, false, NULL::text[], 1)`);
      expect(mutant).not.toBe(SEC_B);
      expect(await outcome(mutant)).toMatch(/SEC-B preflight: public\.raise_audit_immutable\(\) has a NULL reviewed state/);
    });
  });
});

describe('behaviour in S2 after SEC-B', () => {
  it('anon and authenticated cannot EXECUTE the function (42501, before the trigger-only check)', async () => {
    await inRollback(async () => {
      expect(await outcome(SEC_B)).toBe('ok');
      for (const role of ['anon', 'authenticated']) {
        expect(await asRole(role, `SELECT ${PSE.replace('()', '')}()`)).toBe('42501');
      }
    });
  });

  it('non-erased rows stay immutable: superuser and service_role UPDATEs are refused 23514', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const e = await scoreEval(ORG_A, await newLead(ORG_A, { personId: p }), p, 'x1-immutable');
      expect(await attempt('UPDATE public.prospect_score_evaluations SET score_overall = 0.9 WHERE id = $1', [e])).toBe('23514');
      await q('GRANT ALL ON public.prospect_score_evaluations TO service_role');
      expect(await asRole('service_role', 'UPDATE public.prospect_score_evaluations SET score_overall = 0.9 WHERE id = $1', [e])).toBe('23514');
      expect(await asRole('service_role', 'UPDATE public.prospect_score_evaluations SET person_id = NULL WHERE id = $1', [e])).toBe('23514');
      expect(await asRole('service_role', 'SELECT public.pi_erasure_redact_score_evaluations($1, $2)', [ORG_A, p])).toBe('42501');
    });
  });

  it('the authorized erasure path redacts exactly the tenant\'s person; the other tenant\'s rows are untouched', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pa = await newPerson(ORG_A);
      const pb = await newPerson(ORG_B);
      const ea = await scoreEval(ORG_A, await newLead(ORG_A, { personId: pa }), pa, 'x1-a');
      const eb = await scoreEval(ORG_B, await newLead(ORG_B, { personId: pb }), pb, 'x1-b');
      const snapB = (await one('SELECT to_jsonb(e) j FROM public.prospect_score_evaluations e WHERE id = $1', [eb])).j;
      // Tenant isolation: tenant B cannot redact tenant A's person.
      expect(await attempt('SELECT public.pi_erasure_redact_score_evaluations($1, $2)', [ORG_B, pa])).toBe('42501');
      // The sanctioned owner path.
      expect((await one('SELECT public.pi_erasure_redact_score_evaluations($1, $2) n', [ORG_A, pa])).n).toBe(1);
      const a = await one('SELECT person_id, contributions, facets, score_overall FROM public.prospect_score_evaluations WHERE id = $1', [ea]);
      expect(a.person_id).toBeNull();
      expect(a.contributions).toEqual([]);
      expect(a.facets).toEqual({ redacted: true, reason: 'person_erased' });
      expect(Number(a.score_overall)).toBe(0.5);
      expect((await one('SELECT to_jsonb(e) j FROM public.prospect_score_evaluations e WHERE id = $1', [eb])).j).toEqual(snapB);
      expect(Number((await one('SELECT count(*) n FROM public.pi_erasure_authorizations')).n)).toBe(0);
      // A redacted row is immutable again.
      expect(await attempt('UPDATE public.prospect_score_evaluations SET score_overall = 0.1 WHERE id = $1', [ea])).toBe('23514');
    });
  });
});

describe('SEC-B rollback in both states', () => {
  /** Production's pre-SEC-B ACL/search_path for every function the rollback verifies (as sec_b_function_classwide does). */
  async function prodState(): Promise<void> {
    const rows = [...SEC_B_ROLLBACK.matchAll(/^\s*\('(public\.[^']+)', (true|false), (true|false), (true|false), (true|false)\)/gm)];
    expect(rows).toHaveLength(132);
    const emu: string[] = [];
    for (const [, sig, anon, auth, pub, pinned] of rows) {
      emu.push(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon, authenticated`);
      const g = [pub === 'true' && 'PUBLIC', anon === 'true' && 'anon', auth === 'true' && 'authenticated', 'service_role'].filter(Boolean);
      emu.push(`GRANT EXECUTE ON FUNCTION ${sig} TO ${g.join(', ')}`);
      if (pinned === 'true') emu.push(`ALTER FUNCTION ${sig} RESET search_path`);
    }
    await q(emu.join(';\n'));
  }

  it('S2: forward then rollback; the rollback never grants a client EXECUTE on the definer; forward re-applies', async () => {
    await inRollback(async () => {
      await prodState();
      await q(`REVOKE ALL ON FUNCTION ${PSE} FROM PUBLIC, anon, authenticated`); // erasure 02 already narrowed it
      expect(await outcome(SEC_B)).toBe('ok');
      expect(await outcome(SEC_B_ROLLBACK)).toBe('ok');
      expect(await clientExec()).toEqual({ anon: false, authenticated: false, pub: false });
      expect((await state()).secdef).toBe(true);
      expect(await outcome(SEC_B)).toBe('ok');
    });
  });

  it('S1: forward then rollback restores the production grant to authenticated (the exact pre-SEC-B ACL)', async () => {
    await inRollback(async () => {
      await prodState();
      await q(S1_DEF);
      expect(await outcome(SEC_B)).toBe('ok');
      expect(await outcome(SEC_B_ROLLBACK)).toBe('ok');
      expect(await clientExec()).toEqual({ anon: false, authenticated: true, pub: false });
    });
  });
});

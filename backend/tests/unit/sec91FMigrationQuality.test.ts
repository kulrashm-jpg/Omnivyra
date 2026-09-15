/**
 * STEP 3AH-91 (SEC-F, F2) — migration-quality gate: the security rules can no
 * longer be skipped or sidestepped.
 *
 *   (a) ordering: a new file named with an EARLIER timestamp used to skip the
 *       version-keyed security rules entirely; it now fails ordering, and the
 *       rules apply to it regardless of name;
 *   (b) SECURITY DEFINER must revoke PUBLIC, anon AND authenticated (Supabase
 *       default privileges still grant authenticated EXECUTE on new functions);
 *       grants back to client roles need `-- grant-ok:`;
 *   (c) views need security_invoker (or revoked client roles); materialized
 *       views need revoked client roles;
 *   (d) GRANT … TO anon/authenticated, ALTER DEFAULT PRIVILEGES … GRANT,
 *       DISABLE / NO FORCE ROW LEVEL SECURITY, ALTER FUNCTION … SECURITY
 *       DEFINER, ALTER POLICY widening — all caught;
 *   (e) CREATE POLICY … TO authenticated USING (true) is cross-tenant → caught;
 *   (f) CREATE TABLE inside DO $$…$$ / EXECUTE is no longer invisible.
 * An idempotent `ALTER FUNCTION … SET search_path` (SEC-C hardening) passes.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { securityViolations, orderingViolations } = require('../../../scripts/check-migration-quality.js');

const REPO = path.resolve(__dirname, '../../..');
const rules = (sql: string): string[] => securityViolations(sql).map((v: { rule: string }) => v.rule);

describe('(a) ordering — an earlier timestamp cannot skip the security rules', () => {
  const frozen = new Set(['20261025000000_a.sql', '20261026000000_close_anon_rls_exposure.sql']);

  it('a new migration named BEFORE the latest existing one is rejected', () => {
    const { violations, floor } = orderingViolations(['20261025000000_a.sql', '20261026000000_close_anon_rls_exposure.sql', '20261020000000_sneaky.sql'], frozen);
    expect(floor).toBe('20261026000000');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('20261020000000_sneaky.sql');
    expect(violations[0]).toContain('out-of-order');
  });

  it('a new migration after the floor is accepted; snapshotted files are never re-judged', () => {
    expect(orderingViolations(['20261025000000_a.sql', '20261027000000_next.sql'], frozen).violations).toEqual([]);
  });

  it('the ordering snapshot is frozen at main@f44b1387 (415 files, floor 20261026000000)', () => {
    const lines = fs.readFileSync(path.join(REPO, 'scripts/migrations/ordering-baseline.txt'), 'utf8')
      .split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
    expect(lines).toHaveLength(415);
    expect(lines.map((l) => l.slice(0, 14)).sort().pop()).toBe('20261026000000');
  });

  it('end-to-end: the CLI fails on an out-of-order migration and on insecure DDL in it', () => {
    // Copy the gate into a throwaway tree so the real supabase/migrations is untouched.
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mq91-'));
    try {
      fs.mkdirSync(path.join(tmp, 'supabase', 'migrations'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'scripts', 'migrations'), { recursive: true });
      const snapshot = fs.readFileSync(path.join(REPO, 'scripts/migrations/ordering-baseline.txt'), 'utf8');
      fs.writeFileSync(path.join(tmp, 'scripts/migrations/ordering-baseline.txt'), snapshot);
      fs.writeFileSync(path.join(tmp, 'scripts/migrations/historical-baseline.txt'), '');
      for (const f of snapshot.split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))) {
        fs.writeFileSync(path.join(tmp, 'supabase/migrations', f), '-- frozen\n');
      }
      fs.writeFileSync(path.join(tmp, 'supabase/migrations', '20261001000001_sneaky.sql'),
        'CREATE TABLE IF NOT EXISTS public.sneaky (id uuid);\n');
      let out = '';
      try {
        execFileSync('node', [path.join(REPO, 'scripts/check-migration-quality.js')], { cwd: tmp, encoding: 'utf8', stdio: 'pipe' });
      } catch (e) {
        out = String((e as { stderr?: string }).stderr || '') + String((e as { stdout?: string }).stdout || '');
      }
      expect(out).toContain('out-of-order version 20261001000001');
      expect(out).toContain('table public.sneaky must ENABLE ROW LEVEL SECURITY');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('(b) SECURITY DEFINER — PUBLIC, anon and authenticated must all be revoked', () => {
  const fn = (extra = '') => `CREATE OR REPLACE FUNCTION public.mint(p uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN PERFORM 1; END $$;${extra}`;

  it('REVOKE … FROM PUBLIC alone is not enough (authenticated keeps EXECUTE via default privileges)', () => {
    const r = rules(fn('\nREVOKE EXECUTE ON FUNCTION public.mint(uuid) FROM PUBLIC;'));
    expect(r).toHaveLength(1);
    expect(r[0]).toContain('missing: anon, authenticated');
  });

  it('REVOKE FROM PUBLIC, anon, authenticated + GRANT to service_role passes', () => {
    expect(rules(fn('\nREVOKE EXECUTE ON FUNCTION public.mint(uuid) FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION public.mint(uuid) TO service_role;'))).toEqual([]);
  });

  it('granting EXECUTE back to authenticated needs a reviewed annotation', () => {
    const base = '\nREVOKE EXECUTE ON FUNCTION public.mint(uuid) FROM PUBLIC, anon, authenticated;\n';
    expect(rules(fn(`${base}GRANT EXECUTE ON FUNCTION public.mint(uuid) TO authenticated;`))).toEqual([expect.stringContaining('GRANT … TO authenticated')]);
    expect(rules(fn(`${base}-- grant-ok: caller-scoped RPC, checks auth.uid() membership first\nGRANT EXECUTE ON FUNCTION public.mint(uuid) TO authenticated;`))).toEqual([]);
  });

  it('ALTER FUNCTION … SECURITY DEFINER is treated like CREATE … SECURITY DEFINER', () => {
    // search_path pinned in the same ALTER so this test isolates the REVOKE rule (b2 has its own block).
    expect(rules('ALTER FUNCTION public.mint(uuid) SECURITY DEFINER SET search_path = public, pg_temp;')).toEqual([expect.stringContaining('SECURITY DEFINER function public.mint must REVOKE')]);
    expect(rules('ALTER FUNCTION public.mint(uuid) SECURITY DEFINER SET search_path = public, pg_temp;\nREVOKE ALL ON FUNCTION public.mint(uuid) FROM PUBLIC, anon, authenticated;')).toEqual([]);
  });

  it('an idempotent ALTER FUNCTION … SET search_path (SEC-C hardening) passes', () => {
    expect(rules(`ALTER FUNCTION public.mint(uuid) SET search_path = public, pg_temp;
      DO $$ BEGIN EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', 'public.other(uuid)'); END $$;`)).toEqual([]);
  });
});

describe('(b2) SECURITY DEFINER must pin its search_path (STEP 3AH-91, SEC91-INT-C7G)', () => {
  const REVOKE = '\nREVOKE EXECUTE ON FUNCTION public.mint(uuid) FROM PUBLIC, anon, authenticated;';
  const create = (clauses: string, extra = REVOKE) => `CREATE OR REPLACE FUNCTION public.mint(p uuid) RETURNS void
    LANGUAGE plpgsql ${clauses} AS $$ BEGIN PERFORM 1; END $$;${extra}`;
  const pinRule = (r: string[]) => r.filter((x) => x.includes('must pin its search_path'));

  it('CRITICAL: a revoked SECURITY DEFINER function with no search_path is flagged (the C7 class re-opened)', () => {
    expect(rules(create('SECURITY DEFINER'))).toEqual([expect.stringContaining('public.mint must pin its search_path')]);
  });

  it('SET search_path in the definition passes', () => {
    expect(rules(create('SECURITY DEFINER SET search_path = public, extensions, pg_temp'))).toEqual([]);
    expect(rules(create("SET search_path TO 'public' SECURITY DEFINER"))).toEqual([]);
  });

  it('ALTER FUNCTION … SET search_path in the same migration passes', () => {
    expect(rules(create('SECURITY DEFINER', `${REVOKE}\nALTER FUNCTION public.mint(uuid) SET search_path = public, pg_temp;`))).toEqual([]);
  });

  it('a search_path mentioned only INSIDE the body does not count', () => {
    const sql = `CREATE FUNCTION public.mint(p uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN PERFORM set_config('search_path', 'public', true); END $$;${REVOKE}`;
    expect(pinRule(rules(sql))).toHaveLength(1);
  });

  it('a pin for a DIFFERENT function does not cover this one', () => {
    expect(pinRule(rules(create('SECURITY DEFINER', `${REVOKE}\nALTER FUNCTION public.mint_other(uuid) SET search_path = public;`)))).toHaveLength(1);
  });

  it('ALTER … SECURITY DEFINER without a pin is flagged; a reviewed annotation is accepted', () => {
    expect(pinRule(rules(`ALTER FUNCTION public.mint(uuid) SECURITY DEFINER;${REVOKE}`))).toHaveLength(1);
    expect(rules(`-- search-path-ok: body uses only schema-qualified names and pg_catalog\nALTER FUNCTION public.mint(uuid) SECURITY DEFINER;${REVOKE}`)).toEqual([]);
  });

  it('SECURITY INVOKER functions are not subject to the rule', () => {
    expect(rules('CREATE FUNCTION public.plain(p uuid) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;')).toEqual([]);
  });
});

describe('(c) views and materialized views', () => {
  it('a public view without security_invoker is flagged', () => {
    expect(rules('CREATE OR REPLACE VIEW public.v_totals AS SELECT company_id, sum(x) FROM public.t GROUP BY 1;'))
      .toEqual([expect.stringContaining('view public.v_totals runs with its owner')]);
  });

  it('WITH (security_invoker = true) or ALTER VIEW … SET (security_invoker) passes', () => {
    expect(rules('CREATE VIEW public.v WITH (security_invoker = true) AS SELECT 1;')).toEqual([]);
    expect(rules('CREATE VIEW public.v WITH (security_invoker) AS SELECT 1;')).toEqual([]);
    expect(rules('CREATE VIEW public.v AS SELECT 1;\nALTER VIEW public.v SET (security_invoker = on);')).toEqual([]);
  });

  it('a definer view closed to client roles passes', () => {
    expect(rules('CREATE VIEW public.v AS SELECT 1;\nREVOKE ALL ON public.v FROM anon, authenticated;')).toEqual([]);
  });

  it('security_invoker = false is not invoker', () => {
    expect(rules('CREATE VIEW public.v WITH (security_invoker = false) AS SELECT 1;')).toHaveLength(1);
  });

  it('materialized views must revoke client roles', () => {
    expect(rules('CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv AS SELECT 1;')).toEqual([expect.stringContaining('materialized view public.mv')]);
    expect(rules('CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv AS SELECT 1;\nREVOKE ALL ON public.mv FROM anon, authenticated;')).toEqual([]);
  });

  it('turning security_invoker off later is flagged', () => {
    expect(rules('ALTER VIEW public.v SET (security_invoker = false);')).toHaveLength(1);
    expect(rules('ALTER VIEW public.v RESET (security_invoker);')).toHaveLength(1);
  });

  it('views in other schemas and temp views are ignored', () => {
    expect(rules('CREATE VIEW audit.v AS SELECT 1;\nCREATE TEMP VIEW t AS SELECT 1;')).toEqual([]);
  });
});

describe('(d) privilege-widening statements need a reviewed annotation', () => {
  it('GRANT … TO anon / authenticated / PUBLIC', () => {
    expect(rules('GRANT SELECT ON public.t TO anon;')).toHaveLength(1);
    expect(rules('GRANT ALL ON TABLE public.t TO authenticated;')).toHaveLength(1);
    expect(rules('GRANT USAGE ON SCHEMA reporting TO PUBLIC;')).toHaveLength(1);
    expect(rules('-- grant-ok: public price list, no tenant data\nGRANT SELECT ON public.price_list TO anon;')).toEqual([]);
  });

  it('grants to service_role and revokes are never flagged', () => {
    expect(rules('GRANT ALL ON public.t TO service_role;\nREVOKE ALL ON public.t FROM anon, authenticated;')).toEqual([]);
  });

  it('ALTER DEFAULT PRIVILEGES … GRANT to a client role', () => {
    expect(rules('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;')).toEqual([expect.stringContaining('ALTER DEFAULT PRIVILEGES … GRANT')]);
    expect(rules('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;')).toEqual([]);
  });

  it('a GRANT hidden in a DO block EXECUTE string, or to a dynamic grantee', () => {
    expect(rules("DO $$ BEGIN EXECUTE 'GRANT SELECT ON public.t TO authenticated'; END $$;")).toHaveLength(1);
    expect(rules("DO $$ BEGIN EXECUTE format('GRANT SELECT ON public.%I TO %I', 't', 'anon'); END $$;")).toHaveLength(1);
    expect(rules("DO $$ BEGIN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f); END $$;")).toEqual([]);
  });

  it('ALTER TABLE … DISABLE / NO FORCE ROW LEVEL SECURITY', () => {
    expect(rules('ALTER TABLE public.t DISABLE ROW LEVEL SECURITY;')).toEqual([expect.stringContaining('DISABLE ROW LEVEL SECURITY')]);
    expect(rules('ALTER TABLE public.t NO FORCE ROW LEVEL SECURITY;')).toEqual([expect.stringContaining('NO FORCE ROW LEVEL SECURITY')]);
    expect(rules('-- rls-disable-ok: staging copy table, service-role only, revoked below\nALTER TABLE public.t DISABLE ROW LEVEL SECURITY;')).toEqual([]);
    expect(rules('ALTER TABLE public.t ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.t FORCE ROW LEVEL SECURITY;')).toEqual([]);
  });

  it('ALTER POLICY widening to anon/public or to (true)', () => {
    expect(rules('ALTER POLICY p ON public.t TO anon;')).toHaveLength(1);
    expect(rules('ALTER POLICY p ON public.t USING (true);')).toHaveLength(1);
    expect(rules('ALTER POLICY p ON public.t TO authenticated USING (company_id = auth.uid());')).toEqual([]);
    expect(rules('ALTER POLICY p ON public.t TO service_role;')).toEqual([]);
    expect(rules('ALTER POLICY p ON public.t RENAME TO q;')).toEqual([]);
  });
});

describe('(e) unconditional policies for authenticated are cross-tenant', () => {
  it('CREATE POLICY … TO authenticated USING (true) is flagged', () => {
    expect(rules('CREATE POLICY p ON public.t FOR SELECT TO authenticated USING (true);')).toEqual([expect.stringContaining('unconditional access')]);
  });
  it('… unless annotated, or scoped to service_role / a condition', () => {
    expect(rules('-- rls-public-ok: shared format vocabulary, no tenant data\nCREATE POLICY p ON public.t FOR SELECT TO authenticated USING (true);')).toEqual([]);
    expect(rules('CREATE POLICY p ON public.t FOR ALL TO service_role USING (true) WITH CHECK (true);')).toEqual([]);
  });
});

describe('(f) tables created inside DO blocks / EXECUTE are not invisible', () => {
  it('a literal CREATE TABLE inside DO $$…$$ without RLS is flagged', () => {
    expect(rules('DO $$ BEGIN CREATE TABLE IF NOT EXISTS public.hidden (id uuid); END $$;')).toEqual([expect.stringContaining('table public.hidden must ENABLE ROW LEVEL SECURITY')]);
  });
  it('a CREATE TABLE in an EXECUTE string is flagged', () => {
    expect(rules("DO $$ BEGIN EXECUTE 'CREATE TABLE IF NOT EXISTS public.hidden2 (id uuid)'; END $$;")).toHaveLength(1);
  });
  it('a dynamically named table needs ENABLE ROW LEVEL SECURITY in the same block', () => {
    expect(rules("DO $$ BEGIN EXECUTE format('CREATE TABLE IF NOT EXISTS public.%I (id uuid)', 'x'); END $$;")).toEqual([expect.stringContaining('dynamically-named')]);
    expect(rules("DO $$ BEGIN EXECUTE format('CREATE TABLE IF NOT EXISTS public.%I (id uuid)', 'x'); EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', 'x'); END $$;")).toEqual([]);
  });
  it('RLS enabled for the same table in the DO block passes; temp tables are ignored', () => {
    expect(rules('DO $$ BEGIN CREATE TABLE IF NOT EXISTS public.h (id uuid); ALTER TABLE public.h ENABLE ROW LEVEL SECURITY; END $$;')).toEqual([]);
    expect(rules('CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN CREATE TEMP TABLE scratch (id int); END $$;')).toEqual([]);
  });
});

describe('the repository itself', () => {
  it('check-migration-quality passes on the current migrations (history frozen)', () => {
    const out = execFileSync('node', [path.join(REPO, 'scripts/check-migration-quality.js')], { cwd: REPO, encoding: 'utf8' });
    expect(out).toContain('"violations":0');
    expect(out).toContain('ordering floor 20261026000000');
  });

  it('the anonymous-exposure fix itself satisfies every strengthened rule', () => {
    const sql = fs.readFileSync(path.join(REPO, 'supabase/migrations/20261026000000_close_anon_rls_exposure.sql'), 'utf8');
    expect(securityViolations(sql)).toEqual([]);
  });
});

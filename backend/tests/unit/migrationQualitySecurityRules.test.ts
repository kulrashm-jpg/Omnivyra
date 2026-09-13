/**
 * STEP 3AH-70 — the migration-quality gate's anonymous-exposure rules.
 *
 * Supabase grants ALL on every new public table, and EXECUTE on every new
 * function, to anon/authenticated. 177 tables, 29 SECURITY DEFINER functions and
 * 11 unconditional {public} policies reached production that way. These rules
 * stop the next one at review time.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { securityViolations, SECURITY_RULES_FROM } = require('../../../scripts/check-migration-quality.js');

const rules = (sql: string): string[] => securityViolations(sql).map((v: { rule: string }) => v.rule);

describe('migration quality — anonymous exposure rules', () => {
  it('applies from the exposure fix onward', () => {
    expect(SECURITY_RULES_FROM).toBe('20261026000000');
  });

  describe('(a) new public tables must enable RLS', () => {
    it('flags a table created without RLS', () => {
      expect(rules('CREATE TABLE IF NOT EXISTS public.widgets (id uuid primary key);')).toEqual([
        expect.stringContaining('table public.widgets must ENABLE ROW LEVEL SECURITY'),
      ]);
    });

    it('flags an unqualified table (it lands in public)', () => {
      expect(rules('CREATE TABLE IF NOT EXISTS widgets (id uuid);')).toHaveLength(1);
    });

    it('accepts RLS enabled in the same migration', () => {
      expect(rules(`CREATE TABLE IF NOT EXISTS public.widgets (id uuid);
        ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY;`)).toEqual([]);
    });

    it('accepts RLS enabled inside a DO block', () => {
      expect(rules(`CREATE TABLE IF NOT EXISTS public.widgets (id uuid);
        DO $$ BEGIN ALTER TABLE public.widgets ENABLE ROW LEVEL SECURITY; END $$;`)).toEqual([]);
    });

    it('ignores other schemas and commented-out DDL', () => {
      expect(rules(`CREATE TABLE IF NOT EXISTS audit.widgets (id uuid);
        -- CREATE TABLE public.ghost (id uuid);
        /* CREATE TABLE public.ghost2 (id uuid); */`)).toEqual([]);
    });

    it('does not accept RLS for a different table', () => {
      expect(rules(`CREATE TABLE IF NOT EXISTS public.widgets (id uuid);
        ALTER TABLE public.widgets_archive ENABLE ROW LEVEL SECURITY;`)).toHaveLength(1);
    });
  });

  describe('(b) SECURITY DEFINER functions must revoke PUBLIC execute', () => {
    const fn = (extra = '') => `CREATE OR REPLACE FUNCTION public.mint(p uuid) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN PERFORM 1; END $$;${extra}`;

    it('flags a definer function without a revoke', () => {
      expect(rules(fn())).toEqual([expect.stringContaining('SECURITY DEFINER function public.mint')]);
    });

    it('accepts REVOKE EXECUTE ... FROM PUBLIC', () => {
      expect(rules(fn('\nREVOKE EXECUTE ON FUNCTION public.mint(uuid) FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION public.mint(uuid) TO service_role;'))).toEqual([]);
    });

    it('does not count a revoke from anon only (PUBLIC still grants it)', () => {
      expect(rules(fn('\nREVOKE EXECUTE ON FUNCTION public.mint(uuid) FROM anon;'))).toHaveLength(1);
    });

    it('ignores SECURITY INVOKER functions', () => {
      expect(rules(`CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;`)).toEqual([]);
    });

    it('does not mistake words inside a function body for the attribute', () => {
      expect(rules(`CREATE FUNCTION public.f() RETURNS text LANGUAGE sql AS $$ SELECT 'SECURITY DEFINER' $$;`)).toEqual([]);
    });
  });

  describe('(c) unconditional anon/public policies need a justification', () => {
    it('flags USING (true) with no TO clause (defaults to public)', () => {
      expect(rules('CREATE POLICY p ON public.t FOR SELECT USING (true);')).toEqual([
        expect.stringContaining('unconditional access'),
      ]);
    });

    it('flags WITH CHECK (true) TO anon', () => {
      expect(rules('CREATE POLICY p ON public.t FOR INSERT TO anon WITH CHECK (true);')).toHaveLength(1);
    });

    it('accepts an annotated, reviewed public policy', () => {
      expect(rules(`-- rls-public-ok: format vocabulary, no tenant data
        CREATE POLICY p ON public.content_type FOR SELECT USING (true);`)).toEqual([]);
    });

    it('accepts conditional or non-public policies', () => {
      expect(rules(`CREATE POLICY a ON public.t FOR SELECT TO authenticated USING (company_id = auth.uid());
        CREATE POLICY b ON public.t FOR ALL TO service_role USING (true) WITH CHECK (true);`)).toEqual([]);
    });
  });
});

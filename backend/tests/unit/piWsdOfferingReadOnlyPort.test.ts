/**
 * PI Lane B — the tenant offering read port is read-only BY TYPE, not by convention.
 *
 * `piWsdOfferingActivation.test.ts` already asserts that the activation sources do not match
 * /\.(insert|upsert|update|delete)\s*\(/. That assertion stays and is still worth having, but it is
 * a grep: it matches text, so it cannot see a write reached through an alias, a helper or a builder
 * handed in by a caller, and it says nothing about a file written next week.
 *
 * This suite pins the complementary guarantee: the port obtains its table through
 * `ReadOnlyTableSource`, whose surface is select / eq / maybeSingle and nothing else. A write is
 * therefore a compile error rather than a grep that happened to match. Two assertions here are
 * type-level on purpose — jest runs ts-jest transpile-only under this repo's `isolatedModules`, so
 * they are checked by `tsc`, not by this run, and they are written so that tsc fails if the read
 * surface ever grows a write verb.
 *
 * Offline and deterministic: the table source is injected, so nothing here touches a database.
 */

import fs from 'fs';
import path from 'path';
import {
  TENANT_OFFERING_PROFILE_COLUMNS,
  buildTenantOfferingContext,
  defaultTenantOfferingContextPorts,
  tenantOfferingContextPortsFrom,
  type ReadOnlyRowQuery,
  type ReadOnlyTable,
  type ReadOnlyTableSource,
  type TenantOfferingContextPorts,
  type TenantOfferingProfileRow,
} from '../../services/offeringIntelligence';

const ASOF = '2026-09-23T00:00:00.000Z';
const TENANT = 'org-1';

const ROW: TenantOfferingProfileRow = {
  products_services_list: ['Signal Desk'],
  core_problem_statement: 'teams act on numbers nobody can trace',
};

interface RecordedRead {
  table: string;
  columns: string;
  filters: Array<[string, unknown]>;
  resolved: boolean;
}

/**
 * A read-only table source that records the query it was asked for.
 *
 * Every property the port reaches for other than the three read verbs throws, so "the port touched
 * only the read surface" is observed here rather than assumed. That is the runtime half of the
 * property the types state — a fake that quietly returned `undefined` for a write verb would prove
 * nothing at all.
 */
function recordingSource(
  outcome: { row: TenantOfferingProfileRow | null; error?: { message: string } },
  reads: RecordedRead[],
): ReadOnlyTableSource {
  return <Row>(table: string): ReadOnlyTable<Row> => {
    const read: RecordedRead = { table, columns: '', filters: [], resolved: false };
    reads.push(read);

    const onlyAllow = <T extends object>(target: T, allowed: readonly string[], surface: string): T =>
      new Proxy(target, {
        get(t, prop, receiver) {
          if (typeof prop === 'string' && !allowed.includes(prop)) {
            throw new Error(`the read port reached for "${prop}" on the ${surface} surface`);
          }
          return Reflect.get(t, prop, receiver);
        },
      });

    const query: ReadOnlyRowQuery<Row> = onlyAllow({
      eq(column: string, value: unknown) { read.filters.push([column, value]); return query; },
      async maybeSingle() {
        read.resolved = true;
        return { data: outcome.row as unknown as Row | null, error: outcome.error ?? null };
      },
    }, ['eq', 'maybeSingle'], 'query');

    return onlyAllow({
      select(columns: string) { read.columns = columns; return query; },
    }, ['select'], 'table');
  };
}

/**
 * A write through the read surface is a compile error. It lives in a function body so the
 * `@ts-expect-error` sits on a real expression: if a write verb ever becomes reachable, tsc reports
 * the expectation as unused and this file stops compiling — which is the guarantee being pinned.
 * Never executed.
 */
function aWriteThroughTheReadSurfaceDoesNotTypeCheck(): void {
  const surface = null as unknown as ReadOnlyTable<TenantOfferingProfileRow>;
  if (surface === null) return;
  // @ts-expect-error — `insert` is not part of the read surface, and must never be.
  void surface.insert;
}

describe('Lane B · the offering read port stays one injectable method', () => {
  it('keeps the default port to exactly one method, of the unchanged port type', () => {
    const asPort: TenantOfferingContextPorts = defaultTenantOfferingContextPorts;   // compile-time
    expect(Object.keys(asPort)).toEqual(['loadProfile']);
    expect(typeof asPort.loadProfile).toBe('function');
  });

  it('is built from the read-only source, and reaches a table at exactly one place', () => {
    const dir = path.resolve(__dirname, '../../services/offeringIntelligence');
    const src = fs.readFileSync(path.join(dir, 'tenantOfferingContext.ts'), 'utf8');
    // ONE narrowing point: the write surface is discarded once, where a reviewer can see it.
    expect(src.match(/ownedDbTable\(/g)).toHaveLength(1);
    expect(src).toMatch(/defaultTenantOfferingContextPorts: TenantOfferingContextPorts =\s*tenantOfferingContextPortsFrom\(readOnlyTableSource\)/);
    // No other file in the module reaches for the write-capable builder at all.
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts') && n !== 'tenantOfferingContext.ts')) {
      expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toContain('writeOwner');
    }
  });
});

describe('Lane B · the read surface carries no write verb', () => {
  it('has none of insert/upsert/update/delete among its keys — tsc checks it, this states it', () => {
    type WriteVerb = 'insert' | 'upsert' | 'update' | 'delete';
    type VerbsOnReadSurface = Extract<
      keyof ReadOnlyTable<TenantOfferingProfileRow> | keyof ReadOnlyRowQuery<TenantOfferingProfileRow>,
      WriteVerb
    >;
    // If a write verb is ever added to either read interface, `VerbsOnReadSurface` stops being
    // `never` and this declaration fails to compile. Inert at runtime by design.
    const noWriteVerbs: VerbsOnReadSurface extends never ? true : never = true;
    expect(noWriteVerbs).toBe(true);
    expect(typeof aWriteThroughTheReadSurfaceDoesNotTypeCheck).toBe('function');
  });
});

describe('Lane B · the port issues exactly the closed read it declares', () => {
  it('selects the 16 declared columns, filters by the tenant, and resolves one row', async () => {
    const reads: RecordedRead[] = [];
    const ports = tenantOfferingContextPortsFrom(recordingSource({ row: ROW }, reads));
    const got = await ports.loadProfile(TENANT);

    expect(got).toBe(ROW);
    expect(reads).toHaveLength(1);
    expect(reads[0].table).toBe('company_profiles');
    expect(reads[0].columns).toBe(TENANT_OFFERING_PROFILE_COLUMNS.join(', '));
    expect(TENANT_OFFERING_PROFILE_COLUMNS).toHaveLength(16);
    expect(reads[0].columns.split(', ')).toHaveLength(16);
    // The tenant boundary is the only filter, and it is not optional.
    expect(reads[0].filters).toEqual([['company_id', TENANT]]);
    expect(reads[0].resolved).toBe(true);
  });

  it('returns null for an absent row and raises a read error rather than swallowing it', async () => {
    const absent = tenantOfferingContextPortsFrom(recordingSource({ row: null }, []));
    await expect(absent.loadProfile(TENANT)).resolves.toBeNull();

    const failing = tenantOfferingContextPortsFrom(
      recordingSource({ row: null, error: { message: 'boom' } }, []),
    );
    await expect(failing.loadProfile(TENANT)).rejects.toThrow(/company_profiles read failed: boom/);
  });

  it('carries the tenant through the builder to every offering key, with no database', async () => {
    const reads: RecordedRead[] = [];
    const built = (await buildTenantOfferingContext(
      { organizationId: TENANT, asOf: ASOF },
      tenantOfferingContextPortsFrom(recordingSource({ row: ROW }, reads)),
    ))!;
    expect(reads[0].filters).toEqual([['company_id', TENANT]]);
    expect(built.contexts.map((c) => c.key)).toEqual([{ companyId: TENANT, offeringId: 'signal-desk' }]);
  });
});

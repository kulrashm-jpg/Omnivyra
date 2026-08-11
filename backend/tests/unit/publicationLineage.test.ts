/**
 * Wave 5 (item 7) — unit tests for publication lineage.
 *
 * Uses an in-memory fake of the service-role client so records genuinely
 * round-trip: recordEvent inserts, getLineage reads and reconstructs the
 * parent→child chain. Company-scoping is exercised (cross-company rows are
 * invisible). Fail-safe behavior is asserted on bad input.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── in-memory fake supabase (append-only table store) ────────────────────────
jest.mock('../../db/supabaseClient', () => {
  const store: Record<string, any[]> = {};
  let seq = 0;

  const makeSelect = (rows: any[]) => {
    const filters: Array<(r: any) => boolean> = [];
    const builder: any = {
      eq(col: string, val: any) {
        filters.push((r) => r[col] === val);
        return builder;
      },
      order(col: string, opts: { ascending?: boolean } = {}) {
        const asc = opts.ascending !== false;
        const data = rows
          .filter((r) => filters.every((f) => f(r)))
          .sort((a, b) => {
            const av = a[col];
            const bv = b[col];
            if (av < bv) return asc ? -1 : 1;
            if (av > bv) return asc ? 1 : -1;
            return 0;
          });
        return Promise.resolve({ data, error: null });
      },
    };
    return builder;
  };

  const supabase = {
    from(table: string) {
      store[table] = store[table] ?? [];
      const rows = store[table];
      return {
        insert(row: any) {
          seq += 1;
          const stored = { id: `row-${seq}`, ...row };
          rows.push(stored);
          return {
            select() {
              return { single: async () => ({ data: stored, error: null }) };
            },
          };
        },
        select() {
          return makeSelect(rows);
        },
      };
    },
    __store: store,
    __reset() {
      for (const k of Object.keys(store)) delete store[k];
      seq = 0;
    },
  };
  return { supabase };
});

import { supabase } from '../../db/supabaseClient';
import {
  recordEvent,
  getEvents,
  getLineage,
  LINEAGE_EVENT_TYPES,
} from '../../services/content/publicationLineageService';

const COMPANY = 'company-1';
const OTHER_COMPANY = 'company-2';

// PHASE A — `publication_lineage` is a canonical-foundation table, so
// recordEvent now sits behind the canonical persistence policy (default DENY).
// This suite exercises the PERSISTENCE behaviour against a mocked store, so it
// must declare that precondition explicitly. No assertion is relaxed: with the
// policy enabled every original expectation holds unchanged. The denial path is
// covered separately in canonicalPersistencePolicy.test.ts.
const PRIOR_PERSISTENCE_ENV = process.env.CANONICAL_PERSISTENCE_ENABLED;

beforeEach(() => {
  process.env.CANONICAL_PERSISTENCE_ENABLED = 'true';
  (supabase as any).__reset();
});

afterAll(() => {
  if (PRIOR_PERSISTENCE_ENV === undefined) delete process.env.CANONICAL_PERSISTENCE_ENABLED;
  else process.env.CANONICAL_PERSISTENCE_ENABLED = PRIOR_PERSISTENCE_ENV;
});

describe('publicationLineageService.recordEvent', () => {
  it('appends an event and returns the persisted row', async () => {
    const ev = await recordEvent({
      companyId: COMPANY,
      contentId: 'c1',
      eventType: 'published',
      platform: 'linkedin',
      createdAt: '2026-07-18T00:00:00.000Z',
    });
    expect(ev).not.toBeNull();
    expect(ev?.eventType).toBe('published');
    expect(ev?.companyId).toBe(COMPANY);
    expect((supabase as any).__store.publication_lineage).toHaveLength(1);
  });

  it('rejects an invalid event type (fail-safe, no throw)', async () => {
    const ev = await recordEvent({
      companyId: COMPANY,
      contentId: 'c1',
      eventType: 'exploded' as any,
    });
    expect(ev).toBeNull();
    expect((supabase as any).__store.publication_lineage ?? []).toHaveLength(0);
  });

  it('rejects a missing companyId', async () => {
    const ev = await recordEvent({ companyId: '', contentId: 'c1', eventType: 'published' });
    expect(ev).toBeNull();
  });

  it('accepts every declared event type', async () => {
    for (const t of LINEAGE_EVENT_TYPES) {
      const ev = await recordEvent({ companyId: COMPANY, contentId: `c-${t}`, eventType: t });
      expect(ev?.eventType).toBe(t);
    }
  });
});

describe('publicationLineageService.getLineage — reconstruction', () => {
  it('reconstructs a parent → child chain (root → … → leaf)', async () => {
    // c1 published → c2 reposted from c1 → c3 regenerated from c2.
    await recordEvent({ companyId: COMPANY, contentId: 'c1', eventType: 'published', createdAt: '2026-07-18T00:00:00.000Z' });
    await recordEvent({ companyId: COMPANY, contentId: 'c2', parentContentId: 'c1', eventType: 'reposted', createdAt: '2026-07-18T01:00:00.000Z' });
    await recordEvent({ companyId: COMPANY, contentId: 'c3', parentContentId: 'c2', eventType: 'regenerated', createdAt: '2026-07-18T02:00:00.000Z' });

    const chain = await getLineage('c3', COMPANY);
    expect(chain.ancestry).toEqual(['c1', 'c2', 'c3']);
    expect(chain.rootContentId).toBe('c1');
    expect(chain.events).toHaveLength(1);
    expect(chain.events[0].eventType).toBe('regenerated');
  });

  it('returns the events for a content id oldest-first', async () => {
    await recordEvent({ companyId: COMPANY, contentId: 'c1', eventType: 'scheduled', createdAt: '2026-07-18T00:00:00.000Z' });
    await recordEvent({ companyId: COMPANY, contentId: 'c1', eventType: 'published', createdAt: '2026-07-18T03:00:00.000Z' });
    await recordEvent({ companyId: COMPANY, contentId: 'c1', eventType: 'revised', createdAt: '2026-07-18T01:00:00.000Z' });

    const events = await getEvents('c1', COMPANY);
    expect(events.map((e) => e.eventType)).toEqual(['scheduled', 'revised', 'published']);
  });

  it('is company-scoped: another company cannot see the chain', async () => {
    await recordEvent({ companyId: COMPANY, contentId: 'c1', eventType: 'published', createdAt: '2026-07-18T00:00:00.000Z' });
    await recordEvent({ companyId: COMPANY, contentId: 'c2', parentContentId: 'c1', eventType: 'reposted', createdAt: '2026-07-18T01:00:00.000Z' });

    const chain = await getLineage('c2', OTHER_COMPANY);
    // No visible events, and the walk cannot climb into another company's rows.
    expect(chain.events).toHaveLength(0);
    expect(chain.ancestry).toEqual(['c2']);
    expect(chain.rootContentId).toBe('c2');
  });

  it('a root with no parents yields a single-node ancestry', async () => {
    await recordEvent({ companyId: COMPANY, contentId: 'root', eventType: 'published', createdAt: '2026-07-18T00:00:00.000Z' });
    const chain = await getLineage('root', COMPANY);
    expect(chain.ancestry).toEqual(['root']);
    expect(chain.rootContentId).toBe('root');
  });

  it('is cycle-safe: a self-referential parent does not loop forever', async () => {
    await recordEvent({ companyId: COMPANY, contentId: 'x', parentContentId: 'x', eventType: 'regenerated', createdAt: '2026-07-18T00:00:00.000Z' });
    const chain = await getLineage('x', COMPANY);
    expect(chain.ancestry).toEqual(['x']);
  });
});

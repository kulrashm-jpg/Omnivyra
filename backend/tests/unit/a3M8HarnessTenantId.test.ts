/**
 * A3 / Phase 1.1 — the M8 certification harness mints UUID tenant ids.
 *
 * ACCEPTANCE CRITERION being pinned: "no generated company/tenant ID violates
 * UUID type."
 *
 * A3 retyped `outreach_*.company_id` from `text` to `uuid`. The harness
 * previously minted `m8-<tag>-<pid>-<seq>`, which fails the entire certification
 * run with `22P02` on the first insert. This suite is the cheap, deterministic
 * proof of the criterion; it is NOT a substitute for a full M8 run, which
 * additionally requires the local certenv to have migration 20261011000000
 * applied — an operational step outside this phase.
 */

import { tenantId, tenantLabel } from '../../../scripts/ws3-m8/harness';

/** RFC 4122 shape, and specifically version 4 as `randomUUID` emits. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The shape that used to be produced, which the uuid column now rejects. */
const LEGACY = /^m8-/;

describe('A3 — M8 harness tenantId()', () => {
  it('emits a syntactically valid UUID', () => {
    expect(tenantId('db')).toMatch(UUID_V4);
  });

  it('never emits the legacy m8- shape that raises 22P02 on a uuid column', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(tenantId(`t${i}`)).not.toMatch(LEGACY);
    }
  });

  it('stays unique across calls — certenv rows are append-only', () => {
    const ids = new Set(Array.from({ length: 200 }, (_, i) => tenantId(`u${i}`)));
    expect(ids.size).toBe(200);
  });

  it('is uniform regardless of the tag, so no tag can reintroduce a bad shape', () => {
    for (const tag of ['db', 'cas', 'redis', 'tax', 'coldstart', 'perf', '', 'a-b_c', '../../etc']) {
      expect(tenantId(tag)).toMatch(UUID_V4);
    }
  });

  it('preserves the human-readable fixture label out-of-band for diagnostics', () => {
    const id = tenantId('coldstart');
    expect(tenantLabel(id)).toMatch(/^m8-coldstart-\d+-\d+$/);
    // The label is a debug aid only — it must never be the identifier itself.
    expect(id).not.toBe(tenantLabel(id));
  });

  it('returns the id itself when no label was recorded', () => {
    expect(tenantLabel('00000000-0000-4000-8000-00000000000a')).toBe('00000000-0000-4000-8000-00000000000a');
  });
});

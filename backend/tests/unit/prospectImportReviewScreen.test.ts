/**
 * R3 screen: translate with the source's own adapter, probe, then route each
 * record to ingest / skip / hold / unknown. Held records are NOT ingested, and
 * a hold that cannot be written never turns into an import.
 */
import { makeScreen } from '../../services/prospectImportReview/screen';
import type { Lookup, ProbePorts } from '../../services/prospectImportReview/probe';
import { __resetLeadSourceRegistry, registerLeadSourceAdapter } from '../../services/leadIngestion/registry';
import { apolloLeadSourceAdapter } from '../../services/leadIngestion/adapters/apolloAdapter';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const NOW = '2026-11-10T12:00:00.000Z';
const none: Lookup = { ok: true, persons: [] };

function ports(over: Partial<Record<keyof ProbePorts, (...a: string[]) => Lookup>> = {}): ProbePorts {
  const wrap = (k: keyof ProbePorts) => async (...a: string[]) => (over[k] ? over[k]!(...a) : none);
  return { byExternalKey: wrap('byExternalKey'), byEmail: wrap('byEmail'), byPhone: wrap('byPhone'), byNameToken: wrap('byNameToken') };
}

beforeEach(() => { __resetLeadSourceRegistry(); registerLeadSourceAdapter(apolloLeadSourceAdapter); });

it('routes each Apollo record: import, skip (email), hold (name), unknown (unreadable)', async () => {
  const holds: unknown[] = [];
  const screen = makeScreen({
    ports: ports({
      byEmail: (_o, e) => (e === 'dup@x.com' ? { ok: true, persons: [{ id: 'p1', fullName: 'Dup Person' }] } : none),
      byNameToken: (_o, t) => (t === 'doe' ? { ok: true, persons: [{ id: 'p2', fullName: 'Jane Doe' }] }
        : t === 'broken' ? { ok: false } : none),
    }),
    hold: async (_o, _s, items) => { holds.push(...items); return { held: items.length }; },
  });
  const records = [
    { id: 'a1', name: 'New Person', email: 'new@x.com' },
    { id: 'a2', name: 'Dup Person', email: 'dup@x.com' },
    { id: 'a3', name: 'Jane Doe' },
    { id: 'a4', name: 'Rita Broken' },
  ];
  const out = await screen({ organizationId: ORG, source: 'apollo', records, now: NOW });
  expect(out.toIngest).toEqual([records[0]]);
  expect(out.skippedDuplicates).toBe(1);
  expect(out.heldForReview).toBe(1);
  expect(out.probeUnknown).toBe(1);
  expect(holds).toEqual([{ providerRecordId: 'a3', reason: 'name_match', matchedPersonIds: ['p2'], raw: records[2] }]);
  expect(out.verdicts.map((v) => [v.providerRecordId, v.verdict, v.reason])).toEqual([
    ['a1', 'import', undefined], ['a2', 'skip', 'email_match'], ['a3', 'hold', 'name_match'], ['a4', 'probe_unknown', 'name'],
  ]);
});

it('a hold that cannot be written is NOT imported: it becomes unknown and is reconsidered next run', async () => {
  const screen = makeScreen({
    ports: ports({ byNameToken: () => ({ ok: true, persons: [{ id: 'p2', fullName: 'Jane Doe' }] }) }),
    hold: async () => { throw new Error('db down'); },
  });
  const out = await screen({ organizationId: ORG, source: 'apollo', records: [{ id: 'a3', name: 'Jane Doe' }], now: NOW });
  expect(out.toIngest).toEqual([]);
  expect(out.heldForReview).toBe(0);
  expect(out.probeUnknown).toBe(1);
  expect(out.verdicts).toEqual([{ providerRecordId: 'a3', verdict: 'probe_unknown', reason: 'hold_write_failed' }]);
});

it('a record the adapter cannot translate is passed through for the orchestrator to report', async () => {
  const screen = makeScreen({ ports: ports() });
  const bad = { name: 'No Id' }; // Apollo translate requires an id
  const out = await screen({ organizationId: ORG, source: 'apollo', records: [bad], now: NOW });
  expect(out.toIngest).toEqual([bad]);
});

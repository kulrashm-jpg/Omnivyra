/**
 * PI-LDB Prompt 2C · THE RECONCILIATION READER MUST NOT MOVE THE DEDUPE KEY.
 *
 * `reconcileLeadProjections` is idempotent because both it and the ingestion
 * orchestrator compute the SAME key for a canonical prospect:
 *
 *     src:<canonicalProspectSource>|tbl:canonical_leads|id:<prospectId>
 *
 * Prompt 2B's argument for that rested on `canonical_leads` having no
 * `unified_source` column. It HAS one — `20260620_unified_source_columns.sql`
 * declares it — and the column is merely unapplied in the environments
 * checked. The default reader asks for `*`, so on the day that migration is
 * applied and backfilled, `crmAdapter` would resolve a different source, the
 * key's source segment would move, and a pass meant to RECOGNISE an existing
 * projection would insert a second row for it instead. The ingestion side
 * cannot use the column either way: its input is a provider payload, not a
 * stored row.
 *
 * So the reader drops it, and this suite pins that.
 *
 * ─── WHY IT DOES NOT USE THE `readProspects` PORT ──────────────────────────
 * `piLdbProjectionRecovery` injects that port, which is right for everything
 * it tests and would make this test vacuous: the behaviour under test IS the
 * default reader. So `backend/db/writeOwner` is doubled one layer lower and
 * the real `readProspectsDefault` runs against it.
 */

const selects: string[] = [];
/** Rows the fake `canonical_leads` hands back, exactly as PostgREST would. */
let prospectRows: Array<Record<string, unknown>> = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const chain = {
      select(columns: string) { selects.push(`${table}:${columns}`); return chain; },
      eq() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      then: (
        onFulfilled?: (v: { data: unknown; error: unknown }) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => Promise.resolve({ data: prospectRows, error: null }).then(onFulfilled, onRejected),
    };
    return chain;
  },
}));
jest.mock('../../services/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { reconcileLeadProjections } from '../../services/leadIntelligence/leadProjectionReconciliation';
import {
  computeLeadDedupeKey,
  routeToCanonicalInput,
  type CanonicalLead,
} from '../../../lib/leadIntelligence';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const AT = '2026-11-06T10:00:00.000Z';
const STABLE_KEY = 'src:crm|tbl:canonical_leads|id:prospect-1';

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'prospect-1',
  company_id: ORG,
  source: 'apollo',
  created_at: AT,
  ...over,
});

const UNIFIED = { unified_source: { origin: 'import', category: 'file' } };

let emitted: CanonicalLead[];

function ports() {
  return {
    findProjection: async () => ({ outcome: 'absent' as const }),
    sink: {
      emit: async (lead: CanonicalLead) => {
        emitted.push(lead);
        return {
          status: 'persisted' as const, leadId: 'lead-1', reason: null, warnings: [], error: null,
        };
      },
    },
    now: () => AT,
  } as never;
}

beforeEach(() => {
  selects.length = 0;
  emitted = [];
  prospectRows = [];
});

describe('PI-LDB 2C · the default prospect reader', () => {
  it('is the real reader — `select(\'*\')` on canonical_leads, not an injected port', async () => {
    prospectRows = [row()];
    await reconcileLeadProjections({ organizationId: ORG, ports: ports() });
    expect(selects).toEqual(['canonical_leads:*']);
  });

  it('projects the STABLE key when the stored row carries `unified_source`', async () => {
    prospectRows = [row(UNIFIED)];

    const out = await reconcileLeadProjections({ organizationId: ORG, ports: ports() });

    expect(out.outcomes[0].status).toBe('projected');
    expect(out.outcomes[0].dedupeKey).toBe(STABLE_KEY);
    expect(computeLeadDedupeKey(emitted[0])).toBe(STABLE_KEY);
  });

  it('NEGATIVE CONTROL: the same row would move the key if the column reached the adapter', () => {
    // Not a hypothetical — this is the production adapter on the production
    // row shape. It is what makes the drop above load bearing rather than
    // decorative, and it fails if `unified_source` ever stops being a source
    // signal (at which point the drop can go).
    expect(computeLeadDedupeKey(routeToCanonicalInput('crm', row(UNIFIED))))
      .not.toBe(STABLE_KEY);
    expect(computeLeadDedupeKey(routeToCanonicalInput('crm', row())))
      .toBe(STABLE_KEY);
  });

  it('the dropped column does not disturb a row that does not carry it', async () => {
    prospectRows = [row(), row({ id: 'prospect-2', ...UNIFIED })];

    const out = await reconcileLeadProjections({ organizationId: ORG, ports: ports() });

    expect(out.examined).toBe(2);
    expect(out.outcomes.map((o) => o.dedupeKey)).toEqual([
      STABLE_KEY,
      'src:crm|tbl:canonical_leads|id:prospect-2',
    ]);
  });
});

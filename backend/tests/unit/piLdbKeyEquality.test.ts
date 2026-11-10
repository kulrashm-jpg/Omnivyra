/**
 * PI-LDB C - the BLOCKING PROOF before reconciliation is consolidated:
 * the dedupe key the PRODUCER writes for a prospect equals the key every
 * READER computes from the canonical_leads row WS-1 wrote for it.
 *
 * Producer (orchestrator.ts): source = canonicalProspectSource({ rawSource:
 *   record.source }), sourceRef = { table: 'canonical_leads', id: prospectId }.
 * WS-1 (prospectResolution.ts): inserts canonical_leads with
 *   source = candidate.source (= record.source, orchestrator) and NO
 *   unified_source.
 * Readers: the read service bridges canonical_leads through crmAdapter as
 *   stored; reconciliation does the same after stripping unified_source
 *   (KEY_MOVING_COLUMNS).
 *
 * If these keys differed, reconciliation would write a SECOND durable row for
 * a prospect, and the read service would list one prospect twice.
 */
import { computeLeadDedupeKey } from '../../../lib/leadIntelligence/dedupe';
import { canonicalProspectSource } from '../../../lib/leadIntelligence/sourceTaxonomy';
import { crmAdapter } from '../../../lib/leadIntelligence/adapters';
import { PI_ADAPTER_PROFILES } from '../../services/prospectProvenance/ingestion/sourceProfiles';

const PROSPECT = '00000000-0000-4000-8000-0000000000c1';
const ORG = '00000000-0000-4000-8000-0000000000aa';

function producerKey(rawSource: string): string {
  return computeLeadDedupeKey({
    organizationId: ORG,
    source: canonicalProspectSource({ rawSource }),
    identity: {},
    sourceRef: { table: 'canonical_leads', id: PROSPECT },
  } as never);
}

/** The row exactly as WS-1 inserts it (the columns the bridge reads). */
function ws1Row(rawSource: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PROSPECT, company_id: ORG, user_id: 'u1', unified_person_id: 'p1', source: rawSource,
    external_lead_key: `${rawSource}:x`, lead_status: null, lead_metadata: {}, created_at: '2026-11-11T00:00:00Z',
    ...extra,
  };
}

function readerKey(row: Record<string, unknown>): string {
  const lead = crmAdapter(row as never);
  return computeLeadDedupeKey(lead as never);
}

// Every adapter profile the orchestrator can ingest through, plus casing and
// a few raw values that resolve through different taxonomy branches.
const SOURCES = [...Object.keys(PI_ADAPTER_PROFILES), 'Apollo', 'CSV', 'hubspot', 'website', 'something_else'];

describe('C - producer key == reader key for every source WS-1 can write', () => {
  it.each(SOURCES)("source '%s': read service and reconciliation compute the producer's key", (src) => {
    const p = producerKey(src);
    const row = ws1Row(src);
    expect(readerKey(row)).toBe(p);                                  // read service (row as stored)
    const { unified_source: _drop, ...stripped } = row;              // reconciliation (KEY_MOVING_COLUMNS)
    expect(readerKey(stripped)).toBe(p);
    expect(p).toContain(`|tbl:canonical_leads|id:${PROSPECT}`);
  });

  it('CONTROL: a unified_source CAN move the read-service key (raw source without an alias), which is why reconciliation strips it', () => {
    // resolveCanonicalSource consults unified_source.origin/category only when
    // the raw source has no alias. `apollo` has none, so origin 'import' turns
    // the reader's source into `import` while the producer wrote `crm`.
    const row = ws1Row('apollo', { unified_source: { origin: 'import' } });
    expect(readerKey(row)).not.toBe(producerKey('apollo'));
    const { unified_source: _drop, ...stripped } = row;
    expect(readerKey(stripped)).toBe(producerKey('apollo'));   // reconciliation's strip restores equality
    // The READ SERVICE does not strip. Its equality therefore rests on WS-1
    // never writing unified_source (it does not: prospectResolution.ts inserts
    // source only). A writer that starts setting unified_source on a WS-1
    // row would make the read service list that prospect twice.
  });
});

/**
 * PI-LDB — the canonical source contract for a `canonical_leads` row when the
 * row carries a `unified_source`.
 *
 * ─── WHAT THIS SUITE IS FOR, AND WHAT IT GOT WRONG BEFORE ─────────────────
 * The WRITER and the READER are driven by DIFFERENT NUMBERS OF SIGNALS:
 *
 *   WRITER  backend/services/leadIngestion/orchestrator.ts:625
 *           canonicalProspectSource({ rawSource: record.source })      1 signal
 *
 *   READER  lib/leadIntelligence/adapters.ts  (crmAdapter)
 *           canonicalProspectSource({ rawSource, unifiedSourceCategory,
 *                                     unifiedSourceOrigin })           3 signals
 *
 * `resolveCanonicalSource` consults `RAW_ALIASES` BEFORE the unified layers, so
 * an ALIASED raw source (`csv`, `manual`, `crm`, `hubspot`, `web`, `website`, …)
 * returns early and both sides agree whatever the row's `unified_source` says.
 * An UNALIASED raw source (`apollo`, `zoominfo`, `linkedin_sales_navigator`, …)
 * falls THROUGH to the unified layers, which only the reader is given.
 *
 * An earlier revision of this suite concluded that the asymmetry was therefore a
 * defect, and "closed" it by making `canonicalProspectSource` WITHHOLD the
 * unified signals. That was wrong, and this suite asserted the wrong values into
 * place — it demanded `expect(readerSource(raw, unified)).toBe('crm')`, which is
 * exactly the regressed value. The withholding moved live, persisted data:
 *
 *   • `crmIngestionService.ts:514` hands `crmAdapter` an IN-MEMORY row carrying a
 *     FRESHLY COMPUTED `unified_source` (`:434`). On the CSV branch its origin is
 *     `import`, so every CRM-CSV row whose `lead_source` has no `RAW_ALIASES`
 *     entry resolved to `import` — and `import` is persisted in
 *     `lead_intelligence.dedupe_key`, which is the UPSERT CONFLICT TARGET
 *     (`leadIntelligenceRepository.ts:117` `onConflict: 'company_id,dedupe_key'`),
 *     in `audience_memberships.entity_id` and in operational note entity ids.
 *     Relabelling it `crm` makes the next resync INSERT A DUPLICATE instead of
 *     updating in place.
 *   • (HISTORICAL, Prompt 2B) `import` was absent from
 *     `buyingIntent.CAPTURE_SOURCES` while `crm` was present, so the relabel
 *     ALSO fabricated a high-confidence `lead_captured` ("Submitted a lead
 *     form") on a row where an operator merely pasted a spreadsheet. That set
 *     no longer exists: `lead_captured` is granted only on recorded
 *     `origin.category === 'inbound_form'` evidence, so no display source
 *     fabricates it any more and this second reason is RETIRED.
 *
 *     The prohibition stands on the key-stability reason above, which was
 *     always the load-bearing one - a relabel still orphans the row from its
 *     notes and audience memberships. Recorded rather than deleted, because a
 *     future reader finding only one reason where the code once gave two
 *     should be able to tell that the other was answered, not overlooked.
 *
 * ─── WHY THE ASYMMETRY IS SAFE, WHICH IS THE REAL CONTRACT ────────────────
 * The two sides only ever describe THE SAME ROW when that row is a
 * `canonical_leads` row read from the database — and such a row carries NO
 * `unified_source`: migration `20260620_unified_source_columns.sql` is
 * deliberately unapplied and no writer in the tree sets that column
 * (`crmIngestionService.ts:114` — "`upsertCanonicalLead` no longer writes it —
 * the write could only fail"). For that row shape the reader's two unified
 * signals are null and it answers identically to the writer. The only row in the
 * tree that DOES carry a `unified_source` is the legacy CRM adoption row, which
 * the writer never projects. So the sides differ only where they describe
 * different rows, and that difference is correct.
 *
 * Every expectation below is a value MEASURED against `origin/main`'s
 * `crmAdapter` (54 raw-source × batch-origin cases, 0 mismatches; 31 aliased
 * raw sources × 6 `unified_source` shapes = 186 reader cases, 0 mismatches),
 * not a value this suite would prefer.
 */

import { canonicalProspectSource, resolveCanonicalSource } from '../../../lib/leadIntelligence/sourceTaxonomy';
import { crmAdapter } from '../../../lib/leadIntelligence/adapters';
import { computeLeadDedupeKey } from '../../../lib/leadIntelligence/dedupe';
import { buildBuyingIntentProfile } from '../../../lib/leadIntelligence/buyingIntent';
import { canonicalLeadToView } from '../../../lib/leadIntelligence/scoreMaterialization';
import { normalizeSource } from '../../services/sourceNormalizationService';
import type { CanonicalLead } from '../../../lib/leadIntelligence';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const PROSPECT = '11111111-1111-4111-8111-111111111111';
const AT = '2026-11-04T10:00:00.000Z';

type Unified = { category?: string | null; origin?: string | null };

/** A `canonical_leads` row exactly as the reader receives it. */
const prospectRow = (source: string, unified: Unified | null) => ({
  id: PROSPECT,
  company_id: ORG,
  source,
  ...(unified ? { unified_source: unified } : {}),
  created_at: AT,
});

/** The READER's answer: `crmAdapter`, verbatim, on that row. */
const readerSource = (source: string, unified: Unified | null) =>
  crmAdapter(prospectRow(source, unified)).source;

/**
 * The WRITER's answer: the orchestrator's call shape, verbatim. It holds the
 * prospect's `source` and nothing else — `resolveOrCreateProspect` returns
 * `{ prospectId, subjectId, outcome, externalLeadKey, reason }` and selects
 * only `id`, so `unified_source` is not available on the write path at all.
 */
const writerSource = (source: string) => canonicalProspectSource({ rawSource: source });

const dedupeKeyOf = (source: string) => computeLeadDedupeKey({
  organizationId: ORG,
  source,
  identity: {},
  attribution: { sourceMetadata: {} },
  sourceRef: { table: 'canonical_leads', id: PROSPECT },
  unifiedPersonId: null,
  ingestedAt: AT,
} as unknown as CanonicalLead);

/** Raw sources with NO `RAW_ALIASES` entry — these fall through to the unified layers. */
const UNALIASED = ['apollo', 'zoominfo', 'linkedin_sales_navigator'] as const;

/**
 * `unified_source` shapes a row can carry, each paired with the canonical source
 * `origin/main`'s reader ACTUALLY computes from it for an unaliased raw source.
 *
 * `readerOnMain` is asserted, not merely recorded. The previous revision carried
 * this column under the name `readerBeforeFix` and never asserted it — which is
 * precisely how the relabel survived review. A documented value that nothing
 * checks is not documentation, it is a comment that can go stale silently.
 */
const UNIFIED_CASES: Array<{ unified: Unified; readerOnMain: string }> = [
  { unified: { origin: 'import', category: 'file' }, readerOnMain: 'import' },
  { unified: { origin: 'webhook', category: null }, readerOnMain: 'webhook' },
  { unified: { origin: 'api', category: null }, readerOnMain: 'api' },
  { unified: { origin: 'manual', category: null }, readerOnMain: 'manual' },
  { unified: { origin: 'integration', category: 'file' }, readerOnMain: 'import' },
  { unified: { origin: 'integration', category: 'engagement' }, readerOnMain: 'engagement' },
];

const COMBINED: Array<[string, string, Unified, string]> = [];
for (const raw of UNALIASED) {
  for (const c of UNIFIED_CASES) COMBINED.push([raw, JSON.stringify(c.unified), c.unified, c.readerOnMain]);
}

// ════════════════════════════════════════════════════════════════════════════
describe('the production prospect row shape — writer and reader DO agree', () => {
  /**
   * The row shape the two sides actually share: a `canonical_leads` row read from
   * the database, which has no `unified_source` column to carry. This is the
   * agreement that matters, and it holds without withholding anything.
   */
  it.each(UNALIASED.map((r) => [r] as [string]))(
    '%s on a row with no unified_source: writer === reader === crm',
    (raw) => {
      expect(readerSource(raw, null)).toBe('crm');
      expect(writerSource(raw)).toBe('crm');
      expect(writerSource(raw)).toBe(readerSource(raw, null));
    },
  );

  it('one dedupe key per prospect for the shared row shape', () => {
    for (const raw of UNALIASED) {
      expect(dedupeKeyOf(readerSource(raw, null))).toBe(dedupeKeyOf(writerSource(raw)));
      expect(dedupeKeyOf(readerSource(raw, null))).toBe(`src:crm|tbl:canonical_leads|id:${PROSPECT}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('GUARD — the reader is pinned to origin/main for every unified_source shape', () => {
  /**
   * THIS IS THE ANTI-REGRESSION GUARD. It exists because a previous mutation run
   * made `canonicalProspectSource` withhold `unifiedSourceCategory` and
   * `unifiedSourceOrigin`, which collapsed every value below to `crm`. The
   * collapse looked harmless — both sides "agreed" and the suites stayed green —
   * while it moved `lead_intelligence.dedupe_key` (the upsert conflict target),
   * `audience_memberships.entity_id` and operational note entity ids for every
   * CRM-CSV row with an unaliased `lead_source`.
   *
   * If the withholding is ever reintroduced, these assertions fail. They are
   * therefore pinned to VALUES, never to "whatever the reader currently says".
   */
  it.each(COMBINED)('%s + unified_source %s reads as the value main persists', (raw, _label, unified, onMain) => {
    expect(readerSource(raw, unified)).toBe(onMain);
  });

  it('the reader consults the unified layers at all — withholding them is detectable', () => {
    // The load-bearing inequality. Under the withholding every one of these
    // became `crm` and this test is the one that would catch it. It asserts a
    // DIFFERENCE, so it cannot be satisfied by collapsing both sides together.
    const divergent = COMBINED.filter(([raw, , unified]) => readerSource(raw, unified) !== writerSource(raw));
    expect(divergent.length).toBe(COMBINED.length);
    expect(new Set(COMBINED.map(([raw, , unified]) => readerSource(raw, unified))))
      .toEqual(new Set(['import', 'webhook', 'api', 'manual', 'engagement']));
    // …and the writer is unmoved, because it never had those signals.
    for (const raw of UNALIASED) expect(writerSource(raw)).toBe('crm');
  });

  it('the divergence describes DIFFERENT ROWS, which is why it is not a defect', () => {
    // A row carrying a `unified_source` is never a prospect row the writer
    // projects: production's `canonical_leads` has no such column, so the only
    // carrier is the legacy CRM adoption row built in memory at
    // `crmIngestionService.ts:514`. For the row the two sides DO share, they
    // agree — asserted here beside the divergence so the two cannot be confused.
    for (const raw of UNALIASED) expect(readerSource(raw, null)).toBe(writerSource(raw));
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the LIVE legacy CRM-CSV adoption row keeps `import`', () => {
  /**
   * The regression this suite previously asserted INTO the tree, pinned as
   * behaviour over the real production code path. The row is built exactly as
   * `crmIngestionService.ts:432-438` builds it — through the real
   * `normalizeSource` — and fed to the real `crmAdapter`, as `:514` does.
   *
   * On the CSV branch (`:614-645`) the batch descriptor is
   * `{ source: 'crm', sourceType: 'file' }`, so `normalizeSource` stamps
   * `origin: 'import'` onto every row in the batch.
   */
  const CSV_BATCH_ORIGIN = 'import';

  /** `crmIngestionService.ts:432-438`, verbatim. */
  const csvRow = (rawLeadSource: string) => {
    const source = rawLeadSource.trim() || 'crm';
    const unified = normalizeSource(source, {
      category: source.trim().toLowerCase() === 'crm' ? 'crm' : undefined,
      channel: undefined,
      origin: CSV_BATCH_ORIGIN,
    });
    return { id: PROSPECT, company_id: ORG, source, unified_source: unified, created_at: AT };
  };

  it.each([['Trade Show'], ['apollo'], ['zoominfo'], ['outbound'], ['csv']])(
    'lead_source %s on the CSV branch stays `import`',
    (rawLeadSource) => {
      expect(crmAdapter(csvRow(rawLeadSource)).source).toBe('import');
    },
  );

  it.each([['crm'], ['hubspot'], ['salesforce'], ['']])(
    'lead_source %s on the CSV branch is a genuine CRM record and stays `crm`',
    (rawLeadSource) => {
      expect(crmAdapter(csvRow(rawLeadSource)).source).toBe('crm');
    },
  );

  it('the persisted dedupe key for a CRM-CSV row is src:import, not src:crm', () => {
    // `dedupe_key` is the upsert conflict target, so this string IS the row's
    // identity. Moving it orphans the existing row and the next resync inserts a
    // duplicate rather than updating in place.
    const lead = crmAdapter(csvRow('Trade Show'));
    expect(computeLeadDedupeKey(lead)).toBe(`src:import|tbl:canonical_leads|id:${PROSPECT}`);
    expect(computeLeadDedupeKey(lead)).not.toBe(`src:crm|tbl:canonical_leads|id:${PROSPECT}`);
  });

  it('NEITHER `import` nor `crm` can claim `lead_captured` from its label alone', () => {
    // RETARGETED (Prompt 2B, owner decision). This test used to assert that
    // `import` withholds a claim `crm` would fabricate, and used the 15-point
    // gap between them as the semantic argument against the relabel. The gap
    // was real and the argument was sound - but the right fix was to stop
    // `crm` fabricating, not to route around it.
    //
    // `lead_captured` now requires recorded `inbound_form` evidence, so the
    // gap is CLOSED: neither source earns it, and the relabel can no longer
    // invent 15 points whichever way it goes. Asserting the closure is what
    // stops the fabrication returning, and asserting it from BOTH sides is
    // what makes it a rule rather than a patch for one source.
    const viewOf = (source: string) => canonicalLeadToView({
      organizationId: ORG,
      source,
      identity: { email: 'a@b.test', unifiedPersonId: 'up-7' },
      attribution: {
        sourceMetadata: {},
        utm: { source: null, medium: null, campaign: null, content: null, term: null },
        campaign: null, content: null, referrer: null,
      },
      scores: {},
      status: null,
      occurredAt: AT,
      sourceRef: { table: 'canonical_leads', id: PROSPECT },
    } as unknown as CanonicalLead);

    const asImport = buildBuyingIntentProfile({ view: viewOf('import') } as never);
    expect(asImport.score).toBe(0);
    expect(asImport.evidence.map((e) => e.type)).not.toContain('lead_captured');

    // THE MEASURED CLOSURE. Under the old rule this was 15 and carried
    // `lead_captured`; both sources now answer identically, so the relabel
    // moves no points in either direction.
    const asCrm = buildBuyingIntentProfile({ view: viewOf('crm') } as never);
    expect(asCrm.score).toBe(0);
    expect(asCrm.evidence.map((e) => e.type)).not.toContain('lead_captured');
    expect(asCrm.score).toBe(asImport.score);

    // The claim follows EVIDENCE, not the label - asserted on the source that
    // used to get it for free, so this fails if membership-by-source returns.
    const withForm = buildBuyingIntentProfile({
      view: { ...viewOf('crm'), origin: { category: 'inbound_form', platform: null, observedAt: null } },
    } as never);
    expect(withForm.evidence.map((e) => e.type)).toContain('lead_captured');
    expect(withForm.score).toBe(15);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('an ALIASED raw source is untouched — RAW_ALIASES still returns early', () => {
  /**
   * The paired protection. Nothing about the contract above may move an aliased
   * raw source, because those values are already persisted. Agent B measured a
   * durable row where `csv` produced `source=import` and
   * `dedupe_key=src:import|tbl:canonical_leads|id:<prospect>`; that row must not
   * move. `web`/`website` are in this group too — they DO have `RAW_ALIASES`
   * entries, so they never reached the unified layers and were never part of the
   * defect. All 31 × 6 reader cases below were measured identical on main.
   */
  const ALIASED: Array<[string, string]> = [
    ['csv', 'import'],
    ['import', 'import'],
    ['upload', 'import'],
    ['data_upload', 'import'],
    ['manual', 'manual'],
    ['manual_entry', 'manual'],
    ['sales', 'manual'],
    ['crm', 'crm'],
    ['hubspot', 'crm'],
    ['salesforce', 'crm'],
    ['zoho', 'crm'],
    ['web', 'crm'],        // RAW_ALIASES → website → coerced to crm
    ['website', 'crm'],
    ['site', 'crm'],
    ['form', 'crm'],
    ['form_embed', 'crm'],
    ['landing', 'crm'],
    ['direct', 'crm'],
    ['blog', 'blog'],
    ['social', 'social'],
    ['engagement', 'engagement'],
    ['dm', 'engagement'],
    ['comment', 'engagement'],
    ['community', 'community'],
    ['listening', 'community'],
    ['marketpulse', 'marketpulse'],
    ['market_pulse', 'marketpulse'],
    ['referral', 'referral'],
    ['partner', 'partner'],
    ['api', 'api'],
    ['webhook', 'webhook'],
  ];

  it.each(ALIASED)('%s pins to %s regardless of unified_source', (raw, expected) => {
    expect(writerSource(raw)).toBe(expected);
    expect(readerSource(raw, null)).toBe(expected);
    for (const c of UNIFIED_CASES) {
      expect(readerSource(raw, c.unified)).toBe(expected);
      expect(writerSource(raw)).toBe(readerSource(raw, c.unified));
    }
  });

  it('csv keeps the dedupe key Agent B measured on a durable row', () => {
    expect(dedupeKeyOf(writerSource('csv'))).toBe(`src:import|tbl:canonical_leads|id:${PROSPECT}`);
  });

  it('resolveCanonicalSource itself is NOT re-pointed — every non-prospect caller is unaffected', () => {
    // `canonicalProspectSource` is the canonical_leads contract. The general
    // resolver serves `websiteAdapter` and the signal adapters, whose rows DO
    // legitimately carry a `unified_source`, so its unified layers must keep
    // working exactly as they are. A fix that neutered them would silently
    // relabel `leads`-table rows.
    expect(resolveCanonicalSource({ unifiedSourceOrigin: 'import' })).toBe('import');
    expect(resolveCanonicalSource({ unifiedSourceOrigin: 'webhook' })).toBe('webhook');
    expect(resolveCanonicalSource({ unifiedSourceOrigin: 'api' })).toBe('api');
    expect(resolveCanonicalSource({ unifiedSourceOrigin: 'manual' })).toBe('manual');
    expect(resolveCanonicalSource({ unifiedSourceCategory: 'file' })).toBe('import');
    expect(resolveCanonicalSource({ unifiedSourceCategory: 'engagement' })).toBe('engagement');
    expect(resolveCanonicalSource({ rawSource: 'apollo', unifiedSourceOrigin: 'import' })).toBe('import');
  });

  it('canonicalProspectSource only coerces website/other, and is total onto the taxonomy', () => {
    // The coercion is the ONLY thing `canonicalProspectSource` adds over the
    // general resolver. Pinned so the helper cannot quietly grow a second rule.
    expect(canonicalProspectSource({ rawSource: 'a-source-nobody-has-mapped-yet' })).toBe('crm');
    expect(canonicalProspectSource({ rawSource: 'website' })).toBe('crm');
    expect(canonicalProspectSource({})).toBe('crm');
    expect(canonicalProspectSource({ rawSource: 'blog' })).toBe('blog');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the write path genuinely cannot see unified_source', () => {
  /**
   * The constraint behind the shape of the contract, pinned so it is
   * re-examined rather than assumed if WS-1's resolver ever widens its SELECT or
   * a writer starts setting the column. If either changes, the premise that makes
   * the writer/reader asymmetry safe no longer holds, and the GUARD block above
   * must be revisited rather than quietly re-pointed.
   */
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf8');

  it('WS-1 selects only `id` from canonical_leads, so the resolution carries no unified_source', () => {
    const ws1 = read('../../services/prospectIdentity/prospectResolution.ts');
    expect(ws1).toContain(".insert(row).select('id').single()");
    expect(ws1).not.toContain('unified_source');
  });

  it('the orchestrator resolves the projection source from the prospect row own source only', () => {
    const orch = read('../../services/leadIngestion/orchestrator.ts');
    expect(orch).toContain('canonicalProspectSource({ rawSource: record.source })');
  });

  it('no canonical_leads writer sets unified_source, so a DB-read row never carries one', () => {
    const svc = read('../../services/crmIngestionService.ts');
    const start = svc.indexOf('async function upsertCanonicalLead(params: {');
    expect(start).toBeGreaterThan(-1);
    // Search FORWARD from `start`: `upsertCanonicalUser` above uses the same
    // insert idiom, so an unanchored search lands in the wrong function.
    const end = svc.indexOf(".insert(payload).select('id').single()", start);
    expect(end).toBeGreaterThan(start);
    // The whole canonical_leads write — the UPDATE branch and the INSERT payload.
    expect(svc.slice(start, end)).not.toContain('unified_source');
  });
});

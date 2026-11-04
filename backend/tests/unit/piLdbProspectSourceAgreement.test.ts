/**
 * PI-LDB regression — the WRITER and the READER must agree on the canonical
 * source of a `canonical_leads` row.
 *
 * ─── WHAT THIS CATCHES, AND WHY IT IS NOT A STYLE RULE ────────────────────
 * `lead_intelligence.dedupe_key` and the view's lead key both EMBED the source
 * (`lib/leadIntelligence/dedupe.ts`, `lib/leadIntelligence/leadKey.ts`). So if
 * the durable projection labels a prospect `other` while the reader's
 * `canonical_leads` bridge labels the same row `crm`, the two views get
 * different keys, `dedupeViews` cannot collapse them, and the Lead Database
 * lists ONE person TWICE — once as "Other".
 *
 * That is not hypothetical. It happened: the orchestrator called
 * `resolveCanonicalSource`, which returns `other` for a PI-discovery provider
 * such as `apollo` (no `RAW_ALIASES` entry, so it falls through), while
 * `crmAdapter` coerces `website`/`other` to `crm` for a `canonical_leads` row.
 * Two real-schema acceptance suites failed on a mysterious view COUNT, four
 * tests deep, with nothing naming the actual disagreement.
 *
 * The fix was to give both sides one definition, `canonicalProspectSource`.
 * This test pins the agreement directly, so the next divergence fails HERE —
 * on the invariant, in one line, instead of as an unexplained count in an
 * acceptance suite that needs a database to run.
 */

import { canonicalProspectSource, resolveCanonicalSource } from '../../../lib/leadIntelligence/sourceTaxonomy';
import { crmAdapter } from '../../../lib/leadIntelligence/adapters';
import { computeLeadDedupeKey } from '../../../lib/leadIntelligence/dedupe';
import type { CanonicalLead } from '../../../lib/leadIntelligence';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const PROSPECT = '11111111-1111-4111-8111-111111111111';

/** Every raw source the ingestion path can actually carry onto a prospect. */
const RAW_SOURCES = [
  'apollo', // PI discovery — resolves to `other`, so this is the case that broke
  'csv',
  'manual',
  'crm',
  'hubspot',
  'salesforce',
  'website',
  'form_embed',
  'linkedin',
  'a-source-nobody-has-mapped-yet', // the unknown fallback, also `other`
] as const;

describe('the writer and the reader agree on a canonical prospect source', () => {
  it.each(RAW_SOURCES)('%s resolves identically on both sides', (raw) => {
    // The READER's answer for a `canonical_leads` row carrying this source.
    const readerView = crmAdapter({
      id: PROSPECT,
      company_id: ORG,
      source: raw,
      created_at: '2026-11-02T10:00:00.000Z',
    });

    // The WRITER's answer for the same row.
    const writerSource = canonicalProspectSource({ rawSource: raw });

    expect(writerSource).toBe(readerView.source);
  });

  it.each([
    ['apollo', 'crm'],
    ['website', 'crm'],
    ['form_embed', 'crm'],
    ['a-source-nobody-has-mapped-yet', 'crm'],
    ['csv', 'import'],
    ['manual', 'manual'],
    // 'crm', NOT 'social': `RAW_ALIASES` has no `linkedin` entry and the
    // SOCIAL_PLATFORMS check reads `signals.platform`, not `rawSource` — so
    // `linkedin` as a raw SOURCE falls through to `other` and is coerced. My
    // first draft of this row expected 'social' and the test caught it, which
    // is the point of pinning values rather than describing them.
    ['linkedin', 'crm'],
  ])('%s pins to the VALUE %s, which is main\'s existing behaviour', (raw, expected) => {
    // AGREEMENT ALONE IS NOT ENOUGH, and a mutation run proved it: deleting the
    // coercion from `canonicalProspectSource` moved BOTH sides to `other`
    // together, so they still agreed and the real-schema acceptance suites
    // still passed — while every Apollo prospect would have been relabelled
    // and every existing lead key moved (notes and audience memberships are
    // keyed on it). These are the values main's `crmAdapter` produced before
    // the sprint, so this is the assertion that stops the keys drifting.
    expect(canonicalProspectSource({ rawSource: raw })).toBe(expected);
  });

  it('is a REAL constraint: the pre-fix helper disagreed for three of these', () => {
    // The paired negative. Without this, the test above would also pass against
    // an implementation where both sides called the same WRONG function — and a
    // test that cannot distinguish the fix from the defect proves nothing.
    const divergent = RAW_SOURCES.filter((raw) => {
      const pre = resolveCanonicalSource({ rawSource: raw });
      const post = canonicalProspectSource({ rawSource: raw });
      return pre !== post;
    });
    expect(divergent).toEqual(expect.arrayContaining(['apollo', 'website', 'a-source-nobody-has-mapped-yet']));
    expect(divergent.length).toBeGreaterThanOrEqual(3);
  });

  it('produces one dedupe key per prospect, not one per label', () => {
    // The mechanism, asserted directly. Two labels for one row is exactly what
    // made the key split and the lead appear twice.
    const keyFor = (raw: string) => computeLeadDedupeKey({
      organizationId: ORG,
      source: canonicalProspectSource({ rawSource: raw }),
      identity: {},
      attribution: { sourceMetadata: {} },
      sourceRef: { table: 'canonical_leads', id: PROSPECT },
      unifiedPersonId: null,
      ingestedAt: '2026-11-02T10:00:00.000Z',
    } as unknown as CanonicalLead);

    // `apollo` and an unmapped source are both PI-discovery-ish and both land on
    // the reader's label, so they share the prospect's key rather than minting
    // a second row for the same person.
    expect(keyFor('apollo')).toBe(keyFor('a-source-nobody-has-mapped-yet'));
    expect(keyFor('apollo')).toContain(`tbl:canonical_leads|id:${PROSPECT}`);

    // And a genuinely different source family still gets its own key — so this
    // is not passing because the key ignores the source entirely.
    expect(keyFor('csv')).not.toBe(keyFor('apollo'));
  });
});

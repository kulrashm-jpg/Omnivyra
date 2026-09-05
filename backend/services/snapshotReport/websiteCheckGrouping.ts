/**
 * GAP-10 — group the deterministic engines' existing check results for the customer.
 *
 * This module is presentation only. It does not evaluate anything, does not change a status, and
 * does not compute a score: it takes the `CheckResult[]` the technical / content / accessibility
 * engines already produced and files each one under the group a reader would look for it in.
 *
 * Grouping decision (documented deliberately):
 *   The five groups named in the GAP-10 brief — reachability, indexability, metadata, structured
 *   data, linking — are preserved exactly and cover the technical engine. Three further groups
 *   exist because the remaining checks genuinely do not belong in those five:
 *     • `rendering`         — technical checks a static crawl cannot observe (JS errors, CSS,
 *                             compression, image optimisation, lazy loading). They are always
 *                             `not_evaluable`; grouping them together makes that limitation
 *                             legible instead of scattering it through the other five.
 *     • `content_structure` — the content engine's checks.
 *     • `accessibility`     — the accessibility engine's checks.
 *   Filing an alt-text check under "Metadata" to force a five-group shape would misdescribe it,
 *   which is the opposite of what this report is for.
 *
 * An unrecognised key is never dropped: it falls to the group matching its engine, so a check
 * added to an engine later still reaches the customer without a change here.
 */
import type { CheckResult } from '../platformIntelligence/confidence';
// GAP-07/10 — the provenance policy is the sole authority for how this evidence is classified.
import { provenanceForSource } from '../evidenceProvenance';
import type {
  SnapshotWebsiteCheck,
  SnapshotWebsiteCheckGroup,
  SnapshotWebsiteChecks,
} from '../snapshotReportTypes';

type GroupId = SnapshotWebsiteCheckGroup['id'];

const GROUP_LABELS: Record<GroupId, string> = {
  reachability: 'Reachability',
  indexability: 'Indexability',
  metadata: 'Metadata',
  structured_data: 'Structured data',
  linking: 'Linking',
  rendering: 'Rendering & assets',
  content_structure: 'Content structure',
  accessibility: 'Accessibility',
};

/** Presentation order. Reachability first: a page that cannot be fetched makes the rest moot. */
const GROUP_ORDER: GroupId[] = [
  'reachability',
  'indexability',
  'metadata',
  'structured_data',
  'linking',
  'rendering',
  'content_structure',
  'accessibility',
];

/** Technical-engine keys → group. Keys are the engines' own, verbatim. */
const TECHNICAL_GROUP: Record<string, GroupId> = {
  crawl: 'reachability',
  crawlability: 'reachability',
  broken_links: 'reachability',
  redirect_chains: 'reachability',
  https: 'reachability',
  security_headers: 'reachability',
  cache_headers: 'reachability',

  indexability: 'indexability',
  robots_txt: 'indexability',
  sitemap_xml: 'indexability',
  canonical_tags: 'indexability',
  hreflang: 'indexability',
  pagination: 'indexability',
  duplicate_titles: 'indexability',
  duplicate_descriptions: 'indexability',

  meta_tags: 'metadata',
  open_graph: 'metadata',
  twitter_cards: 'metadata',
  heading_structure: 'metadata',

  structured_data: 'structured_data',
  content_feeds: 'structured_data',

  internal_linking: 'linking',
  page_depth: 'linking',

  compression: 'rendering',
  image_optimization: 'rendering',
  lazy_loading: 'rendering',
  javascript_errors: 'rendering',
  css_issues: 'rendering',
};

const ENGINE_FALLBACK: Record<SnapshotWebsiteCheck['engine'], GroupId> = {
  technical: 'reachability',
  content: 'content_structure',
  accessibility: 'accessibility',
};

function groupFor(engine: SnapshotWebsiteCheck['engine'], key: string): GroupId {
  if (engine === 'technical') return TECHNICAL_GROUP[key] ?? ENGINE_FALLBACK.technical;
  return ENGINE_FALLBACK[engine];
}

/**
 * Carry one engine's results across unchanged. The engine's `score` is intentionally dropped —
 * see `SnapshotWebsiteCheck`. `detail` is normalised to `string | null` so the persisted shape is
 * stable through the JSONB round trip (an `undefined` property would simply vanish).
 */
function adopt(
  checks: CheckResult[] | undefined | null,
  engine: SnapshotWebsiteCheck['engine'],
): SnapshotWebsiteCheck[] {
  if (!Array.isArray(checks)) return [];
  return checks.map((check) => ({
    key: check.key,
    label: check.label,
    status: check.status,
    detail: check.detail ?? null,
    engine,
  }));
}

/**
 * GAP-10 — assemble the customer-facing check surface from evidence the run already produced.
 *
 * Returns `null` when NOTHING was evaluable. That is the GAP-02 rule applied to this section: a
 * company with no crawled pages must not be handed a page of checks, because every engine emits
 * exactly one `crawl: not_evaluable` row in that case and rendering it would dress "we never
 * fetched your site" as a technical assessment. The disclosure that no crawl happened is
 * GAP-09's job, and it already does it.
 */
export function buildWebsiteChecks(params: {
  technical?: { checks?: CheckResult[] } | null;
  content?: { checks?: CheckResult[] } | null;
  accessibility?: { checks?: CheckResult[] } | null;
  pagesEvaluated: number;
}): SnapshotWebsiteChecks | null {
  const all: SnapshotWebsiteCheck[] = [
    ...adopt(params.technical?.checks, 'technical'),
    ...adopt(params.content?.checks, 'content'),
    ...adopt(params.accessibility?.checks, 'accessibility'),
  ];
  if (all.length === 0) return null;

  const evaluated = all.filter((check) => check.status !== 'not_evaluable').length;
  // Nothing the engines could actually evaluate ⇒ abstain rather than render an all-"not
  // evaluated" section. This is the zero-crawl case and is deliberately engine-truthful: it asks
  // the engines what they managed to do rather than second-guessing them from a page count.
  if (evaluated === 0) return null;

  const byGroup = new Map<GroupId, SnapshotWebsiteCheck[]>();
  for (const check of all) {
    const id = groupFor(check.engine, check.key);
    const bucket = byGroup.get(id);
    if (bucket) bucket.push(check);
    else byGroup.set(id, [check]);
  }

  const groups: SnapshotWebsiteCheckGroup[] = GROUP_ORDER
    .filter((id) => (byGroup.get(id)?.length ?? 0) > 0)
    .map((id) => ({ id, label: GROUP_LABELS[id], checks: byGroup.get(id) as SnapshotWebsiteCheck[] }));

  return {
    groups,
    evaluated,
    notEvaluable: all.length - evaluated,
    total: all.length,
    pagesEvaluated: params.pagesEvaluated,
    // Resolved from the policy, not asserted here: these checks are a deterministic audit over the
    // public crawl, which `evidenceProvenance.ts` classifies as PUBLIC_OBSERVED.
    provenance: provenanceForSource('public_audit'),
  };
}

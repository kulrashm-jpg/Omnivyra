/**
 * REPORT-1-COMPLETION WP-14 (Track M) — OFFLINE assertion helpers for a GENERATED Report 1
 * artifact.
 *
 * ─── WHY THIS MODULE EXISTS ───────────────────────────────────────────────────
 * Seven Report 1 integrity remediations (slices 001–007) shipped to production at 3d643f5c.
 * Every one of them is verified only by unit tests over synthetic inputs. Their
 * customer-visible behaviour has never been observed on a real report.
 *
 * The real-tenant exercise that would observe it requires authorization this workstream does
 * not have. What CAN be built ahead of that gate is the part that removes human judgement from
 * the observation step: given a report artifact that a later, authorized run produces, decide
 * mechanically whether each slice's guarantee held.
 *
 * ─── THE DISTINCTION THIS MODULE ENCODES ──────────────────────────────────────
 * A validation that reports "the surface was there" as though it were "the behaviour was
 * correct" is worse than no validation. Six levels are kept apart, and {@link CheckStatus}
 * exists so this module can never collapse them:
 *
 *   artifact present      an artifact exists and parses                 (level `artifact_present`)
 *   route reachable       a route answered                              NOT observable offline
 *   report generated      the artifact carries a Report 1 payload       (level `report_generated`)
 *   behaviour observed    the surface carried instances to judge        (level `behaviour_observed`)
 *   expected behaviour    those instances satisfied the slice contract  (level `expected_behaviour`)
 *   unexpected behaviour  they did not                                  (level `unexpected_behaviour`)
 *
 * `route_reachable` is deliberately unreachable from here: nothing about a JSON payload
 * establishes that an HTTP route answered. The validation plan establishes it in its own step
 * and records it separately. This module will never emit it.
 *
 * CRITICALLY: absence is never success. A surface that is missing yields `surface_absent`, and a
 * surface present but carrying nothing to judge yields `not_observed`. Neither is `expected`, and
 * {@link summarizeReport1Findings} reports them as their own counts so a run in which nothing
 * happened can never read as a run in which everything passed.
 *
 * ─── SCOPE ────────────────────────────────────────────────────────────────────
 * Pure functions over a plain object (and, for the rendered checks, an HTML string). No I/O, no
 * database, no network, no environment. It can be run against a saved artifact on any machine,
 * which is the point: the observation step must not require the production environment a second
 * time.
 *
 * `evidenceProvenance.ts` remains the sole authority on which sources and classes are public —
 * this module asks it rather than restating the table.
 */
import {
  PRIVATE_PROVENANCE,
  REPORT1_PROVENANCE,
  isReport1Source,
  type EvidenceProvenanceClass,
} from '../evidenceProvenance';
import type { EvidenceSourceKind } from '../canonicalReport/canonicalReportTypes';

// ── Result vocabulary ────────────────────────────────────────────────────────

/** The six levels the brief requires to be kept apart. See the module header. */
export type ObservationLevel =
  | 'artifact_present'
  | 'route_reachable'
  | 'report_generated'
  | 'behaviour_observed'
  | 'expected_behaviour'
  | 'unexpected_behaviour';

/**
 * `surface_absent` — the artifact does not carry the surface at all. Nothing was observed.
 * `not_observed`   — the surface is present but held no instance the contract applies to.
 * `expected`       — instances were observed and satisfied the contract.
 * `unexpected`     — instances were observed and violated it.
 */
export type CheckStatus = 'surface_absent' | 'not_observed' | 'expected' | 'unexpected';

export type Report1Slice = '001' | '002' | '003' | '004' | '005' | '006' | '007';

export type Report1Finding = {
  /** Stable identifier so a later run can be compared to this one check by check. */
  id: string;
  slice: Report1Slice;
  status: CheckStatus;
  level: ObservationLevel;
  /** What was observed, in terms a reader can check against the artifact. */
  message: string;
  /** Where in the artifact, as a JSON path. `$` is the artifact root. */
  path: string;
};

const LEVEL_FOR_STATUS: Record<CheckStatus, ObservationLevel> = {
  surface_absent: 'artifact_present',
  not_observed: 'report_generated',
  expected: 'expected_behaviour',
  unexpected: 'unexpected_behaviour',
};

function finding(
  id: string,
  slice: Report1Slice,
  status: CheckStatus,
  path: string,
  message: string,
): Report1Finding {
  return { id, slice, status, level: LEVEL_FOR_STATUS[status], message, path };
}

// ── Artifact access ──────────────────────────────────────────────────────────

export type Report1Artifact = Record<string, unknown>;

type Located = { value: unknown; path: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function at(root: unknown, segments: string[]): Located | null {
  let cursor: unknown = root;
  for (const segment of segments) {
    if (!isObject(cursor) || !(segment in cursor)) return null;
    cursor = cursor[segment];
  }
  return { value: cursor, path: `$.${segments.join('.')}` };
}

/**
 * The camelCase names the same surface carries on `ReportViewPayload` — the shape the
 * `/api/reports/[reportId]?type=snapshot` route returns, which is NOT the persisted row.
 *
 * Both spellings are accepted because a validation that silently found nothing would be
 * indistinguishable from a validation that found nothing wrong, and the two captures the plan
 * takes use different spellings for the same data.
 */
const FIELD_ALIASES: Record<string, string[]> = {
  website_checks: ['website_checks', 'websiteChecks'],
  digital_snapshot: ['digital_snapshot', 'digitalSnapshot'],
  advertising: ['advertising'],
  competitor_intelligence: ['competitor_intelligence', 'competitorIntelligence'],
};

/**
 * Report 1 surfaces appear at different depths depending on which artifact was captured: the
 * persisted `reports.data` row (root), the canonical export payload (`report1.*`), or an API
 * response that nests either under `data`. All four are accepted so the plan's capture step is
 * not forced to normalise first — a normalisation step is a place a validation can quietly lose
 * the very thing it was meant to inspect.
 */
function locate(artifact: Report1Artifact, field: string): Located | null {
  const names = FIELD_ALIASES[field] ?? [field];
  for (const prefix of [[], ['report1'], ['data'], ['data', 'report1']]) {
    for (const name of names) {
      const hit = at(artifact, [...prefix, name]);
      if (hit && hit.value !== undefined && hit.value !== null) return hit;
    }
  }
  return null;
}

type Visitor = (value: unknown, path: string, key: string | null) => boolean | void;

/** Depth-first walk. A visitor returning `false` stops the descent into that value. */
function walk(root: unknown, visit: Visitor, path = '$', key: string | null = null): void {
  if (visit(root, path, key) === false) return;
  if (Array.isArray(root)) {
    root.forEach((item, i) => walk(item, visit, `${path}[${i}]`, key));
    return;
  }
  if (isObject(root)) {
    for (const [k, v] of Object.entries(root)) walk(v, visit, `${path}.${k}`, k);
  }
}

// ── Slice 001 — website presence integrity ───────────────────────────────────

/** The seven content presence checks REMEDIATION-001 governs. */
export const GOVERNED_PRESENCE_CHECKS = [
  'contact_info',
  'pricing_visibility',
  'company_information',
  'legal_pages',
  'testimonials',
  'social_proof',
  'case_studies',
] as const;

/** Their customer-facing labels, as the renderer prints them. */
export const GOVERNED_PRESENCE_LABELS: Record<(typeof GOVERNED_PRESENCE_CHECKS)[number], string> = {
  contact_info: 'Contact information',
  pricing_visibility: 'Pricing visibility',
  company_information: 'Company information',
  legal_pages: 'Legal pages',
  testimonials: 'Testimonials',
  social_proof: 'Social proof',
  case_studies: 'Case studies',
};

/** The fabricated detail string the defect emitted in both directions. */
const FABRICATED_DETAIL = 'detected on the site';
/** The corrected absence wording the engine now writes. */
const ABSENCE_DETAIL = /^No .+ found among the \d+ pages read$/;
/** The corrected presence wording. */
const PRESENCE_DETAIL = /found among the \d+ pages read$/;

type WebsiteCheck = { key?: unknown; label?: unknown; status?: unknown; detail?: unknown };

function collectChecks(checks: Located): Array<{ check: WebsiteCheck; path: string }> {
  const out: Array<{ check: WebsiteCheck; path: string }> = [];
  const groups = isObject(checks.value) ? checks.value.groups : null;
  if (!Array.isArray(groups)) return out;
  groups.forEach((group, gi) => {
    const inner = isObject(group) ? group.checks : null;
    if (!Array.isArray(inner)) return;
    inner.forEach((check, ci) => {
      if (isObject(check)) out.push({ check, path: `${checks.path}.groups[${gi}].checks[${ci}]` });
    });
  });
  return out;
}

/**
 * Slice 001 — a presence check must never claim an observation it did not make.
 *
 * The persisted check drops the engine's numeric score, so `detail` and `status` are the only
 * carriers left. That is exactly the surface the defect corrupted, and it is what is asserted
 * here.
 */
export function assertPresenceCheckIntegrity(artifact: Report1Artifact): Report1Finding[] {
  const located = locate(artifact, 'website_checks');
  if (!located || !isObject(located.value)) {
    return [
      finding(
        'P-00',
        '001',
        'surface_absent',
        '$.website_checks',
        'No website_checks surface in the artifact. Presence integrity was NOT observed — this is not a pass. '
          + 'Either the crawl evaluated nothing, or the section did not reach the payload.',
      ),
    ];
  }

  const findings: Report1Finding[] = [];
  const all = collectChecks(located);
  const pagesEvaluated =
    typeof located.value.pagesEvaluated === 'number' ? located.value.pagesEvaluated : null;

  // P-01 — the fabricated string is gone from EVERY check, not only the seven.
  const fabricated = all.filter(({ check }) => String(check.detail ?? '').includes(FABRICATED_DETAIL));
  findings.push(
    fabricated.length > 0
      ? finding(
          'P-01',
          '001',
          'unexpected',
          fabricated[0].path,
          `${fabricated.length} check(s) still carry the fabricated detail "...${FABRICATED_DETAIL}". `
            + 'REMEDIATION-001 removed this string; its presence means a pre-remediation engine produced this report.',
        )
      : finding(
          'P-01',
          '001',
          'expected',
          located.path,
          `No check carries "...${FABRICATED_DETAIL}" (${all.length} checks inspected).`,
        ),
  );

  const byKey = new Map(
    all
      .filter(({ check }) => typeof check.key === 'string')
      .map(({ check, path }) => [check.key as string, { check, path }]),
  );
  const present = GOVERNED_PRESENCE_CHECKS.filter((k) => byKey.has(k));

  if (present.length === 0) {
    findings.push(
      finding(
        'P-02',
        '001',
        pagesEvaluated === 0 ? 'expected' : 'not_observed',
        located.path,
        pagesEvaluated === 0
          ? 'The crawl read 0 pages and none of the seven governed presence checks was emitted, which is the contract for an empty crawl.'
          : `None of the seven governed presence checks appears (pagesEvaluated=${pagesEvaluated ?? 'unknown'}). `
            + 'Nothing was observed about presence integrity on this report.',
      ),
    );
    return findings;
  }

  if (pagesEvaluated === 0) {
    findings.push(
      finding(
        'P-02',
        '001',
        'unexpected',
        located.path,
        `The crawl read 0 pages yet emitted ${present.length} governed presence check(s). `
          + 'With no page read, no presence statement can be made in either direction.',
      ),
    );
  }

  for (const key of present) {
    const entry = byKey.get(key);
    if (!entry) continue;
    const { check, path } = entry;
    const status = String(check.status ?? '');
    const detail = typeof check.detail === 'string' ? check.detail : '';

    // P-03 — a detail that states ABSENCE may never sit on a `pass`.
    if (ABSENCE_DETAIL.test(detail)) {
      findings.push(
        status === 'pass'
          ? finding(
              'P-03',
              '001',
              'unexpected',
              path,
              `${key}: detail states absence ("${detail}") while status is "pass". This is the exact slice-001 defect.`,
            )
          : finding('P-03', '001', 'expected', path, `${key}: absence is stated and the status is "${status}", not "pass".`),
      );
      continue;
    }

    // P-04 — a `pass` must carry the corrected presence wording naming the denominator.
    if (status === 'pass') {
      findings.push(
        PRESENCE_DETAIL.test(detail)
          ? finding('P-04', '001', 'expected', path, `${key}: passes with an observed detail naming the pages read ("${detail}").`)
          : finding(
              'P-04',
              '001',
              'unexpected',
              path,
              `${key}: status "pass" with a detail that does not name the pages read ("${detail}"). `
                + 'A pass must state what was observed and over how many pages.',
            ),
      );
      continue;
    }

    // P-05 — mass-abstention regression guard. The seven score 0 rather than abstaining when
    // pages were read; `not_evaluable` there would mean the fix degenerated into silence.
    if (status === 'not_evaluable' && (pagesEvaluated ?? 0) > 0) {
      findings.push(
        finding(
          'P-05',
          '001',
          'unexpected',
          path,
          `${key}: abstains ("not_evaluable") although ${pagesEvaluated} page(s) were read. `
            + 'Slice 001 requires the seven to state absence, not to stop answering.',
        ),
      );
      continue;
    }

    findings.push(
      finding('P-06', '001', 'expected', path, `${key}: status "${status}" with detail "${detail}" — no presence claim without an observation.`),
    );
  }

  return findings;
}

/** The renderer HTML-escapes; the checks below read prose, so entities are resolved first. */
export function decodeEntities(html: string): string {
  return html
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&mdash;|&#8212;/g, '—')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&');
}

function sliceRow(decoded: string, label: string): string | null {
  const start = decoded.indexOf(label);
  if (start < 0) return null;
  const end = decoded.indexOf('</dd>', start);
  return end > start ? decoded.slice(start, end) : decoded.slice(start);
}

/**
 * Slice 001, customer-visible layer — a check that did not pass may not render as "Observed".
 *
 * The renderer maps `pass -> Observed`, so this is the last point at which the false positive
 * could reappear. The row is sliced from its label to the first `</dd>` after it, exactly as the
 * merged contract test does, so an "Observed" belonging to the NEXT row is never attributed here.
 */
export function assertRenderedPresenceRows(artifact: Report1Artifact, html: string): Report1Finding[] {
  const located = locate(artifact, 'website_checks');
  if (!located || !isObject(located.value)) {
    return [
      finding('P-H0', '001', 'surface_absent', '$.website_checks', 'No website_checks surface, so the rendered rows cannot be cross-checked against it.'),
    ];
  }
  const decoded = decodeEntities(html);
  const findings: Report1Finding[] = [
    decoded.includes(FABRICATED_DETAIL)
      ? finding('P-H1', '001', 'unexpected', '$(html)', `The rendered document contains "${FABRICATED_DETAIL}".`)
      : finding('P-H1', '001', 'expected', '$(html)', `The rendered document contains no "${FABRICATED_DETAIL}".`),
  ];

  const byKey = new Map(
    collectChecks(located)
      .filter(({ check }) => typeof check.key === 'string')
      .map(({ check, path }) => [check.key as string, { check, path }]),
  );

  let judged = 0;
  for (const key of GOVERNED_PRESENCE_CHECKS) {
    const entry = byKey.get(key);
    if (!entry) continue;
    const label = GOVERNED_PRESENCE_LABELS[key];
    const row = sliceRow(decoded, label);
    if (row === null) {
      findings.push(
        finding('P-H2', '001', 'not_observed', '$(html)', `"${label}" is in the payload but was not found in the rendered document, so its rendering was not observed.`),
      );
      continue;
    }
    judged += 1;
    const claimsObserved = row.includes('Observed');
    const passed = String(entry.check.status ?? '') === 'pass';
    if (claimsObserved && !passed) {
      findings.push(finding('P-H3', '001', 'unexpected', '$(html)', `"${label}" renders as Observed while the payload status is "${String(entry.check.status)}".`));
    } else if (!claimsObserved && passed) {
      findings.push(
        finding('P-H4', '001', 'unexpected', '$(html)', `"${label}" passed in the payload but does not render as Observed — the rendered row understates an observation that was made.`),
      );
    } else {
      findings.push(
        finding('P-H5', '001', 'expected', '$(html)', `"${label}" renders ${claimsObserved ? 'as Observed' : 'without an Observed claim'}, matching payload status "${String(entry.check.status)}".`),
      );
    }
  }
  if (judged === 0) {
    findings.push(finding('P-H6', '001', 'not_observed', '$(html)', 'No governed presence row was located in the rendered document. Rendering behaviour was not observed.'));
  }
  return findings;
}

// ── Slice 002 — provenance boundary ──────────────────────────────────────────

/**
 * The evidence-source vocabulary this module recognises in a `sources` array.
 *
 * It is typed as `EvidenceSourceKind[]`, so a rename upstream breaks the build here rather than
 * silently narrowing the scan. Which of these are private is NOT restated: it is derived from
 * `isReport1Source`, keeping `evidenceProvenance.ts` the single authority.
 */
const KNOWN_SOURCE_KINDS: readonly EvidenceSourceKind[] = [
  'crawler', 'gsc', 'decisions', 'public_audit', 'competitor_intelligence', 'serp',
  'social_links', 'heuristic', 'wikidata', 'google_kg', 'schema_org', 'llm_probe',
  'answer_engine', 'ads_transparency', 'backlink_api', 'review_aggregator',
  'expertise_extractor', 'benchmark_dataset', 'trajectory_history', 'company_declared',
  'platform_activity', 'unspecified',
];

const KNOWN_SOURCE_SET = new Set<string>(KNOWN_SOURCE_KINDS);

/** Source kinds Report 1 may never assert on, derived rather than restated. */
export const PRIVATE_SOURCE_KINDS: readonly EvidenceSourceKind[] =
  KNOWN_SOURCE_KINDS.filter((kind) => !isReport1Source(kind));

/**
 * Subtrees where a PRIVATE provenance literal is CORRECT and must not be flagged.
 *
 * `excluded` / `excludedSources` are the exclusion record itself — the mechanism working. And
 * `company_identity` is GAP-08: declared identity shown to the customer AS declared, with its
 * provenance printed beside it. Slice 002 governs what Report 1 ASSERTS ON, not whether the word
 * COMPANY_CONFIRMED may appear as a label on a value the report explicitly calls declared.
 *
 * This exemption is the single most important line in this scan. Without it a whole-artifact
 * string search reports a violation on every healthy report, and a validation that always fails
 * teaches its reader to ignore it.
 */
const PRIVATE_PROVENANCE_EXEMPT_KEYS = new Set(['excluded', 'excludedSources', 'company_identity']);

/** Slice 002 — Report 1 may carry only PUBLIC_OBSERVED / INFERRED / ESTIMATED / UNAVAILABLE. */
export function assertProvenanceBoundary(artifact: Report1Artifact): Report1Finding[] {
  const findings: Report1Finding[] = [];
  const privateClassHits: Array<{ path: string; value: string }> = [];
  const privateSourceHits: Array<{ path: string; value: string }> = [];
  const badClassHits: Array<{ path: string; value: string }> = [];
  const contradictions: Array<{ path: string }> = [];
  let verdicts = 0;
  let exclusionRecords = 0;
  /** Evidence sources of ANY kind seen. Zero means the scan had nothing to judge. */
  let sourcesSeen = 0;

  walk(artifact, (value, path, key) => {
    if (key !== null && PRIVATE_PROVENANCE_EXEMPT_KEYS.has(key)) {
      if (key === 'excludedSources' && Array.isArray(value) && value.length > 0) exclusionRecords += 1;
      return false; // documented exemption — see PRIVATE_PROVENANCE_EXEMPT_KEYS
    }

    // A provenance verdict object: { classes, excluded, excludedSources, report1Clean }.
    //
    // The descent STOPS here. Its `classes` are judged below against the Report 1 set, and
    // descending would re-report each private class a second time as a bare literal — the same
    // violation counted twice, under two check ids, from one cause.
    if (isObject(value) && Array.isArray(value.classes) && 'report1Clean' in value) {
      verdicts += 1;
      for (const cls of value.classes) {
        if (typeof cls === 'string' && !REPORT1_PROVENANCE.has(cls as EvidenceProvenanceClass)) {
          badClassHits.push({ path: `${path}.classes`, value: cls });
        }
      }
      const excluded = Array.isArray(value.excludedSources) ? value.excludedSources : [];
      if (excluded.length > 0) exclusionRecords += 1;
      if (value.report1Clean === false && excluded.length === 0) contradictions.push({ path });
      return false;
    }

    // A bare provenance literal anywhere else.
    if (typeof value === 'string' && PRIVATE_PROVENANCE.has(value as EvidenceProvenanceClass)) {
      privateClassHits.push({ path, value });
      return undefined;
    }

    // A retained evidence-source reference.
    if (key === 'source' && typeof value === 'string' && KNOWN_SOURCE_SET.has(value)) {
      sourcesSeen += 1;
      if (!isReport1Source(value as EvidenceSourceKind)) privateSourceHits.push({ path, value });
      return undefined;
    }
    if (key === 'sources' && Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item !== 'string' || !KNOWN_SOURCE_SET.has(item)) return;
        sourcesSeen += 1;
        if (!isReport1Source(item as EvidenceSourceKind)) privateSourceHits.push({ path: `${path}[${i}]`, value: item });
      });
      return false;
    }
    return undefined;
  });

  /**
   * Nothing to judge. An artifact carrying no verdict and no evidence source at all has not
   * demonstrated a clean boundary — it has demonstrated nothing, and saying "expected" here
   * would hand the later gate a vacuous pass.
   */
  const nothingToScan = verdicts === 0 && sourcesSeen === 0;
  if (nothingToScan) {
    return [
      finding(
        'V-00',
        '002',
        'surface_absent',
        '$',
        'The artifact carries no provenance verdict and no evidence source of any kind, so the provenance boundary was not scanned. '
          + 'This is not a clean result — there was nothing to judge.',
      ),
    ];
  }

  findings.push(
    privateClassHits.length > 0
      ? finding(
          'V-01',
          '002',
          'unexpected',
          privateClassHits[0].path,
          `${privateClassHits.length} private provenance literal(s) outside the exclusion record and the declared-identity section. `
            + `First: ${privateClassHits[0].value} at ${privateClassHits[0].path}.`,
        )
      : finding(
          'V-01',
          '002',
          'expected',
          '$',
          'No COMPANY_CONFIRMED / OMNIVYRA_OBSERVED / CONNECTED_SOURCE literal is asserted anywhere outside the exclusion record and the declared-identity section.',
        ),
  );

  findings.push(
    badClassHits.length > 0
      ? finding('V-02', '002', 'unexpected', badClassHits[0].path, `A provenance verdict retains a class outside the Report 1 set: ${badClassHits.map((h) => h.value).join(', ')}.`)
      : verdicts === 0
        ? finding(
            'V-02',
            '002',
            'not_observed',
            '$',
            'The artifact carries no provenance verdict at all, so the boundary was not exercised on this report. Absence of a verdict is NOT a clean verdict.',
          )
        : finding('V-02', '002', 'expected', '$', `All ${verdicts} provenance verdict(s) retain only PUBLIC_OBSERVED / INFERRED / ESTIMATED / UNAVAILABLE.`),
  );

  findings.push(
    privateSourceHits.length > 0
      ? finding(
          'V-03',
          '002',
          'unexpected',
          privateSourceHits[0].path,
          `${privateSourceHits.length} retained evidence source(s) are not Report 1 eligible. First: "${privateSourceHits[0].value}" at ${privateSourceHits[0].path}.`,
        )
      : finding('V-03', '002', 'expected', '$', `No retained evidence source is private (searched for: ${PRIVATE_SOURCE_KINDS.join(', ')}).`),
  );

  findings.push(
    contradictions.length > 0
      ? finding('V-04', '002', 'unexpected', contradictions[0].path, `${contradictions.length} verdict(s) report report1Clean=false with an empty exclusion list — the verdict contradicts its own record.`)
      : exclusionRecords > 0
        ? finding(
            'V-04',
            '002',
            'expected',
            '$',
            `${exclusionRecords} exclusion record(s) present: private evidence was recognised and set aside rather than dropped. This is the mechanism working, not a defect.`,
          )
        : finding(
            'V-04',
            '002',
            'not_observed',
            '$',
            'No exclusion ever fired on this report, so the exclusion path itself was not observed. A tenant whose profile carries declared data is needed to exercise it.',
          ),
  );

  return findings;
}

// ── Slice 003 — competitive baseline integrity ───────────────────────────────

/** The three dimensions no page crawl can establish. They must be null, never 0. */
const UNCRAWLABLE_DIMENSIONS = ['publishing_frequency', 'engagement_score', 'geo_presence'] as const;
const CRAWLABLE_DIMENSIONS = ['content_depth', 'authority_score', 'seo_coverage', 'aeo_readiness'] as const;

type Metrics = Record<string, unknown>;

/**
 * Slice 003 — a gap needs two observed sides; the synthesized company baseline is gone; and a
 * `null` must never become a zero.
 */
export function assertCompetitiveBaselineIntegrity(artifact: Report1Artifact): Report1Finding[] {
  const located = locate(artifact, 'competitor_intelligence');
  if (!located || !isObject(located.value)) {
    return [
      finding('C-00', '003', 'surface_absent', '$.competitor_intelligence', 'No competitor_intelligence surface. Competitive baseline integrity was NOT observed.'),
    ];
  }

  const findings: Report1Finding[] = [];
  const comparison = isObject(located.value.comparison) ? located.value.comparison : null;
  const companyMetrics = comparison && isObject(comparison.company) ? (comparison.company as Metrics) : null;
  const companySupported = companyMetrics !== null;
  const entries = comparison && Array.isArray(comparison.competitors) ? comparison.competitors : [];
  const gaps = Array.isArray(located.value.generated_gaps) ? located.value.generated_gaps : [];

  // C-01 — the fabricated seven-dimension company baseline.
  if (!companySupported) {
    findings.push(
      finding(
        'C-01',
        '003',
        'expected',
        `${located.path}.comparison.company`,
        'The company baseline is null. The synthesized constant-plus-penalty baseline REMEDIATION-003 deleted did not return.',
      ),
    );
  } else {
    const metricsShaped = CRAWLABLE_DIMENSIONS.every((d) => typeof companyMetrics[d] === 'number');
    findings.push(
      finding(
        'C-01',
        '003',
        metricsShaped ? 'not_observed' : 'unexpected',
        `${located.path}.comparison.company`,
        metricsShaped
          ? 'A company baseline is present. Slice 003 forbids a SYNTHESIZED baseline, not a baseline as such, and the artifact alone cannot tell the two apart. '
            + 'Record this and trace its producer by hand before calling it expected or unexpected.'
          : 'A company baseline object is present but is not shaped like ComparisonMetrics. Inspect it by hand.',
      ),
    );
  }

  // C-02..C-05 — per competitor.
  const zeroedUncrawlable: string[] = [];
  const mirrored: string[] = [];
  let judgedEntries = 0;
  entries.forEach((entry, i) => {
    if (!isObject(entry)) return;
    const path = `${located.path}.comparison.competitors[${i}]`;
    const metrics = isObject(entry.metrics) ? (entry.metrics as Metrics) : null;
    const state = String(entry.metrics_state ?? '');

    if (state === 'unavailable' && metrics !== null) {
      findings.push(
        finding('C-03', '003', 'unexpected', path, 'metrics_state is "unavailable" yet metrics is an object. An unobserved competitor must carry null, not a filled shape.'),
      );
      return;
    }
    if (metrics === null) return;
    judgedEntries += 1;

    for (const dim of UNCRAWLABLE_DIMENSIONS) {
      const v = metrics[dim];
      if (v === 0) zeroedUncrawlable.push(`${path}.metrics.${dim}`);
      else if (typeof v === 'number' && companySupported && companyMetrics[dim] === v) mirrored.push(`${path}.metrics.${dim}`);
    }

    // C-04 — a delta requires BOTH sides. `null - x` is not a type error in this project.
    const deltas = isObject(entry.deltas_vs_company) ? (entry.deltas_vs_company as Metrics) : null;
    if (!deltas) return;
    for (const dim of [...CRAWLABLE_DIMENSIONS, ...UNCRAWLABLE_DIMENSIONS]) {
      const d = deltas[dim];
      if (typeof d !== 'number') continue;
      const left = metrics[dim];
      const right = companySupported ? companyMetrics[dim] : null;
      if (typeof left !== 'number' || typeof right !== 'number') {
        findings.push(
          finding(
            'C-04',
            '003',
            'unexpected',
            `${path}.deltas_vs_company.${dim}`,
            `A numeric delta (${d}) exists where one side is not observed (competitor=${JSON.stringify(left)}, company=${JSON.stringify(right)}). `
              + 'This is the null-coerced-to-zero defect.',
          ),
        );
      } else if (d !== left - right) {
        findings.push(
          finding('C-04', '003', 'unexpected', `${path}.deltas_vs_company.${dim}`, `Delta ${d} does not equal competitor ${left} minus company ${right}.`),
        );
      }
    }
  });

  findings.push(
    zeroedUncrawlable.length > 0
      ? finding('C-02', '003', 'unexpected', zeroedUncrawlable[0], `${zeroedUncrawlable.length} uncrawlable dimension(s) carry 0 instead of null. Zero is a measurement; these were never observed.`)
      : judgedEntries === 0
        ? finding(
            'C-02',
            '003',
            'not_observed',
            `${located.path}.comparison.competitors`,
            `No competitor carried metrics on this report (${entries.length} entry/entries present), so null-versus-zero was not exercised.`,
          )
        : finding(
            'C-02',
            '003',
            'expected',
            `${located.path}.comparison.competitors`,
            `Across ${judgedEntries} observed competitor(s), publishing_frequency / engagement_score / geo_presence are null rather than 0.`,
          ),
  );

  findings.push(
    mirrored.length > 0
      ? finding('C-05', '003', 'unexpected', mirrored[0], `${mirrored.length} competitor value(s) equal the company's on a dimension a crawl cannot establish — the mirroring REMEDIATION-003 removed.`)
      : finding('C-05', '003', 'expected', `${located.path}.comparison`, 'No competitor mirrors the company baseline on an uncrawlable dimension.'),
  );

  /**
   * C-07 — the WP-12 null-baseline delta scenario, observed at the artifact.
   *
   * THE SCENARIO this check exists for:
   *   1. the company baseline is unavailable / null — which, after slice 003, it ALWAYS is;
   *   2. a competitor crawl SUCCEEDS;
   *   3. that competitor therefore HAS metrics;
   *   4. delta / comparison processing runs over both;
   *   5. Report 1 generation completes.
   *
   * At 3d643f5c both delta call sites in `reportCompetitorIntelligenceServiceEngine` guarded only
   * the competitor side — `resolution.metrics ? subtractMetrics(resolution.metrics, companyMetrics) : null`
   * — while `subtractMetrics` dereferences its RIGHT operand. Step 4 therefore threw a TypeError
   * for every successfully crawled competitor, and only for those: a failed crawl yields null
   * metrics and short-circuits. WP-12 fixed both call sites.
   *
   * This is the POSITIVE form of the scenario: it confirms step 5 by confirming steps 1–4 left the
   * right trace. C-04 catches the opposite failure — a delta computed anyway.
   *
   * NOTE ON WHAT ABSENCE MEANS HERE: if the TypeError does occur, this check never runs, because
   * the whole `competitor_intelligence` surface (indeed the whole composed report) is missing.
   * See {@link assertReport1PayloadPresent}, which detects that fingerprint.
   */
  const crawledWithMetrics = entries.filter(
    (e) => isObject(e) && isObject(e.metrics) && String(e.metrics_state ?? '') !== 'unavailable',
  );
  if (!companySupported && crawledWithMetrics.length > 0) {
    const nonNullDeltas = crawledWithMetrics.filter((e) => isObject(e) && e.deltas_vs_company != null);
    findings.push(
      nonNullDeltas.length > 0
        ? finding(
            'C-07',
            '003',
            'unexpected',
            `${located.path}.comparison.competitors`,
            `${nonNullDeltas.length} of ${crawledWithMetrics.length} successfully crawled competitor(s) carry a non-null deltas_vs_company against a NULL company baseline. `
              + 'A delta cannot exist when one side was never observed.',
          )
        : finding(
            'C-07',
            '003',
            'expected',
            `${located.path}.comparison.competitors`,
            `THE WP-12 SCENARIO IS OBSERVED AND HELD: the company baseline is null, ${crawledWithMetrics.length} competitor crawl(s) succeeded and carry metrics, `
              + 'delta processing ran, every delta is null, and the report completed carrying this section. '
              + 'The one-sided-guard TypeError did not occur on this run.',
          ),
    );
  } else {
    findings.push(
      finding(
        'C-07',
        '003',
        'not_observed',
        `${located.path}.comparison.competitors`,
        companySupported
          ? 'The company baseline is non-null on this report, so the null-baseline delta path was not exercised.'
          : 'No competitor crawl succeeded, so no competitor carried metrics and the null-baseline delta path was not exercised. '
            + 'This is the single most important scenario to re-run on a subject with at least one crawlable competitor.',
      ),
    );
  }

  // C-06 — no gap without two observed sides.
  if (!companySupported && gaps.length > 0) {
    findings.push(finding('C-06', '003', 'unexpected', `${located.path}.generated_gaps`, `${gaps.length} gap(s) were published with no company baseline to compare against.`));
  } else if (gaps.length === 0) {
    findings.push(
      finding(
        'C-06',
        '003',
        companySupported ? 'not_observed' : 'expected',
        `${located.path}.generated_gaps`,
        companySupported
          ? 'No gaps were produced, so the two-sided-gap rule was not exercised on this report.'
          : 'No company baseline and no gaps: the competitor value was not republished as the gap.',
      ),
    );
  } else {
    findings.push(
      finding('C-06', '003', 'expected', `${located.path}.generated_gaps`, `${gaps.length} gap(s) exist and a company baseline exists, so each comparison had two sides.`),
    );
  }

  return findings;
}

// ── Slices 004 + 005 — conversion decision and dependency ────────────────────

const DEMAND_GENERATION_IDS = new Set([
  'content_search_foundation',
  'metadata_clickthrough',
  'advertising_conversion_posture',
  'paid_acquisition_consideration',
]);
const CONVERSION_ID = 'conversion_readiness';

type Opportunity = Record<string, unknown>;

/**
 * Slices 004 and 005 — conversion remediation outranks demand generation, and `dependsOn`
 * survives to the customer-visible plan.
 */
export function assertConversionDecisionIntegrity(artifact: Report1Artifact): Report1Finding[] {
  const located = locate(artifact, 'digital_snapshot');
  if (!located || !isObject(located.value)) {
    // Both slices are reported, so a summary can never omit slice 005 simply because the surface
    // that carries it was missing. A slice absent from the findings reads as a slice with no
    // problems; every slice this function governs must therefore appear.
    return [
      finding('D-00', '004', 'surface_absent', '$.digital_snapshot', 'No digital_snapshot surface. Conversion decision integrity was NOT observed.'),
      finding('D-00b', '005', 'surface_absent', '$.digital_snapshot', 'No digital_snapshot surface, so the conversion dependency could not reach a plan and was NOT observed.'),
    ];
  }

  const findings: Report1Finding[] = [];
  const snapshot = located.value;
  const opportunities = Array.isArray(snapshot.opportunities) ? (snapshot.opportunities as Opportunity[]) : [];
  const topPriorities = Array.isArray(snapshot.topPriorities) ? (snapshot.topPriorities as Opportunity[]) : [];
  const plan = isObject(snapshot.plan) ? snapshot.plan : null;
  const planItems: Array<{ item: Record<string, unknown>; path: string }> = [];
  for (const horizon of ['days_0_30', 'days_31_60', 'days_61_90']) {
    const bucket = plan && Array.isArray(plan[horizon]) ? (plan[horizon] as unknown[]) : [];
    bucket.forEach((item, i) => {
      if (isObject(item)) planItems.push({ item, path: `${located.path}.plan.${horizon}[${i}]` });
    });
  }

  const convIndex = opportunities.findIndex((o) => o.id === CONVERSION_ID);
  const conv = convIndex >= 0 ? opportunities[convIndex] : null;

  if (!conv) {
    findings.push(
      finding(
        'D-01',
        '004',
        'not_observed',
        `${located.path}.opportunities`,
        'No conversion_readiness opportunity was raised on this report, so the sequencing rule was not exercised. This is neither a pass nor a failure of slice 004.',
      ),
    );
  } else {
    // D-01 — ordering, by position AND by priorityScore.
    const outrankers = opportunities.filter(
      (o, i) => DEMAND_GENERATION_IDS.has(String(o.id)) && (i < convIndex || Number(o.priorityScore) >= Number(conv.priorityScore)),
    );
    findings.push(
      outrankers.length > 0
        ? finding(
            'D-01',
            '004',
            'unexpected',
            `${located.path}.opportunities`,
            `${outrankers.length} demand-generation item(s) rank at or above conversion remediation: `
              + `${outrankers.map((o) => `${String(o.id)}(score ${String(o.priorityScore)})`).join(', ')} `
              + `vs conversion_readiness(score ${String(conv.priorityScore)}).`,
          )
        : finding(
            'D-01',
            '004',
            'expected',
            `${located.path}.opportunities`,
            `conversion_readiness is at index ${convIndex} with priorityScore ${String(conv.priorityScore)}; every demand-generation item is ordered behind it and scores below it.`,
          ),
    );

    // D-02 — demand generation is sequenced, not suppressed.
    const demand = opportunities.filter((o) => DEMAND_GENERATION_IDS.has(String(o.id)));
    findings.push(
      demand.length === 0
        ? finding('D-02', '004', 'not_observed', `${located.path}.opportunities`, 'No demand-generation opportunity accompanied the conversion remediation, so "sequenced, not suppressed" was not exercised.')
        : demand.every((o) => String(o.action ?? '').length > 0 && Array.isArray(o.evidence) && (o.evidence as unknown[]).length > 0)
          ? finding('D-02', '004', 'expected', `${located.path}.opportunities`, `${demand.length} demand-generation item(s) survive with their evidence and action intact — they were re-sequenced, not removed.`)
          : finding('D-02', '004', 'unexpected', `${located.path}.opportunities`, 'A demand-generation item lost its evidence or its action. Slice 004 re-sequences; it never strips.'),
    );

    // D-03 — the conversion item admits the public-evidence boundary.
    findings.push(
      /NOT measurable from public evidence/i.test(String(conv.measurement ?? ''))
        ? finding('D-03', '004', 'expected', `${located.path}.opportunities[${convIndex}].measurement`, 'The conversion remediation states that its outcome is not measurable from public evidence.')
        : finding('D-03', '004', 'unexpected', `${located.path}.opportunities[${convIndex}].measurement`, `The conversion remediation claims a measurement it cannot make: "${String(conv.measurement)}".`),
    );

    // D-04 — the headline ordering.
    findings.push(
      topPriorities.length === 0
        ? finding('D-04', '004', 'not_observed', `${located.path}.topPriorities`, 'topPriorities is empty, so the headline ordering was not observed.')
        : String(topPriorities[0].id) === CONVERSION_ID
          ? finding('D-04', '004', 'expected', `${located.path}.topPriorities[0]`, 'Conversion remediation leads the top priorities.')
          : finding('D-04', '004', 'unexpected', `${located.path}.topPriorities[0]`, `The top priority is "${String(topPriorities[0].id)}" while a conversion remediation exists.`),
    );
  }

  // D-05 — dependsOn survives to the plan, and only where it is earned (slice 005).
  const dependent = planItems.filter(({ item }) => item.dependsOn !== undefined && item.dependsOn !== null);
  if (!conv) {
    findings.push(
      dependent.length === 0
        ? finding('D-05', '005', 'expected', `${located.path}.plan`, 'No conversion remediation and no plan item carries dependsOn — no dependency was invented.')
        : finding('D-05', '005', 'unexpected', `${dependent[0].path}.dependsOn`, `${dependent.length} plan item(s) declare a dependency although no conversion_readiness opportunity exists.`),
    );
  } else {
    const wrong = dependent.filter(({ item }) => String(item.dependsOn) !== CONVERSION_ID);
    findings.push(
      dependent.length === 0
        ? finding(
            'D-05',
            '005',
            'not_observed',
            `${located.path}.plan`,
            'A conversion remediation exists but no plan item carries dependsOn. Either no demand-generation work reached the plan, or the dependency was lost between the opportunity and the plan — '
              + 'distinguish these by inspecting digital_snapshot.opportunities before judging.',
          )
        : wrong.length > 0
          ? finding('D-05', '005', 'unexpected', `${wrong[0].path}.dependsOn`, `${wrong.length} plan item(s) depend on something other than conversion_readiness: ${wrong.map(({ item }) => String(item.dependsOn)).join(', ')}.`)
          : finding('D-05', '005', 'expected', `${located.path}.plan`, `${dependent.length} plan item(s) carry dependsOn="conversion_readiness" — the dependency survived to the customer-visible plan.`),
    );
  }

  // D-07 — the decision layer never describes visitor behaviour it cannot observe.
  const blob = JSON.stringify(snapshot);
  const visitorClaims = blob.match(/conversion rate|\bsessions\b|\bvisitors\b|\bbounce rate\b|\bCRM\b/gi) ?? [];
  findings.push(
    visitorClaims.length > 0
      ? finding('D-07', '004', 'unexpected', located.path, `The decision layer uses private-analytics language it cannot observe: ${[...new Set(visitorClaims)].join(', ')}.`)
      : finding('D-07', '004', 'expected', located.path, 'The decision layer claims no conversion rate, session, visitor, bounce-rate or CRM figure.'),
  );

  return findings;
}

// ── Slices 006 + 007 — advertising integration and safety ────────────────────

/**
 * The renderer's own disclaimer. It CONTAINS the phrase "does not advertise" because it is the
 * negation of that claim, so it is removed before the affirmative-absence scan runs. Scanning
 * without this step reports the guard itself as the violation.
 */
const ADS_DISCLAIMER = 'This is not a finding that the company does not advertise.';

/** Affirmative claims of absence. None of these may ever appear. */
const AFFIRMATIVE_ABSENCE =
  /\bno ads are being run\b|\bthe company is not advertising\b|\bruns no advertising\b|\bruns no ads\b|\bdoes not advertise\b|\bis not advertising\b|\bno paid activity exists\b/gi;

/** Performance figures the Ads Transparency record cannot establish. */
const PERFORMANCE_CLAIM = /\bCTR\b|\bROAS\b|\bCAC\b|impressions|click-through|conversion rate|ad spend|cost per|\brevenue\b/gi;

/** Internal resolution enum names that must never reach a reader. */
const INTERNAL_ENUMS = /PROBABLE_MATCH|NOT_MATCHED|INSUFFICIENT_EVIDENCE|UNRESOLVED|eligibleForCompanyClaim/g;

/** Slice 006 — the ads read seam reached the customer, with its provenance intact. */
export function assertAdvertisingIntegration(artifact: Report1Artifact): Report1Finding[] {
  const located = locate(artifact, 'advertising');
  if (!located || !isObject(located.value)) {
    return [
      finding(
        'A-00',
        '006',
        'surface_absent',
        '$.advertising',
        'No advertising surface in the artifact. This means no ads observation was stored for this company+domain. '
          + 'It is NOT a finding that the company does not advertise, and NOT evidence that the read seam is broken: the seam is only observed on a tenant for which an observation exists.',
      ),
    ];
  }

  const ads = located.value;
  const findings: Report1Finding[] = [];

  findings.push(
    ads.provenance === 'PUBLIC_OBSERVED' && ads.source === 'ads_transparency'
      ? finding('A-01', '006', 'expected', located.path, 'The advertising surface reached the report as PUBLIC_OBSERVED from ads_transparency.')
      : finding('A-01', '006', 'unexpected', located.path, `The advertising surface carries provenance="${String(ads.provenance)}" source="${String(ads.source)}"; slice 006 requires PUBLIC_OBSERVED / ads_transparency.`),
  );

  const observedAt = typeof ads.observedAt === 'string' ? ads.observedAt : null;
  findings.push(
    observedAt && !Number.isNaN(Date.parse(observedAt))
      ? finding('A-02', '006', 'expected', `${located.path}.observedAt`, `The observation carries its own timestamp (${observedAt}) and vantage (${String(ads.vantage)}), so its age can be weighed.`)
      : finding('A-02', '006', 'unexpected', `${located.path}.observedAt`, 'The advertising surface reached the report without a parseable observation timestamp.'),
  );

  const company = Array.isArray(ads.companyAdvertisers) ? (ads.companyAdvertisers as Array<Record<string, unknown>>) : [];
  const other = Array.isArray(ads.otherAdvertisers) ? (ads.otherAdvertisers as Array<Record<string, unknown>>) : [];
  const counts = isObject(ads.counts) ? ads.counts : {};

  const misattributed = company.filter((a) => String(a.resolutionState) !== 'MATCHED');
  findings.push(
    misattributed.length > 0
      ? finding(
          'A-03',
          '006',
          'unexpected',
          `${located.path}.companyAdvertisers`,
          `${misattributed.length} advertiser(s) are attributed to the company without a MATCHED resolution: ${misattributed.map((a) => `${String(a.advertiserId)}=${String(a.resolutionState)}`).join(', ')}.`,
        )
      : company.length === 0
        ? finding('A-03', '006', 'not_observed', `${located.path}.companyAdvertisers`, `No advertiser resolved to the subject (${other.length} other advertiser(s) discovered), so company attribution was not exercised.`)
        : finding('A-03', '006', 'expected', `${located.path}.companyAdvertisers`, `All ${company.length} attributed advertiser(s) resolved as MATCHED.`),
  );

  findings.push(
    Number(counts.matchedAdvertiserAccounts) === company.length
      ? finding('A-04', '006', 'expected', `${located.path}.counts`, `matchedAdvertiserAccounts (${String(counts.matchedAdvertiserAccounts)}) equals the attributed advertiser count.`)
      : finding('A-04', '006', 'unexpected', `${located.path}.counts`, `matchedAdvertiserAccounts is ${String(counts.matchedAdvertiserAccounts)} but companyAdvertisers holds ${company.length}.`),
  );

  findings.push(
    ads.subjectLegalNameUsed === null && company.length > 0
      ? finding('A-05', '006', 'unexpected', `${located.path}.subjectLegalNameUsed`, 'Advertisers are attributed to the subject although no legal name was used, which makes MATCHED structurally unreachable.')
      : finding('A-05', '006', 'expected', `${located.path}.subjectLegalNameUsed`, `subjectLegalNameUsed=${JSON.stringify(ads.subjectLegalNameUsed)} is consistent with ${company.length} attributed advertiser(s).`),
  );

  // A-06 — provider labels are carried verbatim, never re-derived into a number.
  const numericCounts = [
    ...company.map((a, i) => ({ v: a.adCountLabel, p: `${located.path}.companyAdvertisers[${i}].adCountLabel` })),
    ...other.map((a, i) => ({ v: a.adCountLabel, p: `${located.path}.otherAdvertisers[${i}].adCountLabel` })),
    { v: (counts as Record<string, unknown>).domainAdCountLabel, p: `${located.path}.counts.domainAdCountLabel` },
  ].filter(({ v }) => typeof v === 'number');
  findings.push(
    numericCounts.length > 0
      ? finding('A-06', '006', 'unexpected', numericCounts[0].p, `${numericCounts.length} ad count(s) were re-derived into integers. The provider states rounded labels ("~40 ads") and they must stay labels.`)
      : finding('A-06', '006', 'expected', located.path, "Every ad count is carried as the provider's own label or null, never as an integer."),
  );

  return findings;
}

/** Slice 007 — advertising safety, over the payload and (optionally) the rendered document. */
export function assertAdvertisingSafety(artifact: Report1Artifact, html?: string): Report1Finding[] {
  const findings: Report1Finding[] = [];
  const ads = locate(artifact, 'advertising');
  const snapshot = locate(artifact, 'digital_snapshot');

  /**
   * With neither surface present there is no advertising statement to be safe or unsafe about.
   * Reporting "the payload never claims the company does not advertise" over an artifact that
   * says nothing at all is a vacuous pass, and a vacuous pass is what this harness exists to
   * refuse.
   */
  if (!ads && !snapshot) {
    return [
      finding(
        'S-00',
        '007',
        'surface_absent',
        '$',
        'Neither an advertising surface nor a decision layer is present, so advertising safety was not scanned. Nothing was observed.',
      ),
    ];
  }

  // S-01 — the payload never affirms that the company does not advertise.
  const payloadBlob = JSON.stringify(artifact).split(ADS_DISCLAIMER).join(' ');
  const payloadAbsence = payloadBlob.match(AFFIRMATIVE_ABSENCE) ?? [];
  findings.push(
    payloadAbsence.length > 0
      ? finding('S-01', '007', 'unexpected', '$', `The payload affirms an absence of advertising: ${[...new Set(payloadAbsence)].join(', ')}.`)
      : finding('S-01', '007', 'expected', '$', 'The payload never claims the company does not advertise.'),
  );

  // S-02 — no performance figures on the advertising surface or its decisions.
  const adsScope = JSON.stringify([ads ? ads.value : null, snapshot ? snapshot.value : null]);
  const perf = adsScope.match(PERFORMANCE_CLAIM) ?? [];
  findings.push(
    perf.length > 0
      ? finding('S-02', '007', 'unexpected', ads ? ads.path : '$.digital_snapshot', `Performance language appears where only a public advertiser record exists: ${[...new Set(perf)].join(', ')}.`)
      : finding('S-02', '007', 'expected', ads ? ads.path : '$', 'No spend, CTR, ROAS, CAC, impressions or revenue claim on the advertising surface or in the decision layer.'),
  );

  // S-03 — an advertising decision requires an advertising observation.
  const snapshotValue = snapshot && isObject(snapshot.value) ? snapshot.value : null;
  const opportunities = snapshotValue && Array.isArray(snapshotValue.opportunities) ? (snapshotValue.opportunities as Opportunity[]) : [];
  const adDecisions = opportunities.filter((o) => o.id === 'advertising_conversion_posture' || o.id === 'paid_acquisition_consideration');
  const accessState = ads && isObject(ads.value) ? String((ads.value as Record<string, unknown>).accessState) : null;

  if (adDecisions.length === 0) {
    findings.push(
      finding(
        'S-03',
        '007',
        'not_observed',
        snapshot ? snapshot.path : '$.digital_snapshot',
        `No advertising decision was raised (advertising accessState=${accessState ?? 'absent'}), so slice 007's decision path was not exercised.`,
      ),
    );
  } else if (accessState !== 'observed') {
    findings.push(
      finding(
        'S-03',
        '007',
        'unexpected',
        snapshot ? snapshot.path : '$.digital_snapshot',
        `${adDecisions.length} advertising decision(s) were raised although accessState is "${accessState ?? 'absent'}". A failed or absent read is not an observation of advertising.`,
      ),
    );
  } else {
    findings.push(finding('S-03', '007', 'expected', snapshot ? snapshot.path : '$', `${adDecisions.length} advertising decision(s) rest on an observed Ads Transparency read.`));
  }

  // S-04 — the consideration branch never lands on day one and never recommends spending.
  const consideration = opportunities.find((o) => o.id === 'paid_acquisition_consideration');
  if (!consideration) {
    findings.push(finding('S-04', '007', 'not_observed', '$.digital_snapshot.opportunities', 'The paid-acquisition consideration branch did not fire on this report.'));
  } else {
    const recommendsSpend = /should start advertising|begin paid|launch campaigns/i.test(String(consideration.action ?? ''));
    const dayOne = String(consideration.horizon) === '0-30';
    findings.push(
      recommendsSpend || dayOne
        ? finding(
            'S-04',
            '007',
            'unexpected',
            '$.digital_snapshot.opportunities',
            `The paid-acquisition consideration ${recommendsSpend ? 'recommends starting to spend' : ''}${recommendsSpend && dayOne ? ' and ' : ''}${dayOne ? 'lands in the 0-30 horizon' : ''}. `
              + 'It is a question to answer, never a change to make on day one.',
          )
        : finding(
            'S-04',
            '007',
            'expected',
            '$.digital_snapshot.opportunities',
            `The paid-acquisition consideration sits at horizon "${String(consideration.horizon)}", confidence "${String(consideration.confidence)}", and recommends no spend.`,
          ),
    );
  }

  if (html === undefined) return findings;

  // S-05..S-07 — the customer-visible document.
  const decoded = decodeEntities(html);
  const withoutDisclaimer = decoded.split(ADS_DISCLAIMER).join(' ');
  const htmlAbsence = withoutDisclaimer.match(AFFIRMATIVE_ABSENCE) ?? [];
  findings.push(
    htmlAbsence.length > 0
      ? finding('S-05', '007', 'unexpected', '$(html)', `The rendered document affirms an absence of advertising: ${[...new Set(htmlAbsence)].join(', ')}.`)
      : finding('S-05', '007', 'expected', '$(html)', 'The rendered document never claims the company does not advertise.'),
  );

  const htmlPerf = decoded.match(PERFORMANCE_CLAIM) ?? [];
  findings.push(
    htmlPerf.length > 0
      ? finding('S-06', '007', 'unexpected', '$(html)', `The rendered document uses performance language: ${[...new Set(htmlPerf)].join(', ')}.`)
      : finding('S-06', '007', 'expected', '$(html)', 'The rendered document claims no spend, CTR, ROAS, CAC, impressions or revenue.'),
  );

  const leaked = decoded.match(INTERNAL_ENUMS) ?? [];
  findings.push(
    leaked.length > 0
      ? finding('S-07', '007', 'unexpected', '$(html)', `Internal resolution identifiers reached the reader: ${[...new Set(leaked)].join(', ')}.`)
      : finding('S-07', '007', 'expected', '$(html)', 'No internal resolution enum name appears in the rendered document.'),
  );

  return findings;
}

// ── Aggregate ────────────────────────────────────────────────────────────────

export type Report1ValidationSummary = {
  total: number;
  expected: number;
  unexpected: number;
  notObserved: number;
  surfaceAbsent: number;
  /** Slices for which at least one behaviour was actually observed and judged. */
  slicesObserved: Report1Slice[];
  /** Slices for which NOTHING was observed. These are not passes; the exercise did not test them. */
  slicesNotObserved: Report1Slice[];
};

/**
 * R-00 — did a Report 1 payload reach the artifact at all, and if not, is this the fingerprint
 * of a THROWN composition rather than a quiet abstention?
 *
 * ─── WHY THIS CHECK IS THE MOST IMPORTANT ONE IN THE MODULE ───────────────────
 * Traced at 3d643f5c (code read, exact sites named so a reader can re-check):
 *
 *   1. `subtractMetrics(metrics, null)` throws a TypeError.
 *      — OBSERVED by execution in `report1NullBaselineDeltaContract.test.ts`.
 *   2. Nothing in `reportCompetitorIntelligenceServiceEngine` catches it.
 *   3. `snapshotReportService.composeSnapshotReport` wraps its body in `try { … } finally { … }`
 *      with NO catch — the `finally` only closes the scan-budget ledger, and its own comment says
 *      the return is "Reachable only when the try completed without throwing".
 *   4. `reportCardServiceAssembly.ts:440` catches it and `console.warn`s it.
 *   5. It rethrows ONLY when `requestedCategory === 'performance'`. Report 1 is `snapshot`,
 *      so it is NOT rethrown.
 *   6. The function returns normally, and `enrichComposedReportWithInputContext` returns
 *      `undefined` for an undefined input (line 207).
 *
 * So a composition failure does NOT crash generation and does NOT degrade one section. The
 * report completes and carries NO Report 1 payload whatsoever, with the only trace a server-side
 * `console.warn`. To a reader — and to a naive validation — that is indistinguishable from a
 * report that simply had nothing to say.
 *
 * That is precisely why `surface_absent` must never be read as a pass, and why this check exists:
 * EVERY surface missing at once is not an uninteresting null result, it is the signature of a
 * thrown composition. One surface missing is an abstention; all of them missing is an incident.
 */
export function assertReport1PayloadPresent(artifact: Report1Artifact): Report1Finding[] {
  const surfaces = ['website_checks', 'digital_snapshot', 'competitor_intelligence', 'advertising'] as const;
  const present = surfaces.filter((s) => locate(artifact, s) !== null);
  const canonical = locate(artifact, 'canonical');

  if (present.length === 0 && canonical === null) {
    return [
      finding(
        'R-00',
        '003',
        'unexpected',
        '$',
        'NO Report 1 payload reached this artifact: no canonical report and none of '
          + `${surfaces.join(', ')}. This is the fingerprint of a THROWN composition, not an abstention — `
          + 'reportCardServiceAssembly catches a compose error, logs it with console.warn, does NOT rethrow for a '
          + 'snapshot, and returns with composed_report undefined, so generation "completes" carrying nothing. '
          + 'Check the generation logs for the warning and its stack before concluding the tenant simply had no data.',
      ),
    ];
  }

  if (canonical === null) {
    return [
      finding(
        'R-00',
        '003',
        'unexpected',
        '$.canonical',
        `The canonical report is absent although ${present.length} Report 1 surface(s) are present (${present.join(', ')}). `
          + 'A partial payload is not a shape composition produces on its own — inspect how this artifact was captured.',
      ),
    ];
  }

  return [
    finding(
      'R-00',
      '003',
      'expected',
      '$',
      `A Report 1 payload is present: canonical plus ${present.length} of ${surfaces.length} surface(s) (${present.join(', ') || 'none'}). `
        + 'Composition therefore ran to completion; any individual surface reported absent below is an abstention, not a crash.',
    ),
  ];
}

export function summarizeReport1Findings(findings: readonly Report1Finding[]): Report1ValidationSummary {
  const observed = new Set<Report1Slice>();
  const seen = new Set<Report1Slice>();
  let expected = 0;
  let unexpected = 0;
  let notObserved = 0;
  let surfaceAbsent = 0;
  for (const f of findings) {
    seen.add(f.slice);
    if (f.status === 'expected') {
      expected += 1;
      observed.add(f.slice);
    } else if (f.status === 'unexpected') {
      unexpected += 1;
      observed.add(f.slice);
    } else if (f.status === 'not_observed') {
      notObserved += 1;
    } else {
      surfaceAbsent += 1;
    }
  }
  return {
    total: findings.length,
    expected,
    unexpected,
    notObserved,
    surfaceAbsent,
    slicesObserved: [...observed].sort(),
    slicesNotObserved: [...seen].filter((s) => !observed.has(s)).sort(),
  };
}

/**
 * Run every offline check.
 *
 * `html` is optional because the rendered document is a SEPARATE capture: a payload can be
 * inspected without it, and saying so is better than pretending the rendered checks ran.
 */
export function validateReport1Artifact(
  artifact: Report1Artifact,
  html?: string,
): { findings: Report1Finding[]; summary: Report1ValidationSummary } {
  const findings = [
    ...assertReport1PayloadPresent(artifact),
    ...assertPresenceCheckIntegrity(artifact),
    ...assertProvenanceBoundary(artifact),
    ...assertCompetitiveBaselineIntegrity(artifact),
    ...assertConversionDecisionIntegrity(artifact),
    ...assertAdvertisingIntegration(artifact),
    ...assertAdvertisingSafety(artifact, html),
    ...(html === undefined ? [] : assertRenderedPresenceRows(artifact, html)),
  ];
  return { findings, summary: summarizeReport1Findings(findings) };
}

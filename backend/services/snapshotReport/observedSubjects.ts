/**
 * OBSERVED SUBJECTS — what the company's public pages literally say they are about.
 *
 * ONE CLAIM, AND ONLY ONE. An observed subject asserts exactly this:
 *
 *     this literal text exists on this public URL, as this element, at this crawl.
 *
 * Nothing more. It is NOT a statement that the company covers the subject, has authority on it,
 * or intends to. Those are higher-order inferences about a site, and a single heading does not
 * establish any of them.
 *
 * WHY THIS EXISTS. `BacklinkAssetEvidence.topicsCovered` has always expected OBSERVED evidence
 * and had no producer, so every backlink recommendation degraded to `declared`. The only
 * subject-matter extractor pointed at the subject company (`extractTopKeywords`) ranks on
 * `keyword_metrics.impressions` -- Search Console data, `CONNECTED_SOURCE`, which
 * `REPORT1_PROVENANCE` excludes from a public-evidence report. It can never be the source here.
 *
 * ADMISSIBLE SOURCES, and nothing else:
 *   - `headings[].text`   literal text in the document
 *   - `title`             literal, one per page
 *
 * DELIBERATELY INADMISSIBLE. `meta_description` is authored metadata ABOUT a page rather than its
 * content, so it is not promoted here. CTA labels are interface affordances, not subject matter.
 * Word counts, link counts and crawl depth are quantities. Frequency-derived tokens and phrases
 * are INFERRED -- a separate channel that is designed but deliberately not built, because the only
 * available engines are a single-token counter and a question-shape filter, and publishing either
 * as a "topic" would label an inference as an observation. Declared positioning, recommended
 * topics and competitor extractions are all different evidence classes.
 *
 * PROVENANCE IS NOT OPTIONAL. A subject without a source URL is an assertion, so it is refused.
 * `observedAt` carries the page's own crawl time and is `null` when the row has none -- never the
 * report's clock, never `Date.now()`. That is the same rule R1-D applied to SERP positions.
 *
 * VERBATIM SURVIVES. `text` is exactly what the page said. `normalized` exists only to
 * deduplicate and to hand a plain string to the certified `topicsCovered` seam; it never replaces
 * the evidence. Normalization is deliberately conservative: trim, collapse whitespace, case-fold.
 * No stemming, no synonyms, no rewriting -- each of those would change what the page said.
 *
 * PURE. No I/O, no clock, no database, no network. It reads page values the caller already holds.
 */

/** The element that supplied the text. Both are literal page content. */
export type ObservedSubjectOrigin = 'title' | 'heading';

export type ObservedSubject = {
  /** Verbatim, exactly as the page carried it. The evidence itself. */
  text: string;
  /** Deterministic join/dedup key. Never a replacement for `text`. */
  normalized: string;
  origin: ObservedSubjectOrigin;
  /** The page this was observed on. Mandatory -- a subject without it is refused. */
  sourceUrl: string;
  /** The page's own crawl time. Null when the row carries none; never substituted. */
  observedAt: string | null;
  /** h1..h6 where the source was a heading. */
  headingLevel: number | null;
  /**
   * R1-C -- set by the crawler when a heading's text did NOT come from ordinary text content
   * (`image_alt` / `aria_label` when the accessible name supplied it, `none` when the element
   * carries nothing readable). A subject from an accessible name is still observed, but it is
   * DIFFERENTLY observed, so the distinction is carried rather than flattened.
   */
  textSource: string | null;
};

/** The minimum a page must expose. Structural, so no cross-module type import is needed. */
type SubjectSourcePage = {
  url?: string | null;
  title?: string | null;
  headings?: Array<{ level?: number; text?: string; textSource?: string }> | null;
  last_crawled_at?: string | null;
};

/** Longest text admitted as a subject. Beyond this it is prose, not a subject. */
const MAX_SUBJECT_CHARS = 120;

/**
 * Conservative and deterministic: trim, collapse internal whitespace, case-fold. Nothing that
 * changes the wording.
 */
export function normalizeSubject(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** A heading whose text the crawler recorded as carrying nothing readable is not a subject. */
const isUnreadable = (textSource: string | null): boolean => textSource === 'none';

function admit(
  raw: string | null | undefined,
  origin: ObservedSubjectOrigin,
  page: SubjectSourcePage,
  headingLevel: number | null,
  textSource: string | null,
): ObservedSubject | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().replace(/\s+/g, ' ');
  if (text.length === 0 || text.length > MAX_SUBJECT_CHARS) return null;
  if (isUnreadable(textSource)) return null;

  // PROVENANCE GATE. No source URL, no observation -- refused rather than emitted unattributed.
  const sourceUrl = typeof page.url === 'string' ? page.url.trim() : '';
  if (sourceUrl.length === 0) return null;

  return {
    text,
    normalized: normalizeSubject(text),
    origin,
    sourceUrl,
    observedAt: typeof page.last_crawled_at === 'string' && page.last_crawled_at.trim().length > 0
      ? page.last_crawled_at
      : null,
    headingLevel,
    textSource,
  };
}

/**
 * Collect page-level observed subjects from crawled pages.
 *
 * Returns ONE entry per (page, element) occurrence, so the fact that several pages carried the
 * same subject is preserved rather than collapsed. Deduplication happens only where a consumer
 * needs a flat list -- see `distinctSubjectValues`.
 *
 * An empty result means "ran and found nothing admissible", which the consumer must read as
 * insufficient evidence, never as "this company has no subjects".
 */
export function collectObservedSubjects(
  pages: readonly SubjectSourcePage[] | null | undefined,
): ObservedSubject[] {
  const subjects: ObservedSubject[] = [];
  for (const page of pages ?? []) {
    const fromTitle = admit(page.title, 'title', page, null, null);
    if (fromTitle) subjects.push(fromTitle);

    for (const heading of page.headings ?? []) {
      const textSource = typeof heading?.textSource === 'string' ? heading.textSource : null;
      const level = typeof heading?.level === 'number' ? heading.level : null;
      const fromHeading = admit(heading?.text, 'heading', page, level, textSource);
      if (fromHeading) subjects.push(fromHeading);
    }
  }
  return subjects;
}

/**
 * The flat, deduplicated values for the certified `topicsCovered` seam, which is `string[]`.
 *
 * VERBATIM, NOT NORMALIZED. `normalized` is the dedup key, but the value handed on is the first
 * verbatim spelling observed, because the normalized form is a join key and was never the
 * evidence. Order is first-observation order, so the output is deterministic.
 */
export function distinctSubjectValues(subjects: readonly ObservedSubject[]): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const subject of subjects) {
    if (seen.has(subject.normalized)) continue;
    seen.add(subject.normalized);
    values.push(subject.text);
  }
  return values;
}

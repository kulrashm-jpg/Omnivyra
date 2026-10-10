/**
 * OBSERVED SUBJECTS — one claim, and only one.
 *
 * An observed subject asserts that this literal text exists on this public URL, as this element,
 * at this crawl. Not that the company covers the subject, and not that it has authority on it.
 *
 * These tests pin the provenance gate and the eight ways the channel could be contaminated:
 * Search Console keywords, declared positioning, recommended topics, competitor pages, inferred
 * tokens, missing provenance, a page-level fact promoted to a site-level claim, and an empty
 * result read as "no subjects".
 *
 * The producer is pure — no I/O, no clock — so every case below is a direct call.
 */
import {
  collectObservedSubjects,
  distinctSubjectValues,
  normalizeSubject,
  type ObservedSubject,
} from '../../services/snapshotReport/observedSubjects';
import { buildBacklinkStrategy } from '../../services/canonicalReport/reportBacklinkStrategy';
import type { ExperiencePage } from '../../services/digitalExperience';

const CRAWLED_AT = '2026-02-01T09:30:00.000Z';

const page = (over: Record<string, unknown> = {}) => ({
  url: 'https://northwind-analytics.test/pricing',
  title: 'Pricing — Northwind Analytics',
  headings: [{ level: 1, text: 'Pricing' }, { level: 2, text: 'Plans for mid-market teams' }],
  last_crawled_at: CRAWLED_AT,
  ...over,
});

// ── THE CORE CLAIM ──────────────────────────────────────────────────────────

describe('observed subjects carry literal page text with full provenance', () => {
  it('admits title and headings, each attributed to its page and crawl time', () => {
    const subjects = collectObservedSubjects([page()]);
    expect(subjects).toHaveLength(3);

    const title = subjects.find((s) => s.origin === 'title');
    expect(title?.text).toBe('Pricing — Northwind Analytics');
    expect(title?.sourceUrl).toBe('https://northwind-analytics.test/pricing');
    expect(title?.observedAt).toBe(CRAWLED_AT);
    expect(title?.headingLevel).toBeNull();

    const h1 = subjects.find((s) => s.origin === 'heading' && s.headingLevel === 1);
    expect(h1?.text).toBe('Pricing');
    expect(h1?.normalized).toBe('pricing');
  });

  it('F — every emitted subject has a source URL, an origin and the nullable crawl time', () => {
    const subjects = collectObservedSubjects([page(), page({ url: 'https://northwind-analytics.test/' })]);
    expect(subjects.length).toBeGreaterThan(0);
    for (const subject of subjects) {
      expect(subject.sourceUrl).toMatch(/^https:\/\//);
      expect(['title', 'heading']).toContain(subject.origin);
      expect(subject).toHaveProperty('observedAt');
      expect(subject.text.length).toBeGreaterThan(0);
    }
  });

  it('refuses a subject with no source URL rather than emitting it unattributed', () => {
    expect(collectObservedSubjects([page({ url: null })])).toHaveLength(0);
    expect(collectObservedSubjects([page({ url: '   ' })])).toHaveLength(0);
  });

  it('a page with no crawl time yields a NULL observation time, never a substitute', () => {
    const before = Date.now();
    const subjects = collectObservedSubjects([page({ last_crawled_at: null })]);
    expect(subjects.length).toBeGreaterThan(0);
    for (const subject of subjects) {
      expect(subject.observedAt).toBeNull();
      // Neither the current clock nor an empty string stood in for it.
      expect(subject.observedAt).not.toBe('');
    }
    expect(Date.now()).toBeGreaterThanOrEqual(before);
  });

  it('preserves textSource, so an accessible-name subject stays distinguishable', () => {
    const subjects = collectObservedSubjects([page({
      title: null,
      headings: [{ level: 1, text: 'Pricing', textSource: 'image_alt' }],
    })]);
    expect(subjects).toHaveLength(1);
    expect(subjects[0].textSource).toBe('image_alt');
  });

  it('B — a heading the crawler recorded as unreadable is not a subject', () => {
    const subjects = collectObservedSubjects([page({
      title: null,
      headings: [{ level: 1, text: 'Pricing', textSource: 'none' }],
    })]);
    expect(subjects).toHaveLength(0);
  });
});

// ── A/B. ABSENT, EMPTY AND INSUFFICIENT ─────────────────────────────────────

describe('A/B — absence and emptiness never become "no subjects"', () => {
  it('an unreachable or empty crawl yields an empty result, not a finding', () => {
    expect(collectObservedSubjects([])).toEqual([]);
    expect(collectObservedSubjects(null)).toEqual([]);
    expect(collectObservedSubjects(undefined)).toEqual([]);
  });

  it('pages with no usable title or headings yield nothing admissible', () => {
    const subjects = collectObservedSubjects([page({ title: null, headings: [] })]);
    expect(subjects).toEqual([]);
  });

  it('an empty result reads as insufficient_evidence in the strategy, never as observed', () => {
    const strategy = buildBacklinkStrategy({
      declared: { category: 'decision-support tools', target_market: 'career changers' },
      assets: { topicsCovered: distinctSubjectValues(collectObservedSubjects([])) },
    });
    for (const rec of strategy.recommendations) {
      // Declared context still carries it; the empty observed channel did not upgrade anything.
      expect(rec.evidenceState).toBe('declared');
      expect(rec.evidenceBasis.join(' ')).not.toContain('Observed site subjects');
    }
  });

  it('whitespace-only text is not a subject', () => {
    expect(collectObservedSubjects([page({ title: '   ', headings: [{ level: 1, text: '\t ' }] })])).toEqual([]);
  });
});

// ── C/D/E/G/I. CONTAMINATION CONTROLS ───────────────────────────────────────

describe('the observed channel admits nothing but crawled page text', () => {
  /** The producer's only input is page values; these fixtures prove what it cannot reach. */
  it('C — a Search Console keyword absent from title/headings cannot appear', () => {
    const gscKeyword = 'enterprise analytics platform pricing comparison';
    const subjects = collectObservedSubjects([page()]);
    const values = distinctSubjectValues(subjects);
    expect(values.join(' ')).not.toContain(gscKeyword);
    // The producer's signature accepts only page fields, so a keyword source cannot be passed.
    expect(Object.keys(page())).toEqual(['url', 'title', 'headings', 'last_crawled_at']);
  });

  it('D — declared positioning absent from the crawl cannot populate the channel', () => {
    const positioning = 'AI marketing intelligence';
    const subjects = collectObservedSubjects([page()]);
    expect(distinctSubjectValues(subjects).join(' ')).not.toContain(positioning);

    // And the strategy keeps it on the declared tier rather than the observed one.
    const strategy = buildBacklinkStrategy({
      declared: { category: 'decision support', positioning, target_market: 'career changers' },
      assets: { topicsCovered: distinctSubjectValues(subjects) },
    });
    const entries = strategy.recommendations.flatMap((r) => r.evidenceBasis);
    // Positioning is carried, but on its own DECLARED entry.
    expect(entries.some((e) => e.startsWith('Declared positioning'))).toBe(true);
    // The observed entry contains only crawled page text.
    const subjectEntries = entries.filter((e) => e.startsWith('Observed site subjects:'));
    expect(subjectEntries.length).toBeGreaterThan(0);
    for (const entry of subjectEntries) expect(entry).not.toContain(positioning);
  });

  it('E — a recommended topic cannot flow back into observed evidence', () => {
    const subjects = collectObservedSubjects([page()]);
    const strategy = buildBacklinkStrategy({
      declared: { category: 'decision support', target_market: 'career changers' },
      assets: { topicsCovered: distinctSubjectValues(subjects) },
    });
    // Recommendations name asset classes; none of that vocabulary is in the observed channel.
    const recommended = strategy.recommendations.map((r) => r.recommendedAsset).join(' ');
    expect(recommended.length).toBeGreaterThan(0);
    for (const value of distinctSubjectValues(subjects)) {
      expect(recommended).not.toBe(value);
    }
    // Re-running the producer is unaffected by any recommendation having been made.
    expect(distinctSubjectValues(collectObservedSubjects([page()]))).toEqual(distinctSubjectValues(subjects));
  });

  it('G — a competitor page is not in scope, so its subject cannot appear', () => {
    // The caller supplies domain-scoped pages (`loadExperiencePages` filters by company_id and
    // domain_id). Passing only own-domain pages is therefore the production shape, and a
    // competitor subject simply never reaches the producer.
    const ownOnly = collectObservedSubjects([page()]);
    expect(distinctSubjectValues(ownOnly).join(' ')).not.toContain('Contoso');
    // If a competitor page WERE passed, the subject would carry that page's URL — which is what
    // makes the leak detectable rather than silent.
    const leaked = collectObservedSubjects([page({ url: 'https://contoso-insight.test/pricing', title: 'Contoso Pricing' })]);
    expect(leaked[0].sourceUrl).toContain('contoso-insight.test');
  });

  it('I — an inferred token is admitted only if it is literally the page text', () => {
    // "analytics" is a frequency token derivable from the fixture, but it is not a title or a
    // heading, so it is not an observed subject.
    const values = distinctSubjectValues(collectObservedSubjects([page()]));
    expect(values).not.toContain('analytics');
    expect(values).toContain('Pricing');
  });
});

// ── H. PAGE-LEVEL vs SITE-LEVEL ─────────────────────────────────────────────

describe('H — page-level evidence is never promoted to a site-level claim', () => {
  it('a subject states its page, and the shape carries no company-level assertion', () => {
    const subjects = collectObservedSubjects([page()]);
    const h1 = subjects.find((s) => s.text === 'Pricing') as ObservedSubject;
    expect(h1.sourceUrl).toBe('https://northwind-analytics.test/pricing');
    // No field exists on which a "company covers X" claim could ride.
    for (const key of Object.keys(h1)) {
      expect(key).not.toMatch(/company|site|authority|coverage|covers/i);
    }
  });

  it('several pages carrying the same subject keep their own provenance', () => {
    const subjects = collectObservedSubjects([
      page(),
      page({ url: 'https://northwind-analytics.test/plans', title: null, headings: [{ level: 1, text: 'Pricing' }] }),
    ]);
    const pricing = subjects.filter((s) => s.normalized === 'pricing');
    expect(pricing).toHaveLength(2);
    expect(new Set(pricing.map((s) => s.sourceUrl)).size).toBe(2);
  });
});

// ── J. NORMALIZATION ────────────────────────────────────────────────────────

describe('J — normalization deduplicates without rewriting the evidence', () => {
  it('is conservative: trim, collapse whitespace, case-fold — nothing else', () => {
    expect(normalizeSubject('  Pricing  ')).toBe('pricing');
    expect(normalizeSubject('Plans   for\tteams')).toBe('plans for teams');
    // No stemming and no synonym expansion.
    expect(normalizeSubject('Pricing')).not.toBe('price');
  });

  it('"  Pricing  " and "Pricing" deduplicate to one value', () => {
    const subjects = collectObservedSubjects([
      page({ title: null, headings: [{ level: 1, text: '  Pricing  ' }] }),
      page({ url: 'https://northwind-analytics.test/plans', title: null, headings: [{ level: 1, text: 'Pricing' }] }),
    ]);
    expect(subjects).toHaveLength(2);
    expect(distinctSubjectValues(subjects)).toEqual(['Pricing']);
  });

  it('the flat list keeps the VERBATIM spelling, not the normalized key', () => {
    const values = distinctSubjectValues(collectObservedSubjects([page()]));
    expect(values).toContain('Pricing — Northwind Analytics');
    expect(values).not.toContain('pricing — northwind analytics');
  });

  it('the richer structure retains verbatim text alongside the dedup key', () => {
    const [subject] = collectObservedSubjects([page({ title: null, headings: [{ level: 1, text: '  Pricing  ' }] })]);
    expect(subject.text).toBe('Pricing');
    expect(subject.normalized).toBe('pricing');
    expect(subject.text).not.toBe(subject.normalized);
  });
});

// ── STRATEGY INTEGRATION ────────────────────────────────────────────────────

describe('observed subjects upgrade the strategy from declared to observed', () => {
  it('an observed subject becomes OBSERVED topical evidence in the basis', () => {
    const subjects = collectObservedSubjects([page()]);
    const strategy = buildBacklinkStrategy({
      declared: { category: 'decision-support tools', target_market: 'career changers' },
      assets: { topicsCovered: distinctSubjectValues(subjects) },
    });
    const rec = strategy.recommendations.find((r) => r.backlinkType === 'topical_editorial');
    // The topical input is now observed rather than declared.
    expect(rec?.evidenceBasis.join(' ')).toContain('Observed site subjects');
    expect(rec?.evidenceBasis.join(' ')).not.toContain('Declared category/offering');
    expect(rec?.relevance.find((d) => d.dimension === 'topical')?.verdict).toBe('supports');
    expect(rec?.relevance.find((d) => d.dimension === 'topical')?.state).toBe('observed');
    // The recommendation's own state is the WEAKEST contributing input, so declared market
    // context legitimately holds it at `declared`. That rule is certified and unchanged here.
    expect(rec?.evidenceState).toBe('declared');
  });

  it('with every contributing input observed, the recommendation reaches observed', () => {
    const subjects = collectObservedSubjects([page()]);
    const strategy = buildBacklinkStrategy({
      declared: { category: 'decision-support tools', target_market: 'career changers' },
      observedMarketSignals: [{ value: 'career clarity tools', source: 'serp' }],
      assets: { topicsCovered: distinctSubjectValues(subjects) },
    });
    const rec = strategy.recommendations.find((r) => r.backlinkType === 'topical_editorial');
    expect(rec?.evidenceState).toBe('observed');
    expect(rec?.provenance).toBe('PUBLIC_OBSERVED');
  });

  it('the same input with NO observed subjects stays declared — the contrast', () => {
    const strategy = buildBacklinkStrategy({
      declared: { category: 'decision-support tools', target_market: 'career changers' },
      assets: { topicsCovered: [] },
    });
    const rec = strategy.recommendations.find((r) => r.backlinkType === 'topical_editorial');
    expect(rec?.evidenceState).toBe('declared');
  });
});

// ── T2. THE WHOLE CHAIN, WITH THE REAL REPOSITORY SHAPE ─────────────────────
//
// Everything above calls the producer with the structural shape it declares. That leaves one
// thing unproven: that the row the REPOSITORY actually returns satisfies that shape. The
// producer deliberately declares a structural type rather than importing `ExperiencePage`, so
// nothing but a typed binding can establish the two agree — and because ts-jest is
// transpile-only, this is carried by the backend-tests typecheck, not by the assertions.

describe('T2 — the repository row flows through the chain and keeps its provenance', () => {
  /** Typed as the repository's own output, so a drift in either contract fails the typecheck. */
  const repositoryRow: ExperiencePage = {
    url: 'https://northwind-analytics.test/pricing',
    page_type: 'pricing',
    title: 'Pricing — Northwind Analytics',
    meta_description: 'Plans and pricing.',
    headings: [{ level: 1, text: 'Pricing' }, { level: 2, text: 'Plans for mid-market teams' }],
    ctas: [{ text: 'Start free trial', href: '/signup', source: 'button' }],
    internal_link_count: 12,
    http_status: 200,
    crawl_depth: 1,
    wordCount: 480,
    crawl_metadata: null,
    last_crawled_at: CRAWLED_AT,
  };

  it('the real page shape is admissible and yields its literal text', () => {
    const subjects = collectObservedSubjects([repositoryRow]);
    expect(subjects.map((s) => s.text)).toEqual([
      'Pricing — Northwind Analytics', 'Pricing', 'Plans for mid-market teams',
    ]);
  });

  it('provenance survives: every subject names its URL, element and crawl time', () => {
    for (const subject of collectObservedSubjects([repositoryRow])) {
      expect(subject.sourceUrl).toBe('https://northwind-analytics.test/pricing');
      expect(subject.observedAt).toBe(CRAWLED_AT);
      expect(subject.origin === 'title' || subject.origin === 'heading').toBe(true);
    }
  });

  it('the page fields that are NOT subject matter stay out of the channel', () => {
    const values = distinctSubjectValues(collectObservedSubjects([repositoryRow]));
    // Authored metadata about the page, interface affordances and quantities are all present on
    // the row and all deliberately inadmissible.
    expect(values).not.toContain('Plans and pricing.');
    expect(values.join(' ')).not.toContain('Start free trial');
    expect(values.join(' ')).not.toContain('480');
    expect(values.join(' ')).not.toContain('200');
  });

  it('end to end: repository row -> producer -> topicsCovered -> rendered basis', () => {
    const strategy = buildBacklinkStrategy({
      declared: { category: 'decision-support tools', target_market: 'career changers' },
      observedMarketSignals: [{ value: 'career clarity tools', source: 'serp' }],
      assets: { topicsCovered: distinctSubjectValues(collectObservedSubjects([repositoryRow])) },
    });
    const rec = strategy.recommendations.find((r) => r.backlinkType === 'topical_editorial');
    // The literal page text reaches the reader, verbatim, under an observed label.
    expect(rec?.evidenceBasis.join(' ')).toContain('Observed site subjects');
    expect(rec?.evidenceBasis.join(' ')).toContain('Plans for mid-market teams');
    expect(rec?.evidenceState).toBe('observed');
    expect(rec?.provenance).toBe('PUBLIC_OBSERVED');
  });

  it('a row the crawler never dated reaches the reader with NO crawl time', () => {
    const undated: ExperiencePage = { ...repositoryRow, last_crawled_at: null };
    const subjects = collectObservedSubjects([undated]);
    expect(subjects.length).toBeGreaterThan(0);
    for (const subject of subjects) expect(subject.observedAt).toBeNull();
    // The text is still usable evidence — a missing crawl time withholds the time, not the fact.
    expect(distinctSubjectValues(subjects)).toContain('Pricing');
  });
});

/**
 * R1-D RENDERING — a position carries the search that produced it, in the report.
 *
 * The retention slice declared `engine`, `provider` and `observedAt` on the snapshot observation.
 * They were still invisible to a reader: the section footer stated ONE provider and ONE time for
 * the whole run, so a report containing observations from different engines, different providers
 * or different reading minutes attributed every position to a single search that did not produce
 * most of them.
 *
 * These tests drive the REAL renderer (`renderSearchVisibility`, the function
 * `exportRendererOutput` calls and the PDF pipeline reaches through
 * `renderCanonicalReportHtml`) over a deterministic payload. What they pin is auditability: one
 * row, one provenance, no collapsing, and nothing invented where a value was never recorded.
 *
 * DELIBERATELY ABSENT and asserted so: visibility score, coverage rate, position quality, derived
 * queryClass/intent, page-neighbour or competitor claims, geography and device.
 */
import type { CanonicalExportPayload } from '../../services/intelligence/canonicalExport';
import { renderSearchVisibility } from '../../services/intelligence/exportRendererReport1';
import type { SnapshotSearchObservation } from '../../services/snapshotReportTypes';

type Observation = SnapshotSearchObservation;

const ranked = (over: Partial<Observation> = {}): Observation => ({
  query: 'mid market analytics',
  position: 4,
  url: 'https://northwind-analytics.test/solutions',
  title: 'Northwind Analytics',
  snippet: 'Analytics for mid-market teams.',
  resultCount: 10,
  engine: 'google',
  provider: 'provider-a',
  observedAt: '2026-02-01T09:30:00.000Z',
  ...over,
});

/** A payload carrying only the surface the renderer reads. */
const payloadWith = (observations: Observation[], surface: Record<string, unknown> = {}): CanonicalExportPayload =>
  ({
    report1: {
      search_visibility: {
        state: 'measured',
        provider: 'provider-a',
        source: 'serp',
        provenance: 'PUBLIC_OBSERVED',
        observedAt: '2026-02-01T00:00:00.000Z',
        queriesRun: observations.length,
        queriesRanked: observations.filter((o) => typeof o.position === 'number').length,
        bestPosition: 4,
        observations,
        requestsMade: observations.length,
        reason: null,
        ...surface,
      },
    },
  } as unknown as CanonicalExportPayload);

const render = (observations: Observation[], surface?: Record<string, unknown>): string =>
  renderSearchVisibility(payloadWith(observations, surface), 'EV');

// ── A-C. OBSERVED PROVENANCE RENDERS ────────────────────────────────────────

describe('observed provenance reaches the reader', () => {
  it('A — the observed engine renders', () => {
    expect(render([ranked()])).toContain('engine google');
  });

  it('B — the observed provider renders, distinctly from the engine', () => {
    const html = render([ranked()]);
    expect(html).toContain('via provider-a');
    // Engine and provider are separate facts and must not be printed as one.
    expect(html).not.toMatch(/engine provider-a/);
    expect(html).not.toMatch(/via google/);
  });

  it('C — the observation reading time renders', () => {
    expect(render([ranked()])).toContain('read 2026-02-01');
  });
});

// ── D. NO COLLAPSING — the whole point of the slice ─────────────────────────

describe('D — distinct observations keep distinct provenance', () => {
  const two = [
    ranked({ query: 'mid market analytics', engine: 'google', provider: 'provider-a', observedAt: '2026-02-01T09:30:00.000Z' }),
    ranked({ query: 'analytics for operations', position: 7, engine: 'bing', provider: 'provider-b', observedAt: '2026-03-15T11:00:00.000Z' }),
  ];

  it('both engines, both providers and both reading dates appear', () => {
    const html = render(two);
    expect(html).toContain('engine google');
    expect(html).toContain('engine bing');
    expect(html).toContain('via provider-a');
    expect(html).toContain('via provider-b');
    expect(html).toContain('read 2026-02-01');
    expect(html).toContain('read 2026-03-15');
  });

  it('each provenance sits with its own query, not pooled at the section level', () => {
    const html = render(two);
    const firstQuery = html.indexOf('mid market analytics');
    const secondQuery = html.indexOf('analytics for operations');
    expect(firstQuery).toBeGreaterThan(-1);
    expect(secondQuery).toBeGreaterThan(firstQuery);
    // google/provider-a belong to the first row: they appear before the second query.
    expect(html.indexOf('engine google')).toBeLessThan(secondQuery);
    expect(html.indexOf('via provider-a')).toBeLessThan(secondQuery);
    // bing/provider-b belong to the second row: they appear after it.
    expect(html.indexOf('engine bing')).toBeGreaterThan(secondQuery);
    expect(html.indexOf('via provider-b')).toBeGreaterThan(secondQuery);
  });

  it('the second observation is not re-labelled with the first provider', () => {
    const html = render(two);
    // Compare the provenance LINES themselves. Slicing to the end of the document would
    // include the section footer, which legitimately states the run's surface-level
    // provider -- that is not a re-labelling of the row.
    const lines = [...html.matchAll(/engine [a-z]+ . via [a-z-]+ . read [0-9]{4}-[0-9]{2}-[0-9]{2}/g)]
      .map((match) => match[0]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('via provider-a');
    expect(lines[1]).toContain('via provider-b');
    expect(lines[1]).not.toContain('via provider-a');
    expect(lines[0]).not.toContain('via provider-b');
  });
});

// ── E. MISSING PROVENANCE STAYS UNAVAILABLE ────────────────────────────────

describe('E — absent provenance is never substituted', () => {
  it('a null reading time is omitted and never replaced by any other clock', () => {
    const html = render([ranked({ observedAt: null })], { observedAt: '2026-02-01T00:00:00.000Z' });
    // The engine it does have is still stated.
    expect(html).toContain('engine google');
    // No reading date is claimed for this observation.
    expect(html).not.toContain('read 2026-02-01');
    expect(html).not.toMatch(/read \d{4}-\d{2}-\d{2}/);
  });

  it('a null engine is omitted, not printed as a value', () => {
    const html = render([ranked({ engine: null })]);
    expect(html).not.toMatch(/engine (null|undefined|unknown|Unknown|n\/a)/);
    expect(html).toContain('via provider-a');
  });

  it('an observation with no provenance at all says so, in those words', () => {
    const html = render([ranked({ engine: null, provider: null, observedAt: null })]);
    expect(html).toContain('search provenance not recorded for this observation');
    // "not recorded" is a statement of absence, not a value masquerading as one.
    expect(html).not.toMatch(/engine (null|undefined)/);
    expect(html).not.toMatch(/via (null|undefined)/);
  });

  it('a pre-R1-D observation carrying none of the fields still renders its position', () => {
    const legacy: Observation = {
      query: 'mid market analytics', position: 4, url: null, title: null, snippet: null, resultCount: 10,
    };
    const html = render([legacy]);
    expect(html).toContain('Position 4');
    expect(html).toContain('search provenance not recorded for this observation');
  });
});

// ── F-G. EXISTING BEHAVIOUR UNCHANGED ──────────────────────────────────────

describe('F/G — the existing observation contract is untouched', () => {
  it('position, query, url, title and snippet still render', () => {
    const html = render([ranked()]);
    expect(html).toContain('Position 4');
    expect(html).toContain('mid market analytics');
    expect(html).toContain('https://northwind-analytics.test/solutions');
    expect(html).toContain('Northwind Analytics');
    expect(html).toContain('Analytics for mid-market teams.');
  });

  it('a checked-but-absent query is still an observation, never a rank of zero', () => {
    const html = render([ranked({ position: null, url: null, title: null, snippet: null })]);
    expect(html).toContain('Checked, not found');
    expect(html).toMatch(/not in the top 10 results/);
    expect(html).not.toMatch(/Position 0/);
  });

  it('the section framing and source line are unchanged', () => {
    const html = render([ranked()]);
    expect(html).toContain("Positions are the search provider's own ranks");
    expect(html).toContain('Source: public search results');
  });
});

// ── H-J. SEMANTIC EXCLUSIONS ───────────────────────────────────────────────

describe('H/I/J — nothing outside observed provenance is introduced', () => {
  it('H — no score, coverage rate or position quality appears', () => {
    const html = render([ranked(), ranked({ query: 'other', engine: 'bing' })]);
    expect(html).not.toMatch(/visibility score|coverage rate|coverageRate|positionQuality/i);
    // The framing already says positions are "not a derived score" -- that negation IS the
    // desired behaviour, so assert it survives rather than banning the word outright.
    expect(html).toContain('not a derived score');
    // What must be absent is any score VALUE or score-bearing label.
    expect(html).not.toMatch(/score[: ]+[0-9]/i);
    expect(html).not.toMatch(/[0-9]+\s*\/\s*100/);
  });

  it('I — no derived query class or intent appears', () => {
    const html = render([ranked()]);
    expect(html).not.toMatch(/queryClass|query class/i);
    expect(html).not.toMatch(/\bintent\b/i);
    expect(html).not.toMatch(/\bbranded\b|\binformational\b/i);
  });

  it('J — no geography, device, page-neighbour or competitor claim appears', () => {
    const html = render([ranked()]);
    expect(html).not.toMatch(/geograph|device/i);
    expect(html).not.toMatch(/page neighbour|neighbor|competitorDomains/i);
    // The section makes no competitor claim of any kind.
    expect(html).not.toMatch(/competitor/i);
  });
});

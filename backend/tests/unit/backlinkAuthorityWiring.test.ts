/**
 * BACKLINK AUTHORITY — Report 1 WIRING.
 *
 * The certified module is already proven by `reportBacklinkStrategy.test.ts`. What this file
 * tests is the INTEGRATION: that the canonical report carries both halves, that the renderer
 * keeps them apart, and that nothing in the rendering layer re-introduces a defect the module
 * was built to prevent — an unavailable provider rendering as a zero, a recommended TYPE
 * reading as an existing link, a raw enum token reaching the reader, or a score appearing where
 * none exists.
 *
 * SCOPE HONESTY. Two things here are STRUCTURAL rather than end-to-end, and are labelled as
 * such: the producer assertion reads the assembly source, and the export-path assertion reads
 * the renderer-output source. Neither executes `buildCanonicalReport` or `renderExportHtml`,
 * because both need a whole SnapshotReport / CanonicalExportPayload fixture that no existing
 * test builds. They prove the wiring is present and routed through the single canonical
 * renderer; they do not prove an end-to-end run.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { CanonicalExportPayload } from '../../services/intelligence/canonicalExport';
import { renderBacklinkAuthority } from '../../services/intelligence/exportRendererBacklinkStrategy';
import {
  buildBacklinkStrategy,
  summarizeBacklinkObservation,
  type BacklinkStrategyInput,
} from '../../services/canonicalReport/reportBacklinkStrategy';

const SRC = (...p: string[]) => path.join(__dirname, '..', '..', ...p);
const ASSEMBLY = SRC('services', 'canonicalReport', 'canonicalReportBuilderAssembly.ts');
const OUTPUT = SRC('services', 'intelligence', 'exportRendererOutput.ts');

/** The declared context the producer actually passes, mirrored here. */
const declared: BacklinkStrategyInput['declared'] = {
  category: 'decision-support tools',
  offering: 'multilingual clarity assistant',
  positioning: 'culturally aware guidance for career decisions',
  target_market: 'individuals making career and life decisions',
  geography: 'India',
};

const surfaceFor = (input: BacklinkStrategyInput) => ({
  observation: summarizeBacklinkObservation(input),
  strategy: buildBacklinkStrategy(input),
});

/** A payload carrying only the field the renderer reads. */
const payloadWith = (input: BacklinkStrategyInput): CanonicalExportPayload =>
  ({ backlink_authority: surfaceFor(input) } as unknown as CanonicalExportPayload);

const MEASURED: BacklinkStrategyInput = {
  declared,
  comparabilityKey: 'c|d|standard|v1',
  measurement: {
    state: 'measured', referring_domains: 42, backlinks: 310, authority: 31,
    observed_at: '2026-02-01T00:00:00.000Z', source: 'backlink_api',
  },
};

const UNAVAILABLE: BacklinkStrategyInput = {
  declared,
  comparabilityKey: 'c|d|standard|v1',
  measurement: {
    state: 'unavailable', referring_domains: null, backlinks: null, authority: null,
    observed_at: null, source: 'backlink_api',
    reason_unavailable: 'No supported backlink provider answered.',
  },
};

// ── 1-3. OBSERVATION RENDERING ──────────────────────────────────────────────

describe('observation rendering', () => {
  it('1 — a measured observation renders as an observation with its metrics', () => {
    const html = renderBacklinkAuthority(payloadWith(MEASURED), 'EV');
    expect(html).toContain('Backlink observation');
    expect(html).toContain('Referring domains');
    expect(html).toContain('42');
    expect(html).toContain('310');
  });

  it('2 — an unavailable provider renders unavailable and NEVER a zero', () => {
    const html = renderBacklinkAuthority(payloadWith(UNAVAILABLE), 'EV');
    expect(html).toContain('not measured');
    expect(html).toMatch(/not a finding about this company/i);
    // No metric row is emitted at all, so `null` cannot surface as 0.
    expect(html).not.toContain('Referring domains');
    expect(html).not.toMatch(/>0</);
    // And the forbidden language never appears.
    expect(html).not.toMatch(/weak backlink|poor backlink|backlink weakness/i);
    // The MEASURED branch's framing must be absent too. Without this, treating an unavailable
    // observation as measured trips nothing: the limitations text still carries "not measured"
    // and `metricRow` still suppresses the nulls, so both prior assertions pass.
    expect(html).not.toMatch(/a reported zero is a measurement/i);
    expect(html).not.toMatch(/external backlink provider reported/i);
  });

  it('a measured observation with an ABSENT sub-metric renders nothing for it, never 0', () => {
    // THE GAP THIS CLOSES. The unavailable-vs-zero invariant is protected by two independent
    // defences: `renderObservation` returns early for a non-measured state, and `metricRow`
    // suppresses non-finite values. Every existing case exercises only the first, so a
    // single-point regression in `metricRow` — coercing null to 0 — was caught by no test at
    // all; it took removing BOTH defences at once for any assertion to trip.
    //
    // A partially-measured observation is the case that isolates the second defence: the
    // provider answered (so the measured branch runs) but one metric is absent. The absent one
    // must render nothing. A fabricated 0 here would read as "this domain has zero backlinks",
    // measured, which is the exact defect AUTH-G-002 closed in the adapter.
    const html = renderBacklinkAuthority(payloadWith({
      ...MEASURED,
      measurement: { ...MEASURED.measurement!, referring_domains: 42, backlinks: null },
    }), 'EV');
    expect(html).toContain('Referring domains');
    expect(html).toContain('42');
    // The absent metric contributes no row and no value.
    expect(html).not.toContain('Backlinks');
    expect(html).not.toMatch(/>0</);
  });

  it('3 — a genuine measured zero renders as zero, not as unavailable', () => {
    const html = renderBacklinkAuthority(payloadWith({
      ...MEASURED,
      measurement: { ...MEASURED.measurement!, referring_domains: 0, backlinks: 0, authority: 0 },
    }), 'EV');
    expect(html).toContain('Referring domains');
    expect(html).toMatch(/>0</);
    expect(html).not.toContain('not measured');
    expect(html).toMatch(/a reported zero is a measurement/i);
  });
});

// ── 4, 11. THE TWO SURFACES ARE DISTINCT ────────────────────────────────────

describe('observation and strategy render as distinct surfaces', () => {
  it('4/11 — both headed blocks are present and separately framed', () => {
    const html = renderBacklinkAuthority(payloadWith(MEASURED), 'EV');
    expect(html).toContain('Backlink observation');
    expect(html).toContain('Contextual link strategy');
    // Order: what exists, then what to build.
    expect(html.indexOf('Backlink observation')).toBeLessThan(html.indexOf('Contextual link strategy'));
    // The strategy block states what it is NOT, in the reader's terms.
    expect(html).toMatch(/not links it already has/i);
    expect(html).toMatch(/not a list of sites to contact/i);
    expect(html).toMatch(/types of external authority worth building/i);
  });

  it('a recommended type is never presented as an existing backlink or a gap measurement', () => {
    const html = renderBacklinkAuthority(payloadWith(UNAVAILABLE), 'EV');
    expect(html).not.toMatch(/backlink gap|you need links from|competitor backlink/i);
    // The renderer DOES say "not an outreach list" — that negation is the point. What must be
    // absent is any positive instruction to contact or target anyone.
    expect(html).toMatch(/not an outreach list/i);
    expect(html).not.toMatch(/contact these|reach out to|target list|these publishers/i);
  });
});

// ── 5. MISSING MEASUREMENT IS NOT STRATEGY EVIDENCE ─────────────────────────

describe('5 — unavailable backlink data never becomes strategy evidence', () => {
  it('the rendered evidence basis cites context, never the missing measurement', () => {
    const html = renderBacklinkAuthority(payloadWith(UNAVAILABLE), 'EV');
    const strategyHtml = html.slice(html.indexOf('Contextual link strategy'));
    expect(strategyHtml).not.toMatch(/No supported backlink provider answered/);
    expect(strategyHtml).not.toMatch(/not measured|unavailable/i);
  });

  it('the strategy is identical whether or not the provider answered', () => {
    const withProvider = buildBacklinkStrategy(MEASURED);
    const without = buildBacklinkStrategy(UNAVAILABLE);
    expect(without.recommendations.map((r) => `${r.backlinkType}:${r.priority}:${r.evidenceState}`))
      .toEqual(withProvider.recommendations.map((r) => `${r.backlinkType}:${r.priority}:${r.evidenceState}`));
  });
});

// ── 6. DECLARED PROVENANCE SURVIVES RENDERING ───────────────────────────────

describe('6 — declared context stays declared through the renderer', () => {
  it('declared recommendations render a declared label and the inference caveat', () => {
    const html = renderBacklinkAuthority(payloadWith(UNAVAILABLE), 'EV');
    expect(html).toContain('From what you told us');
    expect(html).toMatch(/strategic inference, not an observed opportunity/i);
    // The caveat reads "not observed market demand" — assert that negation, and that no
    // positive claim of observed demand is made.
    expect(html).toMatch(/not observed market demand/i);
    expect(html).not.toMatch(/(?<!not )observed market demand is|demand is observed/i);
  });

  it('no raw evidence-state or priority enum token reaches the reader', () => {
    const html = renderBacklinkAuthority(payloadWith(MEASURED), 'EV');
    for (const token of ['insufficient_evidence', 'insufficient_signal', 'near_term',
      'topical_editorial', 'research_data_citation', 'entity_brand', 'trust_authority']) {
      expect(html).not.toContain(token);
    }
  });
});

// ── 7-8. NO TARGETS, NO SCORE ───────────────────────────────────────────────

describe('7/8 — no targets and no invented score', () => {
  it('7 — the rendered output contains no URL, domain or publisher target', () => {
    const html = renderBacklinkAuthority(payloadWith(MEASURED), 'EV');
    // Strip the renderer's own markup/style attributes before scanning prose.
    const prose = html.replace(/<[^>]*>/g, ' ');
    expect(prose).not.toMatch(/https?:\/\//i);
    expect(prose).not.toMatch(/\b[a-z0-9-]+\.(com|co|io|net|org|in)\b/i);
  });

  it('8 — no backlink score is introduced anywhere in the wiring', () => {
    const surface = surfaceFor(MEASURED);
    expect(Object.keys(surface.observation)).not.toContain('score');
    for (const rec of surface.strategy.recommendations) {
      expect(Object.keys(rec)).not.toContain('score');
    }
    const renderer = fs.readFileSync(
      SRC('services', 'intelligence', 'exportRendererBacklinkStrategy.ts'), 'utf8',
    );
    expect(renderer).not.toMatch(/backlinkScore|backlink_score|backlink_health|opportunityScore/);
    // Domain authority must not be rendered or used to order recommendations. The docblock
    // explains why it is excluded, so comments are stripped before scanning the CODE.
    const code = renderer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/domain_authority/);
    expect(code).not.toMatch(/\.sort\(/);
  });
});

// ── 9. GROWTH STAYS COMPARABILITY-GATED ─────────────────────────────────────

describe('9 — growth never renders as measured without comparable observations', () => {
  it('a single observation renders the current-profile sentence, not growth', () => {
    const html = renderBacklinkAuthority(payloadWith(MEASURED), 'EV');
    expect(html).toMatch(/not growth/i);
    expect(html).not.toMatch(/Change across comparable observations/);
  });

  it('a non-comparable prior snapshot does not produce a rendered delta', () => {
    const html = renderBacklinkAuthority(payloadWith({
      ...MEASURED,
      history: [{ referring_domains: 10, observed_at: '2026-01-01T00:00:00.000Z', comparability_key: 'OTHER' }],
    }), 'EV');
    expect(html).not.toMatch(/Change across comparable observations/);
  });

  it('two comparable observations DO render a measured delta', () => {
    const html = renderBacklinkAuthority(payloadWith({
      ...MEASURED,
      history: [{ referring_domains: 30, observed_at: '2026-01-01T00:00:00.000Z', comparability_key: 'c|d|standard|v1' }],
    }), 'EV');
    expect(html).toMatch(/Change across comparable observations: 12 referring domains/);
  });
});

// ── 10, 12. WIRING PRESENCE (STRUCTURAL) ────────────────────────────────────

describe('10/12 — the producer and the export path are wired', () => {
  it('10 — the canonical producer assigns BOTH halves from the certified functions', () => {
    const src = fs.readFileSync(ASSEMBLY, 'utf8');
    expect(src).toMatch(/import \{ summarizeBacklinkObservation, buildBacklinkStrategy \} from '\.\/reportBacklinkStrategy'/);
    expect(src).toMatch(/reportShape\.backlink_authority = \{/);
    expect(src).toMatch(/observation: summarizeBacklinkObservation\(backlinkInput\)/);
    expect(src).toMatch(/strategy: buildBacklinkStrategy\(backlinkInput\)/);
    // Declared context is passed on the declared channel, and history is empty (none persisted).
    expect(src).toMatch(/declared: \{/);
    expect(src).toMatch(/history: \[\]/);
    // No provider call, query or write is introduced at the producer.
    const producer = src.slice(src.indexOf('const backlinkMeasured'), src.indexOf('return reportShape;'));
    expect(producer).not.toMatch(/await |fetch\(|lookup\(|insert|update|delete/i);
  });

  it('12 — the export path routes through the single canonical renderer', () => {
    const src = fs.readFileSync(OUTPUT, 'utf8');
    expect(src).toMatch(/import \{ renderBacklinkAuthority \} from '\.\/exportRendererBacklinkStrategy'/);
    expect(src).toMatch(/\$\{renderBacklinkAuthority\(payload, EYEBROW_EVIDENCE\)\}/);
    // Exactly one call site: no second/parallel renderer.
    // Exactly one invocation (the import names it without parentheses).
    expect((src.match(/renderBacklinkAuthority\(/g) ?? []).length).toBe(1);
  });
});

// ── 13-14. ABSENCE AND ABSTENTION ───────────────────────────────────────────

describe('13/14 — honest behaviour when there is nothing to show', () => {
  it('13 — an abstaining strategy says so rather than manufacturing recommendations', () => {
    const html = renderBacklinkAuthority(payloadWith({ measurement: UNAVAILABLE.measurement }), 'EV');
    expect(html).toContain('Contextual link strategy');
    expect(html).toMatch(/could not be derived|Generic link-building advice/i);
    expect(html).not.toContain('Start now');
  });

  it('14 — the section omits entirely when the surface is absent, leaving Authority unchanged', () => {
    expect(renderBacklinkAuthority({} as unknown as CanonicalExportPayload, 'EV')).toBe('');
    expect(renderBacklinkAuthority(
      { backlink_authority: undefined } as unknown as CanonicalExportPayload, 'EV',
    )).toBe('');
  });
});

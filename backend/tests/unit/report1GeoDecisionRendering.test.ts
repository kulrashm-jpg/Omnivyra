/**
 * PHASE 2B — the Phase 2 GEO evidence boundary and decision must reach the customer.
 *
 * Phase 2 stopped the report calling public-crawl structure "measured AI answer coverage",
 * and produced `ai_retrieval` + `geo_decision` to state the boundary and still give a
 * decision. Neither had a slot in the canonical export, so the customer saw the corrected
 * wording but not the reasoning behind it.
 *
 * These tests assert the rendered HTML, which is what the customer actually receives.
 */
import { renderGeoEvidenceDecision } from '../../services/intelligence/exportRendererReport1';
import type { CanonicalExportPayload } from '../../services/intelligence/canonicalExport';

type GeoBlock = NonNullable<NonNullable<CanonicalExportPayload['report1']>['geo_evidence_decision']>;

function payloadWith(block: GeoBlock | null): CanonicalExportPayload {
  return { report1: { geo_evidence_decision: block } } as unknown as CanonicalExportPayload;
}

const INSUFFICIENT: GeoBlock = {
  aiRetrieval: {
    state: 'insufficient_signal',
    basis: 'Public crawl of the site: heading structure, citation-shaped phrasing, entity mentions and query-answer coverage.',
    notMeasurable:
      'Whether AI answer engines actually retrieve, cite or name this brand. No answer-engine retrieval was performed for this report.',
    unlock: 'Connect an answer-engine provider so branded, category and competitor queries can be checked directly.',
  },
  decision: {
    relevance: 'relevant',
    why: 'The site already publishes content that buyers ask questions about.',
    doNow: ['Add direct-answer sections to the highest-value query pages'],
    defer: ['Defer any claim about current AI answer share until an answer-engine provider is connected.'],
    measurement: 'Re-crawl and compare these readiness axes against this run as the baseline.',
  },
};

describe('GEO evidence boundary is rendered to the customer', () => {
  it('renders the section when the payload carries it', () => {
    const html = renderGeoEvidenceDecision(payloadWith(INSUFFICIENT), '03');
    expect(html).toContain('<section class="ds-section">');
    expect(html).toContain('AI Discoverability');
  });

  it('renders insufficient evidence as words, never as a score', () => {
    const html = renderGeoEvidenceDecision(payloadWith(INSUFFICIENT), '03');
    expect(html).toContain('Not measured');
    expect(html).toContain('insufficient evidence');
    expect(html).not.toMatch(/Answer-engine retrieval:\s*0/);
  });

  it('shows what could not be measured', () => {
    const html = renderGeoEvidenceDecision(payloadWith(INSUFFICIENT), '03');
    expect(html).toContain('No answer-engine retrieval was performed');
  });

  it('shows the evidence basis', () => {
    const html = renderGeoEvidenceDecision(payloadWith(INSUFFICIENT), '03');
    expect(html).toContain('Public crawl of the site');
  });

  it('shows what would unlock a real measurement', () => {
    const html = renderGeoEvidenceDecision(payloadWith(INSUFFICIENT), '03');
    expect(html).toContain('answer-engine provider');
    expect(html).toContain('unlock a real measurement');
  });

  it('keeps public crawl evidence distinct from answer-engine retrieval', () => {
    const html = renderGeoEvidenceDecision(payloadWith(INSUFFICIENT), '03');
    expect(html).toContain('not observations of any AI answer engine');
  });

  it('introduces no "measured at X/100" wording for AI retrieval', () => {
    const html = renderGeoEvidenceDecision(payloadWith(INSUFFICIENT), '03');
    expect(html).not.toMatch(/measured at \d+\/100/);
  });
});

describe('GEO decision is rendered to the customer', () => {
  it('renders relevance, do now, defer and measurement', () => {
    const html = renderGeoEvidenceDecision(payloadWith(INSUFFICIENT), '03');
    expect(html).toContain('GEO is relevant');
    expect(html).toContain('Do now');
    expect(html).toContain('Add direct-answer sections');
    expect(html).toContain('Defer');
    expect(html).toContain('AI answer share');
    expect(html).toContain('How success will be measured');
  });

  it('omits empty lists rather than printing an empty heading', () => {
    const conditional: GeoBlock = {
      aiRetrieval: INSUFFICIENT.aiRetrieval,
      decision: {
        relevance: 'conditional',
        why: 'Too little public structure was observed. That is a gap in evidence, not a finding that the brand is absent from AI answers.',
        doNow: [],
        defer: ['Defer GEO/AEO investment until the site has enough crawlable content.'],
        measurement: 'Re-run this report once the site exposes crawlable answer content.',
      },
    };
    const html = renderGeoEvidenceDecision(payloadWith(conditional), '03');
    expect(html).toContain('GEO is conditional');
    expect(html).not.toContain('>Do now<');
    expect(html).toContain('Defer GEO/AEO investment');
    expect(html).toContain('not a finding that the brand is absent');
  });
});

describe('Abstention and architecture', () => {
  it('renders nothing when the producer abstained entirely', () => {
    expect(renderGeoEvidenceDecision(payloadWith(null), '03')).toBe('');
    expect(renderGeoEvidenceDecision({} as CanonicalExportPayload, '03')).toBe('');
  });

  it('renders the evidence block alone when there is no decision', () => {
    const html = renderGeoEvidenceDecision(
      payloadWith({ aiRetrieval: INSUFFICIENT.aiRetrieval, decision: null }),
      '03',
    );
    expect(html).toContain('No answer-engine retrieval was performed');
    expect(html).not.toContain('How success will be measured');
  });

  it('labels an inferred state as inferred, not measured', () => {
    const html = renderGeoEvidenceDecision(
      payloadWith({
        aiRetrieval: { ...INSUFFICIENT.aiRetrieval!, state: 'inferred' },
        decision: null,
      }),
      '03',
    );
    expect(html).toContain('Inferred from public evidence');
    expect(html).not.toContain('Not measured');
  });

  it('uses the canonical dossier vocabulary, not a parallel design language', () => {
    const html = renderGeoEvidenceDecision(payloadWith(INSUFFICIENT), '03');
    expect(html).toContain('ds-section');
    expect(html).toContain('ds-framing');
    expect(html).toContain('ds-playbook-group');
  });

  it('is actually emitted by the canonical export, not merely defined', () => {
    // Acceptance A: a renderer nothing calls is invisible to the customer. Source-level,
    // because a full renderExportHtml payload is a fixture this focused suite should not own
    // -- the end-to-end render is covered by the Report 1 regression suites.
    const fs = require('fs');
    const path = require('path');
    const output = fs.readFileSync(
      path.join(process.cwd(), 'backend/services/intelligence/exportRendererOutput.ts'),
      'utf8',
    );
    expect(output).toContain('renderGeoEvidenceDecision,');
    expect(output).toContain('${renderGeoEvidenceDecision(payload, EYEBROW_EVIDENCE)}');
  });

  it('invokes no legacy renderer', () => {
    // The legacy family is deleted; this asserts the module graph stays that way.
    const source = require('fs').readFileSync(
      require('path').join(process.cwd(), 'backend/services/intelligence/exportRendererReport1.ts'),
      'utf8',
    );
    expect(source).not.toContain('reportHtmlSections');
    expect(source).not.toContain('reportPdfRenderer');
  });
});

/**
 * Report 1 - WP-13 DEFECT #6: an unobserved authority baseline must not be published as a
 * measured comparative gap.
 *
 * `competitor_positioning_radar.user.authority_score` is the FLATTENED wire shape. Its producer
 * (`buildCompetitorVisuals`, competitorSummaryHelpers.ts) writes
 * `userAxisValues.authority_score ?? 0` - deliberately, because widening the persisted shape is
 * out of scope (WP13_NULL_CONTRACT_DECISION 3.7/D8) - and the view mapper
 * (`reportViewSectionBuilders.ts`) reads it back with `Number(... ?? 0)`. A persisted 0 is
 * therefore indistinguishable, ON ITS OWN, from "the company's authority was never observed".
 *
 * `renderSection7BacklinkAuthority` subtracted that flattened baseline from the competitors'
 * average and rendered the difference to the customer under the label
 * "Authority Gap Vs Competitors" - i.e. it showed the competitors' full average as if it were a
 * measured gap.
 *
 * The distinguishing evidence is the company's own authority axis, in the same payload:
 * `seo_capability_radar.backlinks_score` is null exactly when no authority decision was measured
 * (`visualIntelligenceHelpers.ts` requires `authorityState === 'measured'`), and the sibling
 * `data_source_strength.backlinks_score` availability tag says so too.
 *
 * ZERO IS NOT THE TEST. A genuinely measured authority of 0 is a real score and must still
 * produce a gap - pinned by B below, which is the guard against a "fix" by `=== 0`.
 *
 * Every assertion here is on the rendered customer-facing HTML of section 7, not on an internal
 * variable.
 */
import { renderSection7BacklinkAuthority } from '../../services/export/reportHtmlSectionsExtended';
import { collectMasterActions } from '../../services/export/reportHtmlActionDataHelpers';
import { buildTemplateVariables } from '../../services/export/reportHtmlTemplateVariables';
import type { PdfReportPayload } from '../../services/export/pdf/pdfTypes';

// -- Fixtures ----------------------------------------------------------------

const BASE_PAYLOAD = {
  domain: 'example.com',
  title: 'SEO Snapshot Report',
  reportType: 'snapshot',
  generatedDate: 'Apr 2, 2026',
  diagnosis: 'Clear diagnosis text.',
  summary: 'Compact summary text.',
  topPriorities: [],
  insights: [],
  nextSteps: [],
};

type RadarAxes = {
  content_score: number;
  keyword_coverage_score: number;
  authority_score: number;
  technical_score: number;
  ai_answer_presence_score: number;
};

function axes(authority: number): RadarAxes {
  return {
    content_score: 50,
    keyword_coverage_score: 50,
    authority_score: authority,
    technical_score: 50,
    ai_answer_presence_score: 50,
  };
}

/**
 * companyBacklinksScore - the company's own authority axis; `null` means UNOBSERVED.
 * backlinkStrength      - the sibling availability tag on the same axis.
 * persistedUserAuthority- what the flattened radar wire shape actually carries.
 * competitorAuthorities - the competitor side (untouched by this fix).
 */
function sectionPayload(params: {
  companyBacklinksScore: number | null;
  backlinkStrength: 'strong' | 'inferred' | 'weak' | 'missing';
  persistedUserAuthority: number;
  competitorAuthorities: number[];
}): PdfReportPayload {
  return {
    ...BASE_PAYLOAD,
    seoVisuals: {
      seoCapabilityRadar: {
        technical_seo_score: 50,
        keyword_research_score: 50,
        rank_tracking_score: 50,
        backlinks_score: params.companyBacklinksScore,
        competitor_intelligence_score: 50,
        content_quality_score: 50,
        confidence: 'medium',
        data_source_strength: {
          technical_seo_score: 'inferred',
          keyword_research_score: 'inferred',
          rank_tracking_score: 'inferred',
          backlinks_score: params.backlinkStrength,
          competitor_intelligence_score: 'inferred',
          content_quality_score: 'inferred',
        },
        source_tags: { backlinks_score: ['backlink_signals'] },
        tooltips: {},
        insightSentence: 'Radar insight sentence.',
      },
      opportunityCoverageMatrix: { opportunities: [], confidence: 'low', insightSentence: '' },
      searchVisibilityFunnel: {
        impressions: null,
        clicks: null,
        ctr: null,
        estimated_lost_clicks: null,
        confidence: 'low',
        insightSentence: '',
      },
      crawlHealthBreakdown: {
        metadata_issues: null,
        structure_issues: null,
        internal_link_issues: null,
        crawl_depth_issues: null,
        confidence: 'low',
        tooltips: {},
        insightSentence: '',
      },
      confidence: 'medium',
    },
    competitorVisuals: {
      competitorPositioningRadar: {
        competitors: params.competitorAuthorities.map((authority, index) => ({
          name: 'competitor-' + String(index + 1) + '.com',
          ...axes(authority),
        })),
        user: axes(params.persistedUserAuthority),
        confidence: 'medium',
      },
      keywordGapAnalysis: { missing_keywords: [], weak_keywords: [], strong_keywords: [], confidence: 'low' },
      aiAnswerGapAnalysis: { missing_answers: [], weak_answers: [], strong_answers: [], confidence: 'low' },
      confidence: 'medium',
    },
  } as unknown as PdfReportPayload;
}

function renderSection(payload: PdfReportPayload): string {
  return renderSection7BacklinkAuthority(payload, buildTemplateVariables(payload), collectMasterActions(payload));
}

const AUTHORITY_GAP_LABEL = 'Authority Gap Vs Competitors';

/**
 * The exact customer-facing cell, read out of the rendered HTML.
 *
 * It THROWS when the cell is absent, so no assertion below can pass vacuously against a
 * renderer that silently stopped emitting the card or renamed the label.
 */
function authorityGapCell(html: string): { cls: string; text: string } {
  const pattern = new RegExp(
    '<div class="label">' + AUTHORITY_GAP_LABEL + '</div><div class="(score-missing|score-med)">([^<]*)</div>',
  );
  const match = pattern.exec(html);
  if (!match) {
    throw new Error('No "' + AUTHORITY_GAP_LABEL + '" cell in the rendered section-7 HTML - the match set is empty.');
  }
  return { cls: match[1], text: match[2] };
}

// -- Non-vacuity -------------------------------------------------------------

describe('WP-13 #6 - the assertions below read a cell that really exists', () => {
  it('the rendered section carries exactly one Authority Gap Vs Competitors cell when the card is shown', () => {
    const html = renderSection(sectionPayload({
      companyBacklinksScore: 40,
      backlinkStrength: 'inferred',
      persistedUserAuthority: 40,
      competitorAuthorities: [80, 70],
    }));
    const occurrences = html.split(AUTHORITY_GAP_LABEL).length - 1;
    expect(occurrences).toBe(1);
    expect(() => authorityGapCell(html)).not.toThrow();
    expect(html).toContain('id="section-7"');
  });
});

// -- A. Unobserved authority abstains ----------------------------------------

describe('WP-13 #6 - A: an unobserved company authority abstains', () => {
  it('A1: a persisted 0 with no observed authority axis does NOT publish the competitors average as a gap', () => {
    // Competitors average 75. The company was never observed on authority (backlinks_score is
    // null, the producer's documented steady state), yet the flattened wire shape persists 0.
    // The defect rendered 75 - 0 = 75 to the customer as a measured gap.
    const html = renderSection(sectionPayload({
      companyBacklinksScore: null,
      backlinkStrength: 'inferred',
      persistedUserAuthority: 0,
      competitorAuthorities: [80, 70],
    }));

    const cell = authorityGapCell(html);
    expect(cell.text).toBe('Not Available');
    expect(cell.cls).toBe('score-missing');
    expect(cell.text).not.toBe('75/100');
    expect(html).not.toContain(AUTHORITY_GAP_LABEL + '</div><div class="score-med">');
    expect(html).not.toContain('75/100');
  });

  it('A2: when the availability tag itself says missing the section states the absence and names no gap number', () => {
    const html = renderSection(sectionPayload({
      companyBacklinksScore: null,
      backlinkStrength: 'missing',
      persistedUserAuthority: 0,
      competitorAuthorities: [80, 70],
    }));

    expect(html).toContain('Authority signals are still being monitored');
    expect(html).not.toContain(AUTHORITY_GAP_LABEL);
    expect(html).not.toContain('75/100');
  });
});

// -- B. Observed zero remains valid (the anti-`=== 0` guard) -----------------

describe('WP-13 #6 - B: a genuinely measured zero is still a measurement', () => {
  it('B: an OBSERVED authority of 0 still produces the full gap', () => {
    const html = renderSection(sectionPayload({
      companyBacklinksScore: 0,
      backlinkStrength: 'inferred',
      persistedUserAuthority: 0,
      competitorAuthorities: [80, 70],
    }));

    const cell = authorityGapCell(html);
    expect(cell.text).toBe('75/100');
    expect(cell.cls).toBe('score-med');
    expect(cell.text).not.toBe('Not Available');
  });
});

// -- C / D. Behaviour that must not change -----------------------------------

describe('WP-13 #6 - C/D: untouched behaviour', () => {
  it('C: an observed non-zero authority keeps the existing calculation', () => {
    const html = renderSection(sectionPayload({
      companyBacklinksScore: 40,
      backlinkStrength: 'inferred',
      persistedUserAuthority: 40,
      competitorAuthorities: [80, 70],
    }));

    const cell = authorityGapCell(html);
    expect(cell.text).toBe('35/100');
    expect(cell.cls).toBe('score-med');
  });

  it('C2: a STRONG availability tag is displayable on exactly the same terms', () => {
    const html = renderSection(sectionPayload({
      companyBacklinksScore: 40,
      backlinkStrength: 'strong',
      persistedUserAuthority: 40,
      competitorAuthorities: [80, 70],
    }));

    expect(authorityGapCell(html).text).toBe('35/100');
  });

  it('D: with no competitors the existing null path is preserved', () => {
    const html = renderSection(sectionPayload({
      companyBacklinksScore: 40,
      backlinkStrength: 'inferred',
      persistedUserAuthority: 40,
      competitorAuthorities: [],
    }));

    const cell = authorityGapCell(html);
    expect(cell.text).toBe('Not Available');
    expect(cell.cls).toBe('score-missing');
  });
});

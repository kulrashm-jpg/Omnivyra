/**
 * Digital Experience intelligence (Phase 4).
 *
 * Answers the question Report 1 could not previously answer: *is this website helping or
 * obstructing a potential customer's ability to discover, understand and act?*
 *
 * Deliberately NOT another 0–100 score. There is no defensible benchmark for "digital
 * experience", so inventing one would be exactly the false precision earlier phases removed.
 * Instead this produces a READINESS CLASSIFICATION per pillar plus specific, evidence-linked
 * findings — what is wrong, why it matters, what to fix.
 *
 * Every finding is derived from evidence Omnivyra already holds: `canonical_pages` (url,
 * page_type, title, meta, headings, ctas, internal_link_count, http_status, crawl_depth),
 * `crawl_metadata.signals` (forms, images/alt, author, jsonld) and `page_content` blocks.
 * Performance evidence is injected from the PageSpeed provider when available.
 *
 * TWO BOUNDARIES ARE STRUCTURAL:
 *
 *  1. This describes the OBSERVED WEBSITE, never OBSERVED VISITORS. It cannot and does not
 *     claim bounce, drop-off, friction experienced, or conversion rate. Those require
 *     visitor-level evidence and belong to Report 2.
 *  2. A static crawl cannot see client-rendered content. Where the evidence suggests the site
 *     depends on JavaScript rendering, that is reported as an EVIDENCE LIMITATION, not as a
 *     diagnosis of thin content.
 */
import type { ScoreState } from './snapshotReport/canonicalScoreState';
import type { PerformanceEvidence, PerformanceVerdict } from './performanceEvidence';

export type ExperiencePillar =
  | 'information_accessibility'
  | 'value_communication'
  | 'conversion_readiness'
  | 'technical_friction';

/** Evidence-backed readiness, not a score. */
export type ExperienceReadiness = 'ready' | 'partial' | 'obstructed' | 'insufficient_evidence';

export interface ExperienceFinding {
  pillar: ExperiencePillar;
  /** What is wrong. */
  problem: string;
  /** The observation that establishes it — always counts or URLs, never an adjective. */
  evidence: string;
  /** Why a marketing leader should care. Never a quantified revenue or lead claim. */
  whyItMatters: string;
  /** What to do. */
  action: string;
  severity: 'critical' | 'moderate' | 'low';
  effort: 'low' | 'medium' | 'high';
  /** How to confirm the fix worked. */
  measurement: string;
}

export interface PillarAssessment {
  pillar: ExperiencePillar;
  label: string;
  readiness: ExperienceReadiness;
  state: ScoreState;
  /** Signals that could be evaluated / total signals for this pillar. */
  coverage: { evaluated: number; total: number };
  findings: ExperienceFinding[];
}

export interface EvidenceLimitation {
  kind: 'client_side_rendering' | 'no_crawl' | 'shallow_crawl' | 'performance_unavailable';
  message: string;
  affects: ExperiencePillar[];
}

export interface DigitalExperienceResult {
  readiness: ExperienceReadiness;
  pillars: PillarAssessment[];
  findings: ExperienceFinding[];
  limitations: EvidenceLimitation[];
  coverage: { pagesEvaluated: number; signalsEvaluated: number; signalsTotal: number };
  state: ScoreState;
  /** Explicit marker: this describes the site, not its visitors. */
  describesVisitorBehavior: false;
}

export interface ExperiencePage {
  url: string;
  page_type?: string | null;
  title?: string | null;
  meta_description?: string | null;
  headings?: Array<{ level?: number; text?: string }> | null;
  ctas?: Array<{ text?: string; href?: string | null }> | null;
  internal_link_count?: number | null;
  http_status?: number | null;
  crawl_depth?: number | null;
  wordCount?: number | null;
  crawl_metadata?: { signals?: { form_count?: number; img_count?: number; img_with_alt?: number } } | null;
}

const PILLAR_LABEL: Record<ExperiencePillar, string> = {
  information_accessibility: 'Information accessibility',
  value_communication: 'Value communication',
  conversion_readiness: 'Conversion readiness',
  technical_friction: 'Technical friction',
};

/**
 * Depth beyond which a page is materially harder to reach. Three clicks is the long-standing
 * information-architecture convention and is ALREADY the threshold used by the existing
 * `technicalIntelligenceEngine.page_depth` check — reused rather than a second cutoff.
 */
const DEEP_PAGE_CLICKS = 3;

/**
 * Word count below which a page carries too little text to communicate anything. 150 words is
 * the conventional "thin content" floor; it is also low enough that a genuinely concise page
 * clears it, so it flags emptiness rather than brevity.
 */
const THIN_PAGE_WORDS = 150;

/** Action verbs used by the existing content engine — reused so CTA judgement stays consistent. */
const ACTION_VERBS = ['get', 'start', 'try', 'book', 'request', 'buy', 'subscribe', 'sign up', 'download', 'contact', 'schedule', 'demo', 'free'];

const matches = (page: ExperiencePage, keywords: string[]): boolean => {
  const hay = `${page.url ?? ''} ${page.title ?? ''} ${page.page_type ?? ''}`.toLowerCase();
  return keywords.some((k) => hay.includes(k));
};

function readinessFrom(findings: ExperienceFinding[], evaluated: number): ExperienceReadiness {
  if (evaluated === 0) return 'insufficient_evidence';
  if (findings.some((f) => f.severity === 'critical')) return 'obstructed';
  if (findings.length > 0) return 'partial';
  return 'ready';
}

/**
 * Detect probable client-side rendering.
 *
 * Signal: pages returned HTTP 200 but carry almost no extractable text AND almost no
 * headings. A server-rendered page with real content produces both; an SPA shell produces
 * neither. This is deliberately conservative — it requires the pattern across a MAJORITY of
 * pages, because one thin page is a thin page, not a rendering architecture.
 *
 * The output is an evidence limitation, never a content diagnosis.
 */
export function detectClientSideRendering(pages: readonly ExperiencePage[]): boolean {
  const ok = pages.filter((p) => (p.http_status ?? 200) === 200);
  if (ok.length < 3) return false;
  const shells = ok.filter((p) => {
    const words = Number(p.wordCount ?? 0);
    const headings = (p.headings ?? []).length;
    return words < 50 && headings <= 1;
  });
  return shells.length / ok.length >= 0.6;
}

/**
 * Assess digital experience from crawl evidence plus optional performance evidence.
 * Pure and deterministic. Never throws; no pages yields honest abstention.
 */
export function assessDigitalExperience(params: {
  pages: readonly ExperiencePage[];
  performance?: PerformanceEvidence | null;
}): DigitalExperienceResult {
  const pages = [...(params.pages ?? [])];
  const limitations: EvidenceLimitation[] = [];
  const n = pages.length;

  if (n === 0) {
    return {
      readiness: 'insufficient_evidence',
      pillars: (Object.keys(PILLAR_LABEL) as ExperiencePillar[]).map((pillar) => ({
        pillar, label: PILLAR_LABEL[pillar], readiness: 'insufficient_evidence',
        state: 'unavailable', coverage: { evaluated: 0, total: 0 }, findings: [],
      })),
      findings: [],
      limitations: [{
        kind: 'no_crawl',
        message: 'No pages have been crawled for this domain, so the website experience cannot be assessed. Run the website scan and regenerate.',
        affects: ['information_accessibility', 'value_communication', 'conversion_readiness', 'technical_friction'],
      }],
      coverage: { pagesEvaluated: 0, signalsEvaluated: 0, signalsTotal: 0 },
      state: 'unavailable',
      describesVisitorBehavior: false,
    };
  }

  const csr = detectClientSideRendering(pages);
  if (csr) {
    limitations.push({
      kind: 'client_side_rendering',
      message: 'Limited evidence — this site appears to rely on client-side rendering, so the static crawl may not expose the complete page experience. Content and conversion findings below describe only what is present in the served HTML.',
      affects: ['information_accessibility', 'value_communication', 'conversion_readiness'],
    });
  }

  const findings: ExperienceFinding[] = [];
  const add = (f: ExperienceFinding) => findings.push(f);

  // ── Information accessibility ───────────────────────────────────────────────
  let iaEvaluated = 0;
  const deep = pages.filter((p) => Number(p.crawl_depth ?? 0) > DEEP_PAGE_CLICKS);
  iaEvaluated += 1;
  if (deep.length > 0) {
    add({
      pillar: 'information_accessibility',
      problem: 'Important pages sit deeper than three clicks from the home page',
      evidence: `${deep.length} of ${n} crawled pages are more than ${DEEP_PAGE_CLICKS} clicks deep (e.g. ${deep.slice(0, 2).map((p) => p.url).join(', ')})`,
      whyItMatters: 'Pages that are hard to reach are discovered less often by both visitors and crawlers, so the work already invested in them under-returns.',
      action: 'Add internal links from the home page and primary navigation to the pages that should be found.',
      severity: deep.length / n > 0.3 ? 'critical' : 'moderate',
      effort: 'low',
      measurement: 'Re-crawl and confirm those URLs report a crawl depth of 3 or less.',
    });
  }

  const orphans = pages.filter((p) => Number(p.internal_link_count ?? 0) === 0 && (p.http_status ?? 200) === 200);
  iaEvaluated += 1;
  if (orphans.length > 0) {
    add({
      pillar: 'information_accessibility',
      problem: 'Some pages are dead ends with no outbound internal links',
      evidence: `${orphans.length} of ${n} pages contain no internal links (e.g. ${orphans.slice(0, 2).map((p) => p.url).join(', ')})`,
      whyItMatters: 'A page with no onward path ends the visit there — the visitor has nowhere to go next even if they are interested.',
      action: 'Add contextual links from those pages to the related product, proof or contact pages.',
      severity: 'moderate', effort: 'low',
      measurement: 'Re-crawl and confirm each page reports at least one internal link.',
    });
  }

  const broken = pages.filter((p) => Number(p.http_status ?? 200) >= 400);
  iaEvaluated += 1;
  if (broken.length > 0) {
    add({
      pillar: 'information_accessibility',
      problem: 'Pages return errors',
      evidence: `${broken.length} of ${n} crawled pages returned 4xx/5xx (e.g. ${broken.slice(0, 2).map((p) => `${p.url} → ${p.http_status}`).join(', ')})`,
      whyItMatters: 'A broken page is a hard stop for anyone who reaches it, and it wastes the link and search equity pointing at it.',
      action: 'Fix or redirect each failing URL to the closest working equivalent.',
      severity: 'critical', effort: 'low',
      measurement: 'Re-crawl and confirm those URLs return HTTP 200 or a single 301 to a working page.',
    });
  }

  // ── Value communication ─────────────────────────────────────────────────────
  let vcEvaluated = 0;
  const home = pages.find((p) => matches(p, ['home']) || /^https?:\/\/[^/]+\/?$/.test(p.url ?? ''));
  vcEvaluated += 1;
  if (home) {
    const homeH1 = (home.headings ?? []).some((h) => Number(h?.level) === 1);
    const homeWords = Number(home.wordCount ?? 0);
    if (!homeH1 || homeWords < THIN_PAGE_WORDS) {
      add({
        pillar: 'value_communication',
        problem: 'The home page does not clearly state what the company does',
        evidence: `Home page ${homeH1 ? 'has an H1' : 'has NO H1 heading'} and carries ${homeWords} words of extractable copy`,
        whyItMatters: 'A visitor who cannot tell what is offered within a few seconds has no reason to continue, and answer engines have nothing definitive to extract.',
        action: 'Lead with a headline that names the offering and the customer, followed by a short supporting paragraph.',
        severity: !homeH1 ? 'critical' : 'moderate', effort: 'low',
        measurement: 'Re-crawl and confirm the home page exposes an H1 and at least 150 words.',
      });
    }
  }

  const thin = pages.filter((p) => (p.http_status ?? 200) === 200 && Number(p.wordCount ?? 0) < THIN_PAGE_WORDS);
  vcEvaluated += 1;
  // Suppressed when client-side rendering is suspected — thin HTML is then an evidence
  // limitation, already reported above, not a content finding.
  if (thin.length > 0 && !csr) {
    add({
      pillar: 'value_communication',
      problem: 'Pages carry too little content to explain the offering',
      evidence: `${thin.length} of ${n} pages have under ${THIN_PAGE_WORDS} words (e.g. ${thin.slice(0, 2).map((p) => p.url).join(', ')})`,
      whyItMatters: 'Thin pages neither answer a buyer question nor give search and answer engines enough to work with.',
      action: 'Expand the thin pages that matter commercially; consolidate or remove the ones that do not.',
      severity: thin.length / n > 0.5 ? 'critical' : 'moderate', effort: 'medium',
      measurement: 'Re-crawl and confirm the prioritised pages exceed 150 words.',
    });
  }

  const noMeta = pages.filter((p) => !p.title || !p.meta_description);
  vcEvaluated += 1;
  if (noMeta.length > 0) {
    add({
      pillar: 'value_communication',
      problem: 'Pages are missing a title or meta description',
      evidence: `${noMeta.length} of ${n} pages lack a title or meta description`,
      whyItMatters: 'These are the words a person reads in search results before deciding whether to click; without them the listing is generated for you.',
      action: 'Write a specific title and description for each affected page.',
      severity: noMeta.length / n > 0.5 ? 'moderate' : 'low', effort: 'low',
      measurement: 'Re-crawl and confirm every indexable page has both.',
    });
  }

  // ── Conversion readiness ────────────────────────────────────────────────────
  let crEvaluated = 0;
  const withCta = pages.filter((p) => (p.ctas ?? []).length > 0);
  crEvaluated += 1;
  if (withCta.length / n < 0.5) {
    add({
      pillar: 'conversion_readiness',
      problem: 'Most pages offer no clear next step',
      evidence: `Only ${withCta.length} of ${n} pages expose a call to action`,
      whyItMatters: 'A visitor who is convinced still needs somewhere to go; a page without a next step relies on them finding one themselves.',
      action: 'Add a single primary call to action to each commercially relevant page.',
      severity: withCta.length === 0 ? 'critical' : 'moderate', effort: 'low',
      measurement: 'Re-crawl and confirm CTA coverage above 50% of pages.',
    });
  }

  const ctaTexts = pages.flatMap((p) => (p.ctas ?? []).map((c) => String(c?.text ?? '').toLowerCase().trim())).filter(Boolean);
  crEvaluated += 1;
  if (ctaTexts.length > 0) {
    const actionable = ctaTexts.filter((t) => ACTION_VERBS.some((v) => t.includes(v)));
    if (actionable.length / ctaTexts.length < 0.5) {
      add({
        pillar: 'conversion_readiness',
        problem: 'Call-to-action wording does not say what happens next',
        evidence: `${actionable.length} of ${ctaTexts.length} CTAs use action language`,
        whyItMatters: 'Vague labels make the next step feel uncertain, which is friction the page does not need.',
        action: 'Rewrite CTAs to name the action and the outcome, e.g. "Book a demo" rather than "Learn more".',
        severity: 'moderate', effort: 'low',
        measurement: 'Re-crawl and confirm the majority of CTA labels use an action verb.',
      });
    }
  }

  const contactable = pages.some((p) => matches(p, ['contact', 'demo', 'book', 'signup', 'sign-up', 'trial', 'quote', 'pricing']));
  const anyForm = pages.some((p) => Number(p.crawl_metadata?.signals?.form_count ?? 0) > 0);
  crEvaluated += 1;
  if (!contactable && !anyForm) {
    add({
      pillar: 'conversion_readiness',
      problem: 'No conversion path is discoverable from the crawled pages',
      evidence: `No contact, demo, trial, quote or pricing page was found across ${n} pages, and no on-page form was detected`,
      whyItMatters: 'Without a visible way to make contact, interest generated elsewhere has nowhere to land.',
      action: 'Publish a contact or demo path and link it from the primary navigation.',
      severity: 'critical', effort: 'low',
      measurement: 'Re-crawl and confirm a reachable contact or demo page.',
    });
  }

  // ── Technical friction (incl. performance) ──────────────────────────────────
  let tfEvaluated = 0;
  const perf = params.performance ?? null;
  if (perf && perf.state === 'measured') {
    tfEvaluated += 1;
    for (const factor of ['mobile', 'desktop'] as const) {
      const summary = perf.byFormFactor[factor];
      if (summary.measured === 0) continue;
      const bad = perf.observations
        .filter((o) => o.formFactor === factor && o.state === 'measured')
        .flatMap((o) => o.metrics.filter((m) => m.state === 'measured' && (m.verdict === 'poor' || m.verdict === 'needs_improvement'))
          .map((m) => ({ url: o.url, metric: m })));
      if (bad.length === 0) continue;
      const worst = bad.filter((b) => b.metric.verdict === 'poor');
      const focus = (worst.length ? worst : bad)[0];
      add({
        pillar: 'technical_friction',
        problem: `${focus.metric.label} is ${focus.metric.verdict === 'poor' ? 'poor' : 'below the recommended threshold'} on ${factor}`,
        evidence: `${focus.metric.label} measured at ${focus.metric.value}${focus.metric.unit === 'ms' ? 'ms' : ''} on ${focus.url} (${factor}, ${focus.metric.source === 'crux_field' ? 'real-user field data' : 'lab measurement'}); Google's threshold for "good" is ${focus.metric.threshold?.good}${focus.metric.unit === 'ms' ? 'ms' : ''}. ${bad.length} measured metric(s) fall short across ${summary.measured} page measurement(s).`,
        whyItMatters: focus.metric.key === 'CLS'
          ? 'Content moving as the page loads makes the page feel unstable and can cause mis-taps, particularly on mobile.'
          : 'Important page content becomes visible slowly, which adds friction before a visitor can understand the offering.',
        action: focus.metric.key === 'LCP'
          ? 'Optimise delivery and rendering of the largest content element — usually the hero image or headline block.'
          : focus.metric.key === 'CLS'
            ? 'Reserve explicit dimensions for images, embeds and injected banners so layout does not shift.'
            : focus.metric.key === 'TTFB'
              ? 'Reduce server response time through caching or a faster origin.'
              : 'Reduce render-blocking resources and main-thread work on the affected pages.',
        severity: focus.metric.verdict === 'poor' ? 'critical' : 'moderate',
        effort: 'medium',
        measurement: `Re-run PageSpeed Insights for ${focus.url} on ${factor} and confirm ${focus.metric.label} at or below ${focus.metric.threshold?.good}${focus.metric.unit === 'ms' ? 'ms' : ''}.`,
      });
    }
  } else {
    limitations.push({
      kind: 'performance_unavailable',
      message: perf?.reasonUnavailable
        ?? 'Performance evidence is unavailable, so page-speed experience could not be assessed.',
      affects: ['technical_friction'],
    });
  }

  const byPillar = (pillar: ExperiencePillar) => findings.filter((f) => f.pillar === pillar);
  const evaluatedFor: Record<ExperiencePillar, number> = {
    information_accessibility: iaEvaluated,
    value_communication: vcEvaluated,
    conversion_readiness: crEvaluated,
    technical_friction: tfEvaluated,
  };
  const totalFor: Record<ExperiencePillar, number> = {
    information_accessibility: 3, value_communication: 3, conversion_readiness: 3, technical_friction: 1,
  };

  const pillars: PillarAssessment[] = (Object.keys(PILLAR_LABEL) as ExperiencePillar[]).map((pillar) => {
    const evaluated = evaluatedFor[pillar];
    return {
      pillar,
      label: PILLAR_LABEL[pillar],
      readiness: readinessFrom(byPillar(pillar), evaluated),
      state: evaluated === 0 ? 'unavailable' : 'measured',
      coverage: { evaluated, total: totalFor[pillar] },
      findings: byPillar(pillar),
    };
  });

  const assessed = pillars.filter((p) => p.readiness !== 'insufficient_evidence');
  const overall: ExperienceReadiness = assessed.length === 0
    ? 'insufficient_evidence'
    : assessed.some((p) => p.readiness === 'obstructed')
      ? 'obstructed'
      : assessed.some((p) => p.readiness === 'partial')
        ? 'partial'
        : 'ready';

  return {
    readiness: overall,
    pillars,
    findings,
    limitations,
    coverage: {
      pagesEvaluated: n,
      signalsEvaluated: Object.values(evaluatedFor).reduce((a, b) => a + b, 0),
      signalsTotal: Object.values(totalFor).reduce((a, b) => a + b, 0),
    },
    state: assessed.length === 0 ? 'unavailable' : 'measured',
    describesVisitorBehavior: false,
  };
}

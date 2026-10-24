/**
 * Creator Diagnostic Report — deterministic, READ-ONLY inspection artifact.
 *
 * Assembles a structured explanation of exactly what happened during a Creator
 * generation from signals OTHER layers already produced (context assembly,
 * content validation, render metadata, visual validation). It NEVER changes
 * generation, rendering, or content. Pure + deterministic. Attached to
 * generation metadata; shaped for future Creator UI display.
 */

import type { CopyViolation } from './creatorCopyValidation';
import type { VisualFailure } from './creatorVisualValidation';

/** Readiness at or above this value passes; a visual failure caps readiness below it. */
export const READINESS_PASS_THRESHOLD = 60;

type Rec = Record<string, unknown>;

function obj(v: unknown): Rec {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {};
}
function nonEmpty(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export interface DiagnosticScore {
  value: number;
  reason: string;
}

export interface CreatorDiagnosticReport {
  reportVersion: string;
  generatedAt?: string;
  generation: {
    assetType: string;
    contentType?: string;
    platform?: string;
    companyId?: string;
    durationMs?: number;
  };
  context: {
    sourcesUsed: string[];
    companyFacets: string[];
    brandFacets: string[];
  };
  template: {
    id?: string;
    name?: string;
    version?: number;
    assetFamily?: string;
    renderingContractVersion?: string;
  };
  contentValidation: {
    forbiddenWordsRepaired: number;
    prohibitedClaimsRemoved: number;
    ctaNormalized: number;
    fabricatedClaimsRemoved: number;
    missingRequiredTerms: string[];
    warnings: string[];
  };
  rendering: {
    width?: number;
    height?: number;
    platform?: string;
    typographyProfile?: string;
    layoutProfile?: string;
    brandingProfile?: string;
  };
  visualValidation: {
    passed: boolean;
    /**
     * false when the render carried NO visual verdict (async render still
     * pending, placeholder). `passed` stays true for back-compat, but a
     * publish gate must treat an unassessed asset as NOT ready.
     */
    assessed: boolean;
    checks: Record<string, 'PASS' | 'FAIL' | 'N/A'>;
    slideCount?: number;
    failures: VisualFailure[];
  };
  repair: {
    occurred: boolean;
    type?: string;
    reasons: string[];
    count: number;
    reRendered: boolean;
    /** Fix-loop re-renders performed (0 when none). */
    attempts: number;
    /** Steps the fix loop applied, in order. */
    steps: string[];
  };
  scores: {
    contentQuality: DiagnosticScore;
    brandCompliance: DiagnosticScore;
    visualQuality: DiagnosticScore;
    readability: DiagnosticScore;
    templateCompliance: DiagnosticScore;
    overallReadiness: DiagnosticScore;
  };
}

export const CREATOR_DIAGNOSTIC_REPORT_VERSION = 'creator-diagnostic-v1';

const COMPANY_FACET_LABELS: Array<[string, string]> = [
  ['description', 'Company Profile'],
  ['products', 'Products'],
  ['audience', 'Audience'],
  ['positioning', 'Positioning'],
  ['differentiators', 'Differentiators'],
  ['industries', 'Industries'],
  ['businessObjectives', 'Business Objectives'],
  ['messagingPillars', 'Messaging Pillars'],
  ['icp', 'ICP'],
];
const BRAND_FACET_LABELS: Array<[string, string]> = [
  ['tone', 'Brand Voice'],
  ['descriptors', 'Brand Personality'],
  ['ctaStyle', 'CTA Style'],
  ['requiredTerms', 'Preferred Vocabulary'],
  ['prohibitedPhrases', 'Forbidden Words'],
  ['prohibitedClaims', 'Compliance'],
];

export interface DiagnosticReportInput {
  assetType: string;
  contentType?: string;
  platform?: string;
  companyId?: string;
  durationMs?: number;
  generatedAt?: string;
  template?: { id?: string; name?: string; version?: number; assetFamily?: string; renderingContractVersion?: string };
  companyContext?: Rec;
  brandVoice?: Rec;
  contentViolations?: CopyViolation[];
  /** The rendered asset's media_bundle.metadata (visual_validation, dimensions, profiles). */
  renderMetadata?: Rec;
}

export function buildCreatorDiagnosticReport(input: DiagnosticReportInput): CreatorDiagnosticReport {
  const meta = obj(input.renderMetadata);

  /* ── Context summary (which canonical sources had data) ── */
  const companyFacets = COMPANY_FACET_LABELS.filter(([k]) => nonEmpty(obj(input.companyContext)[k])).map(([, label]) => label);
  const brandFacets = BRAND_FACET_LABELS.filter(([k]) => nonEmpty(obj(input.brandVoice)[k])).map(([, label]) => label);
  const sourcesUsed = Array.from(new Set([...companyFacets, ...brandFacets]));

  /* ── Content validation summary ── */
  const v = Array.isArray(input.contentViolations) ? input.contentViolations : [];
  const count = (t: string) => v.filter((x) => x.type === t).length;
  const contentValidation = {
    forbiddenWordsRepaired: count('forbidden_phrase'),
    prohibitedClaimsRemoved: count('prohibited_claim'),
    ctaNormalized: count('banned_cta'),
    fabricatedClaimsRemoved: count('fabricated_claim'),
    missingRequiredTerms: v.filter((x) => x.type === 'missing_required_term').map((x) => x.detail),
    warnings: v.filter((x) => x.type === 'emptied_by_repair').map((x) => `repair emptied: ${x.detail}`),
  };

  /* ── Rendering summary ── */
  const platformProfile = obj(meta.platform_visual_profile);
  const rendering = {
    width: typeof meta.width === 'number' ? meta.width : undefined,
    height: typeof meta.height === 'number' ? meta.height : undefined,
    platform: typeof meta.platform === 'string' ? meta.platform : input.platform,
    typographyProfile: typeof platformProfile.preferredTypographyScale === 'string' ? String(platformProfile.preferredTypographyScale) : undefined,
    layoutProfile: typeof obj(meta.overlay_quality).preset === 'string' ? String(obj(meta.overlay_quality).preset) : undefined,
    brandingProfile: typeof meta.brand_emphasis === 'string' ? String(meta.brand_emphasis)
      : (Array.isArray(obj(meta.overlay_quality).flags) && (obj(meta.overlay_quality).flags as string[]).includes('no_brand_mark') ? 'no_brand_mark' : undefined),
  };

  /* ── Visual validation summary ── */
  const vv = obj(meta.visual_validation);
  const failures: VisualFailure[] = Array.isArray(vv.failures) ? (vv.failures as VisualFailure[]) : [];
  const cats = new Set(failures.map((f) => f.category));
  const isInfographic = String(input.assetType).toLowerCase() === 'infographic';
  const isCarousel = ['carousel', 'slider', 'pdf'].includes(String(input.assetType).toLowerCase());
  const mark = (fail: boolean, applicable = true): 'PASS' | 'FAIL' | 'N/A' => (!applicable ? 'N/A' : fail ? 'FAIL' : 'PASS');
  const hasSignals = Array.isArray(vv.failures) || vv.passed != null;
  const visualValidation = {
    passed: vv.passed === true || (!hasSignals ? true : failures.length === 0),
    assessed: hasSignals,
    slideCount: typeof vv.slideCount === 'number' ? vv.slideCount : undefined,
    failures,
    checks: {
      textFit: mark(cats.has('text_fit')),
      overflow: mark(cats.has('text_fit')),
      clipping: mark(cats.has('text_fit')),
      spacing: mark(cats.has('overlap') || cats.has('safe_margins')),
      contrast: mark(cats.has('contrast')),
      typography: mark(cats.has('typography')),
      branding: rendering.brandingProfile === 'no_brand_mark' ? 'N/A' as const : mark(cats.has('branding')),
      infographicDensity: mark(isInfographic && cats.has('text_fit'), isInfographic),
      carouselSlides: mark(isCarousel && failures.some((f) => typeof f.slide === 'number'), isCarousel),
    },
  };

  /* ── Repair summary ── */
  const repairCount = contentValidation.forbiddenWordsRepaired + contentValidation.prohibitedClaimsRemoved
    + contentValidation.ctaNormalized + contentValidation.fabricatedClaimsRemoved;
  // PR4: the fix loop discloses its work on the OUTPUT metadata
  // (visual_validation.repair). `visual_repair_applied` was set on the INPUT
  // payload only, so it never reached here — kept as a legacy fallback.
  const loopRepair = obj(vv.repair);
  const loopAttempts = typeof loopRepair.attempts === 'number' ? Math.max(0, Math.round(loopRepair.attempts)) : 0;
  const loopSteps = Array.isArray(loopRepair.steps) ? loopRepair.steps.map(String) : [];
  const reRendered = loopAttempts > 0 || meta.visual_repair_applied === true;
  const attemptsCount = loopAttempts > 0 ? loopAttempts : (reRendered ? 1 : 0);
  const repair = {
    occurred: repairCount > 0 || reRendered,
    type: reRendered ? 'visual:fix_and_rerender' : (repairCount > 0 ? 'content:vocabulary' : undefined),
    reasons: [
      ...(contentValidation.forbiddenWordsRepaired ? ['forbidden words removed'] : []),
      ...(contentValidation.prohibitedClaimsRemoved ? ['prohibited claims removed'] : []),
      ...(contentValidation.ctaNormalized ? ['CTA normalized'] : []),
      ...(contentValidation.fabricatedClaimsRemoved ? ['fabricated claims removed'] : []),
      ...(reRendered ? [`layout fixed automatically: text shortened + re-rendered (${attemptsCount} attempt${attemptsCount === 1 ? '' : 's'})`] : []),
    ],
    count: repairCount + attemptsCount,
    reRendered,
    attempts: attemptsCount,
    steps: loopSteps,
  };

  /* ── Deterministic scores ── */
  const contentDeductions = contentValidation.forbiddenWordsRepaired * 15
    + contentValidation.prohibitedClaimsRemoved * 20
    + contentValidation.fabricatedClaimsRemoved * 10
    + contentValidation.ctaNormalized * 5;
  const contentQuality: DiagnosticScore = {
    value: clamp(100 - contentDeductions),
    reason: contentDeductions === 0 ? 'No content violations detected.' : `${v.length} content issue(s) repaired/flagged.`,
  };

  const brandViolations = contentValidation.forbiddenWordsRepaired + contentValidation.prohibitedClaimsRemoved + contentValidation.ctaNormalized;
  const brandCompliance: DiagnosticScore = brandFacets.length === 0
    ? { value: 100, reason: 'No brand constraints defined for this company.' }
    : { value: clamp(100 - brandViolations * 20 - contentValidation.missingRequiredTerms.length * 5), reason: brandViolations === 0 ? 'Copy complied with brand voice + compliance rules.' : `${brandViolations} brand/compliance violation(s) repaired.` };

  const visFailCount = failures.length;
  const visualQuality: DiagnosticScore = {
    value: visualValidation.passed ? 100 : clamp(100 - visFailCount * 15),
    reason: visualValidation.passed ? 'All deterministic visual checks passed.' : `${visFailCount} visual check failure(s): ${Array.from(cats).join(', ')}.`,
  };

  const typoFail = (cats.has('typography') ? 1 : 0);
  const contrastFail = (cats.has('contrast') ? 1 : 0);
  const readability: DiagnosticScore = {
    value: clamp(100 - typoFail * 30 - contrastFail * 30 - (cats.has('text_fit') ? 15 : 0)),
    reason: typoFail || contrastFail ? 'Readability reduced by typography/contrast issues.' : 'Type size, spacing, and contrast within readable bounds.',
  };

  const templateCompliance: DiagnosticScore = input.template?.id
    ? { value: input.template.renderingContractVersion ? 100 : 90, reason: `Rendered under template "${input.template.name ?? input.template.id}" v${input.template.version ?? '?'}.` }
    : { value: 70, reason: 'No template selected — generated with default layout.' };

  const overallBase = Math.round(
    contentQuality.value * 0.25 + brandCompliance.value * 0.2 + visualQuality.value * 0.3 + readability.value * 0.15 + templateCompliance.value * 0.1,
  );
  const overallReadiness: DiagnosticScore = {
    // A failed visual check caps readiness BELOW the pass threshold. The cap was
    // 60 while readiness passes at >= 60, so a capped asset still showed
    // "Readiness passed".
    value: visualValidation.passed ? clamp(overallBase) : clamp(Math.min(overallBase, READINESS_PASS_THRESHOLD - 1)),
    reason: visualValidation.passed ? 'Asset passed all deterministic gates.' : 'Readiness capped: one or more visual checks failed.',
  };

  return {
    reportVersion: CREATOR_DIAGNOSTIC_REPORT_VERSION,
    generatedAt: input.generatedAt,
    generation: {
      assetType: input.assetType,
      contentType: input.contentType,
      platform: input.platform,
      companyId: input.companyId,
      durationMs: input.durationMs,
    },
    context: { sourcesUsed, companyFacets, brandFacets },
    template: {
      id: input.template?.id,
      name: input.template?.name,
      version: input.template?.version,
      assetFamily: input.template?.assetFamily,
      renderingContractVersion: input.template?.renderingContractVersion,
    },
    contentValidation,
    rendering,
    visualValidation,
    repair,
    scores: { contentQuality, brandCompliance, visualQuality, readability, templateCompliance, overallReadiness },
  };
}

/**
 * Refresh ONLY the render-derived parts of an existing report (visual verdict,
 * visual repair, visual/readability scores, overall readiness) from a newer
 * render's metadata. Used when an async render completes after the report was
 * built — otherwise the report keeps the stale (pre-render) verdict.
 * Content/brand/template sections are kept as they were. Pure.
 */
export function refreshDiagnosticReportVisuals(report: unknown, renderMetadata: Rec): CreatorDiagnosticReport | null {
  const old = obj(report) as unknown as CreatorDiagnosticReport;
  if (!old || !old.generation || !old.scores) return null;
  const fresh = buildCreatorDiagnosticReport({
    assetType: old.generation.assetType,
    contentType: old.generation.contentType,
    platform: old.generation.platform,
    renderMetadata,
  });
  const contentReasons = (old.repair?.reasons ?? []).filter((r) => !/^layout /.test(r));
  const contentCount = Math.max(0, (old.repair?.count ?? 0) - (old.repair?.attempts ?? (old.repair?.reRendered ? 1 : 0)));
  const repair = {
    occurred: contentCount > 0 || fresh.repair.reRendered,
    type: fresh.repair.reRendered ? fresh.repair.type : old.repair?.type,
    reasons: [...contentReasons, ...fresh.repair.reasons],
    count: contentCount + fresh.repair.attempts,
    reRendered: fresh.repair.reRendered,
    attempts: fresh.repair.attempts,
    steps: fresh.repair.steps,
  };
  const s = old.scores;
  const overallBase = Math.round(
    s.contentQuality.value * 0.25 + s.brandCompliance.value * 0.2 + fresh.scores.visualQuality.value * 0.3
      + fresh.scores.readability.value * 0.15 + s.templateCompliance.value * 0.1,
  );
  const passed = fresh.visualValidation.passed;
  return {
    ...old,
    rendering: { ...old.rendering, ...Object.fromEntries(Object.entries(fresh.rendering).filter(([, v]) => v !== undefined)) },
    visualValidation: fresh.visualValidation,
    repair,
    scores: {
      ...s,
      visualQuality: fresh.scores.visualQuality,
      readability: fresh.scores.readability,
      overallReadiness: {
        value: passed ? clamp(overallBase) : clamp(Math.min(overallBase, READINESS_PASS_THRESHOLD - 1)),
        reason: passed ? 'Asset passed all deterministic gates.' : 'Readiness capped: one or more visual checks failed.',
      },
    },
  };
}

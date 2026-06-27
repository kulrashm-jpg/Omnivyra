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
  const reRendered = meta.visual_repair_applied === true;
  const repair = {
    occurred: repairCount > 0 || reRendered,
    type: reRendered ? 'visual:shorten_text' : (repairCount > 0 ? 'content:vocabulary' : undefined),
    reasons: [
      ...(contentValidation.forbiddenWordsRepaired ? ['forbidden words removed'] : []),
      ...(contentValidation.prohibitedClaimsRemoved ? ['prohibited claims removed'] : []),
      ...(contentValidation.ctaNormalized ? ['CTA normalized'] : []),
      ...(contentValidation.fabricatedClaimsRemoved ? ['fabricated claims removed'] : []),
      ...(reRendered ? ['layout overflow → text shortened + re-render'] : []),
    ],
    count: repairCount + (reRendered ? 1 : 0),
    reRendered,
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
    value: visualValidation.passed ? clamp(overallBase) : clamp(Math.min(overallBase, 60)),
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

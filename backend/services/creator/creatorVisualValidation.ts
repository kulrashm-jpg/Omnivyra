/**
 * Canonical deterministic POST-RENDER visual quality validation.
 *
 * Reads the deterministic quality signals the renderer already produces
 * (overlay quality flags, per-slide reports, contrast ratio, density) and
 * applies PASS/FAIL rules — text fit, overlap, safe margins, branding,
 * contrast, typography. NO AI judging. NO new vision model. Pure + testable.
 *
 * Carousel: every slide is validated independently (overlay_quality_reports);
 * one failing slide fails the carousel.
 *
 * On failure a deterministic layout repair (text shortening) can be derived and
 * applied to the asset payload before a single re-render — see applyVisualRepair.
 */

type Rec = Record<string, unknown>;

function obj(v: unknown): Rec {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {};
}

export type VisualFailureCategory =
  | 'text_fit'
  | 'overlap'
  | 'safe_margins'
  | 'branding'
  | 'contrast'
  | 'typography'
  | 'dimensions'
  | 'low_quality'
  | 'missing_content'
  | 'thin_content';

/** Quality-report flags that map to a HARD visual failure (deterministic). */
const FLAG_FAILURES: Readonly<Record<string, VisualFailureCategory[]>> = {
  severe_layout_overflow_risk: ['text_fit', 'overlap', 'safe_margins'],
  headline_truncated_or_tight: ['text_fit'],
  insight_truncated_or_tight: ['text_fit'],
  headline_likely_unreadable_mobile: ['typography'],
  platform_dimension_mismatch: ['dimensions'],
  too_many_sections: ['text_fit'],
  text_density_exceeds_infographic_bounds: ['text_fit'],
  section_body_too_long: ['text_fit'],
  // WATCHDOG: a slide/section rendered with a blank body (title + empty space).
  // 'missing_content' is NOT in the repairable set below, so shortening can never
  // "fix" it — it forces regeneration / blocks the blank from shipping.
  missing_insight: ['missing_content'],
  // WATCHDOG: a near-EMPTY infographic (title over mostly-blank canvas). Hard,
  // non-repairable 'thin_content' failure — the render worker BLOCKS it (paired with
  // the generator fix that fills cards, so only genuinely near-empty output fails).
  infographic_content_too_thin: ['thin_content'],
};

const MIN_CONTRAST_RATIO = 3.0;
const MIN_QUALITY_SCORE = 30;

export interface VisualFailure {
  category: VisualFailureCategory;
  flag: string;
  /** 1-indexed slide number for carousel failures. */
  slide?: number;
}

export type VisualRepairHint = 'shorten_text' | null;

export interface VisualVerdict {
  passed: boolean;
  severity: 'pass' | 'fail';
  failures: VisualFailure[];
  /** Number of slides validated (carousel only). */
  slideCount?: number;
  repairHint: VisualRepairHint;
}

function evaluateReport(report: unknown, slide?: number): VisualFailure[] {
  const r = obj(report);
  const flags = Array.isArray(r.flags) ? r.flags.map(String) : [];
  const out: VisualFailure[] = [];
  for (const f of flags) {
    const cats = FLAG_FAILURES[f];
    if (cats) for (const category of cats) out.push({ category, flag: f, slide });
  }
  if (typeof r.score === 'number' && r.score < MIN_QUALITY_SCORE) {
    out.push({ category: 'low_quality', flag: `score_${Math.round(r.score)}`, slide });
  }
  return out;
}

function resolveContrast(metadata: Rec): number | undefined {
  if (typeof metadata.contrastRatio === 'number') return metadata.contrastRatio;
  const geo = obj(metadata.geometry);
  if (typeof geo.contrastRatio === 'number') return geo.contrastRatio;
  return undefined;
}

/**
 * Validate a rendered asset's deterministic quality signals. `metadata` is the
 * RenderedMediaBundle.metadata. Returns a pass/fail verdict + the failures + a
 * repair hint. Missing signals (e.g. fallback/placeholder assets) → pass, so we
 * never fail assets we cannot deterministically assess (backward-compatible).
 */
export function validateCreatorVisual(metadata: Rec, _contentType?: string): VisualVerdict {
  const failures: VisualFailure[] = [];

  // Contrast (top-level deterministic ratio).
  const contrast = resolveContrast(metadata);
  if (typeof contrast === 'number' && contrast > 0 && contrast < MIN_CONTRAST_RATIO) {
    failures.push({ category: 'contrast', flag: `contrast_${contrast.toFixed(2)}` });
  }

  // Carousel — validate EVERY slide independently.
  let slideCount: number | undefined;
  const perSlide = Array.isArray(metadata.overlay_quality_reports) ? metadata.overlay_quality_reports : null;
  if (perSlide && perSlide.length > 0) {
    slideCount = perSlide.length;
    perSlide.forEach((report, i) => failures.push(...evaluateReport(report, i + 1)));
  } else if (metadata.overlay_quality) {
    failures.push(...evaluateReport(metadata.overlay_quality));
  }

  const passed = failures.length === 0;
  return {
    passed,
    severity: passed ? 'pass' : 'fail',
    failures,
    slideCount,
    repairHint: deriveVisualRepairHint(failures),
  };
}

/** Derive the deterministic repair to attempt. Text-density / fit / typography
 *  failures are repairable by shortening copy; contrast / dimensions are not. */
export function deriveVisualRepairHint(failures: VisualFailure[]): VisualRepairHint {
  const repairable = new Set<VisualFailureCategory>(['text_fit', 'overlap', 'safe_margins', 'typography', 'low_quality']);
  return failures.some((f) => repairable.has(f.category)) ? 'shorten_text' : null;
}

/* ── Deterministic layout repair ─────────────────────────────────────── */

const OVERLAY_CAPS: Readonly<Record<string, number>> = {
  hook: 60,
  headline: 60,
  keyInsight: 90,
  supportingText: 80,
  cta: 24,
};

function shorten(value: unknown, cap: number): string {
  const t = String(value ?? '').trim();
  return t.length > cap ? t.slice(0, cap).replace(/\s+\S*$/, '').trim() || t.slice(0, cap).trim() : t;
}

function shortenOverlay(overlay: Rec): Rec {
  const out: Rec = { ...overlay };
  for (const [key, cap] of Object.entries(OVERLAY_CAPS)) {
    if (typeof out[key] === 'string') out[key] = shorten(out[key], cap);
  }
  return out;
}

/**
 * Deterministically reduce on-asset text so a re-render fits within its zones.
 * Pure — returns a NEW asset payload. No-op for hints other than 'shorten_text'.
 */
export function applyVisualRepair(assetPayload: Rec, hint: VisualRepairHint): Rec {
  if (hint !== 'shorten_text') return assetPayload;
  const next: Rec = { ...assetPayload };

  if (assetPayload.overlay_text) next.overlay_text = shortenOverlay(obj(assetPayload.overlay_text));

  if (Array.isArray(assetPayload.slides)) {
    next.slides = assetPayload.slides.map((s) => {
      const slide = obj(s);
      const out: Rec = { ...slide };
      if (typeof out.title === 'string') out.title = shorten(out.title, 48);
      if (typeof out.headline === 'string') out.headline = shorten(out.headline, 48);
      if (typeof out.body === 'string') out.body = shorten(out.body, 140);
      if (typeof out.body_text === 'string') out.body_text = shorten(out.body_text, 140);
      return out;
    });
  }

  const mb = obj(assetPayload.media_bundle);
  const meta = obj(mb.metadata);
  if (Object.keys(meta).length > 0) {
    const nextMeta: Rec = { ...meta, visual_repair_applied: true };
    if (meta.overlay_text) nextMeta.overlay_text = shortenOverlay(obj(meta.overlay_text));
    const tvt = obj(meta.thread_visual_transform);
    if (Array.isArray(tvt.items)) {
      nextMeta.thread_visual_transform = { ...tvt, items: tvt.items.map((it) => shorten(it, 110)) };
    }
    next.media_bundle = { ...mb, metadata: nextMeta };
  }

  return next;
}

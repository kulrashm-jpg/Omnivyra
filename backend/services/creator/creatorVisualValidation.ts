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
  /** Human-readable explanation for the person reviewing the asset. */
  message?: string;
}

/**
 * What a flag means, in words a person can act on. Flags are the renderer's
 * deterministic quality signals; unknown flags fall back to the category.
 */
const FLAG_MESSAGES: Readonly<Record<string, string>> = {
  severe_layout_overflow_risk: 'Text overflows the safe area',
  headline_truncated_or_tight: 'Headline is cut off or too tight to fit',
  insight_truncated_or_tight: 'Key insight text is cut off or too tight to fit',
  headline_likely_unreadable_mobile: 'Headline is too small to read on mobile',
  platform_dimension_mismatch: "Image size doesn't match the platform's format",
  too_many_sections: 'Too many sections to fit legibly',
  text_density_exceeds_infographic_bounds: 'Too much text for the infographic layout',
  section_body_too_long: "A section's text is too long to fit",
  missing_insight: 'A slide or section rendered with an empty body',
  infographic_content_too_thin: 'Infographic is mostly empty',
};

const CATEGORY_MESSAGES: Readonly<Record<VisualFailureCategory, string>> = {
  text_fit: 'Text does not fit its area',
  overlap: 'Text overlaps other elements',
  safe_margins: 'Text runs outside the safe margins',
  branding: 'Branding is missing or misplaced',
  contrast: 'Low contrast between text and background',
  typography: 'Text is too small or hard to read',
  dimensions: "Image size doesn't match the platform's format",
  low_quality: 'Overall layout quality is low',
  missing_content: 'Content is missing from the layout',
  thin_content: 'Layout is mostly empty',
};

/**
 * Human message for a visual failure, with the slide number when there is one
 * (e.g. "Headline is too small to read on mobile (slide 3)"). Works for
 * failures persisted before `message` existed.
 */
export function describeVisualFailure(failure: Partial<VisualFailure> | null | undefined): string {
  const f = failure ?? {};
  const flag = typeof f.flag === 'string' ? f.flag : '';
  const category = f.category as VisualFailureCategory | undefined;
  const base = (typeof f.message === 'string' && f.message.trim())
    || FLAG_MESSAGES[flag]
    || (flag.startsWith('contrast_') ? CATEGORY_MESSAGES.contrast : '')
    || (flag.startsWith('score_') ? CATEGORY_MESSAGES.low_quality : '')
    || (category && CATEGORY_MESSAGES[category])
    || 'Visual check failed';
  return typeof f.slide === 'number' ? `${base} (slide ${f.slide})` : base;
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
    if (cats) for (const category of cats) out.push({ category, flag: f, slide, message: FLAG_MESSAGES[f] ?? CATEGORY_MESSAGES[category] });
  }
  if (typeof r.score === 'number' && r.score < MIN_QUALITY_SCORE) {
    out.push({ category: 'low_quality', flag: `score_${Math.round(r.score)}`, slide, message: CATEGORY_MESSAGES.low_quality });
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
    failures.push({ category: 'contrast', flag: `contrast_${contrast.toFixed(2)}`, message: CATEGORY_MESSAGES.contrast });
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

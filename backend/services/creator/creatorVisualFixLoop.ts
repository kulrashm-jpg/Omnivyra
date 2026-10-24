/**
 * PR4 — bounded AI fix-and-re-render loop for Creator visuals.
 *
 * When the post-render Quality Inspector (validateCreatorVisual) fails an asset,
 * the loop fixes the copy deterministically and re-renders, up to
 * MAX_FIX_ATTEMPTS times, escalating one fix step per attempt:
 *
 *   1. shorten ONLY the overflowing / flagged fields (word-boundary)
 *   2. drop optional fields, one per attempt: keyInsight, supportingText, hook
 *      (the headline and the CTA are never dropped)
 *   3. a denser preset — NOT available: overlay presets derive their density
 *      from the copy itself, so there is no compact preset to switch to and
 *      the step is skipped (shorter copy already selects the dense preset).
 *
 * Every re-render reuses the FIRST attempt's AI image (a paid call is never
 * repeated) and skips the infographic copy enrichment LLM call. The loop stops
 * as soon as the verdict passes, when failures stop decreasing, when nothing
 * fixable by shortening is left, or when the time budget is spent. The best
 * attempt is kept and the outcome is disclosed on its OUTPUT metadata as
 * `visual_validation.repair`.
 *
 * Not fixed here (disclosed as remaining instead): typography (preset type
 * size), contrast, dimensions, missing/thin content, and anything that needs a
 * NEW AI image (text the provider painted into the picture).
 */

import { clipCopyToChars } from '../creatorAssetGovernance';
import type { RenderedMediaBundle, RenderOptions, ProviderImageReuse } from '../creatorAssetRendererContracts';
import {
  SHORTENABLE_CATEGORIES,
  describeVisualFailure,
  type VisualFailure,
  type VisualVerdict,
} from './creatorVisualValidation';

type Rec = Record<string, unknown>;

function obj(v: unknown): Rec {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {};
}

/* ── limits ──────────────────────────────────────────────────────────── */

export const MAX_FIX_ATTEMPTS = 3;
/** Wall-clock budget for all RE-renders together (the first render is not counted). */
export const FIX_LOOP_TIME_BUDGET_MS = 20_000;

/** `CREATOR_VISUAL_FIX_MAX_ATTEMPTS`, clamped to 0..MAX_FIX_ATTEMPTS (default MAX). */
export function resolveMaxFixAttempts(env: Record<string, string | undefined> = process.env): number {
  const raw = env.CREATOR_VISUAL_FIX_MAX_ATTEMPTS;
  if (raw == null || String(raw).trim() === '') return MAX_FIX_ATTEMPTS;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return MAX_FIX_ATTEMPTS;
  return Math.max(0, Math.min(MAX_FIX_ATTEMPTS, n));
}

/**
 * Provider-image / OCR flags only a NEW AI image could fix (text the model
 * painted into the picture, garbled glyphs). The loop never regenerates the
 * image, so these are disclosed as remaining, never "fixed".
 */
export const NEEDS_NEW_IMAGE_FLAGS: ReadonlySet<string> = new Set([
  'provider_visible_text_detected',
  'provider_non_english_or_fake_glyphs',
  'provider_dense_text_block',
  'provider_cta_text_detected',
  'provider_ocr_confidence_below_threshold',
  'supporting_visual_provider_text_rejected',
]);

/* ── fix steps ───────────────────────────────────────────────────────── */

export type FixStepId =
  | 'shorten_flagged_fields'
  | 'drop_keyInsight'
  | 'drop_supportingText'
  | 'drop_hook'
  | 'compact_preset';

/** Escalation order. One step is applied per attempt; a step that changes nothing is skipped. */
export const FIX_STEP_ORDER: readonly FixStepId[] = [
  'shorten_flagged_fields',
  'drop_keyInsight',
  'drop_supportingText',
  'drop_hook',
  'compact_preset',
];

type OverlayField = 'hook' | 'headline' | 'keyInsight' | 'supportingText' | 'cta';

/** Upper bounds a flagged field is clipped to (the shortening also takes at least 25 % off). */
const OVERLAY_CAPS: Readonly<Record<Exclude<OverlayField, 'cta'>, number>> = {
  hook: 60,
  headline: 60,
  keyInsight: 90,
  supportingText: 80,
};
const SLIDE_HEADLINE_CAP = 48;
const SLIDE_BODY_CAP = 140;
const SECTION_ITEM_CAP = 110;
/** A headline at or below this many words is left alone — it is the message. */
const HEADLINE_MIN_WORDS = 3;

const ALIASES: Readonly<Record<string, string[]>> = {
  keyInsight: ['keyInsight', 'key_insight'],
  supportingText: ['supportingText', 'supporting_text'],
  hook: ['hook'],
};

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Word-boundary shortening by at least 25 %, never above `cap`. Returns the input when it cannot shrink. */
function shortenText(value: unknown, cap: number, opts: { minWords?: number } = {}): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return text;
  if (opts.minWords && wordCount(text) <= opts.minWords) return text;
  const target = Math.max(12, Math.min(cap, Math.floor(text.length * 0.75)));
  if (text.length <= target) return text;
  const clipped = clipCopyToChars(text, target);
  if (!clipped) return text;
  if (opts.minWords && wordCount(clipped) < opts.minWords) {
    return text.split(/\s+/).slice(0, opts.minWords).join(' ');
  }
  return clipped;
}

interface ShortenTargets {
  all: boolean;
  overlay: Set<Exclude<OverlayField, 'cta'>>;
  /** 0-indexed slide → which parts. */
  slides: Map<number, Set<'headline' | 'body'>>;
  sections: Set<number> | 'all';
}

function addSlide(t: ShortenTargets, index: number, part: 'headline' | 'body' | 'both') {
  const set = t.slides.get(index) ?? new Set<'headline' | 'body'>();
  if (part === 'both') { set.add('headline'); set.add('body'); } else set.add(part);
  t.slides.set(index, set);
}

/** Which fields the failures point at. No usable pointer → shorten everything (but the CTA). */
export function resolveShortenTargets(failures: VisualFailure[]): ShortenTargets {
  const t: ShortenTargets = { all: false, overlay: new Set(), slides: new Map(), sections: new Set() };
  const shortenable = failures.filter((f) => SHORTENABLE_CATEGORIES.has(f.category));
  if (shortenable.length === 0) { t.all = true; return t; }
  for (const f of shortenable) {
    const slideIndex = typeof f.slide === 'number' && f.slide > 0 ? f.slide - 1 : null;
    if (typeof f.field === 'string' && f.field) {
      const m = /^slide_(\d+):(.+)$/.exec(f.field);
      const bare = m ? m[2] : f.field;
      const idx = m ? Number(m[1]) - 1 : slideIndex;
      const sec = /^section_(\d+)$/.exec(bare);
      if (sec) {
        if (t.sections !== 'all') t.sections.add(Number(sec[1]) - 1);
      } else if (idx != null) {
        addSlide(t, idx, bare === 'headline' ? 'headline' : (bare === 'keyInsight' || bare === 'body') ? 'body' : 'both');
      } else if (bare === 'header_title') {
        t.overlay.add('headline');
      } else if (bare === 'headline' || bare === 'keyInsight' || bare === 'supportingText' || bare === 'hook') {
        t.overlay.add(bare);
      } else {
        t.all = true;
      }
      continue;
    }
    switch (f.flag) {
      case 'headline_truncated_or_tight':
        if (slideIndex != null) addSlide(t, slideIndex, 'headline'); else t.overlay.add('headline');
        break;
      case 'insight_truncated_or_tight':
        if (slideIndex != null) addSlide(t, slideIndex, 'body'); else t.overlay.add('keyInsight');
        break;
      case 'too_many_sections':
      case 'text_density_exceeds_infographic_bounds':
      case 'section_body_too_long':
        t.sections = 'all';
        break;
      default:
        if (slideIndex != null) addSlide(t, slideIndex, 'both'); else t.all = true;
    }
  }
  return t;
}

function overlayLocations(payload: Rec): Array<{ get: () => Rec; set: (o: Rec) => void }> {
  const locs: Array<{ get: () => Rec; set: (o: Rec) => void }> = [];
  if (payload.overlay_text && typeof payload.overlay_text === 'object') {
    locs.push({ get: () => obj(payload.overlay_text), set: (o) => { payload.overlay_text = o; } });
  }
  const mb = obj(payload.media_bundle);
  const meta = obj(mb.metadata);
  if (meta.overlay_text && typeof meta.overlay_text === 'object') {
    locs.push({
      get: () => obj(obj(obj(payload.media_bundle).metadata).overlay_text),
      set: (o) => {
        const cur = obj(payload.media_bundle);
        payload.media_bundle = { ...cur, metadata: { ...obj(cur.metadata), overlay_text: o } };
      },
    });
  }
  return locs;
}

function cloneForFix(payload: Rec): Rec {
  const next: Rec = { ...payload };
  if (payload.media_bundle && typeof payload.media_bundle === 'object') {
    const mb = obj(payload.media_bundle);
    next.media_bundle = { ...mb, metadata: { ...obj(mb.metadata) } };
  }
  return next;
}

function shortenFlagged(payload: Rec, failures: VisualFailure[]): { payload: Rec; changed: boolean; detail: string[] } {
  const t = resolveShortenTargets(failures);
  const next = cloneForFix(payload);
  const detail = new Set<string>();
  let changed = false;

  // Overlay (image / banner / infographic header + sections fall back to it).
  const overlayFields: Array<Exclude<OverlayField, 'cta'>> = t.all
    ? ['headline', 'keyInsight', 'supportingText', 'hook']
    : Array.from(t.overlay);
  for (const loc of overlayLocations(next)) {
    const o: Rec = { ...loc.get() };
    let locChanged = false;
    for (const field of overlayFields) {
      for (const key of ALIASES[field] ?? [field]) {
        if (typeof o[key] !== 'string' || !String(o[key]).trim()) continue;
        const shortened = shortenText(o[key], OVERLAY_CAPS[field], field === 'headline' ? { minWords: HEADLINE_MIN_WORDS } : {});
        if (shortened !== String(o[key]).replace(/\s+/g, ' ').trim()) {
          o[key] = shortened; locChanged = true; detail.add(field);
        }
      }
    }
    if (locChanged) { loc.set(o); changed = true; }
  }

  // Carousel / slider / pdf slides.
  for (const listKey of ['slides', 'thread_sequence'] as const) {
    const list = next[listKey];
    if (!Array.isArray(list)) continue;
    let listChanged = false;
    const out = list.map((s, i) => {
      const parts = t.all ? new Set<'headline' | 'body'>(['headline', 'body']) : t.slides.get(i);
      if (!parts || !s || typeof s !== 'object' || Array.isArray(s)) return s;
      const slide: Rec = { ...(s as Rec) };
      if (parts.has('headline')) {
        for (const key of ['headline', 'title', 'heading']) {
          if (typeof slide[key] !== 'string' || !String(slide[key]).trim()) continue;
          const v = shortenText(slide[key], SLIDE_HEADLINE_CAP, { minWords: HEADLINE_MIN_WORDS });
          if (v !== String(slide[key]).replace(/\s+/g, ' ').trim()) { slide[key] = v; listChanged = true; detail.add(`slide_${i + 1}:headline`); }
        }
      }
      if (parts.has('body')) {
        for (const key of ['body_text', 'body', 'text', 'summary']) {
          if (typeof slide[key] !== 'string' || !String(slide[key]).trim()) continue;
          // Never empties a body: an empty slide is a 'missing_content' failure.
          const v = shortenText(slide[key], SLIDE_BODY_CAP, { minWords: 4 });
          if (v !== String(slide[key]).replace(/\s+/g, ' ').trim()) { slide[key] = v; listChanged = true; detail.add(`slide_${i + 1}:body`); }
        }
      }
      return slide;
    });
    if (listChanged) { next[listKey] = out; changed = true; }
  }

  // Infographic sections (thread_visual_transform.items).
  const meta = obj(obj(next.media_bundle).metadata);
  const tvt = obj(meta.thread_visual_transform);
  if (Array.isArray(tvt.items) && (t.all || t.sections === 'all' || (t.sections instanceof Set && t.sections.size > 0))) {
    let itemsChanged = false;
    const items = tvt.items.map((it, i) => {
      if (typeof it !== 'string') return it;
      const targeted = t.all || t.sections === 'all' || (t.sections instanceof Set && t.sections.has(i));
      if (!targeted) return it;
      const v = shortenText(it, SECTION_ITEM_CAP, { minWords: 3 });
      if (v !== it.replace(/\s+/g, ' ').trim()) { itemsChanged = true; detail.add(`section_${i + 1}`); }
      return v;
    });
    if (itemsChanged) {
      next.media_bundle = { ...obj(next.media_bundle), metadata: { ...meta, thread_visual_transform: { ...tvt, items } } };
      changed = true;
    }
  }

  return { payload: changed ? next : payload, changed, detail: Array.from(detail) };
}

function dropOverlayField(payload: Rec, field: 'keyInsight' | 'supportingText' | 'hook'): { payload: Rec; changed: boolean } {
  const next = cloneForFix(payload);
  let changed = false;
  for (const loc of overlayLocations(next)) {
    const o: Rec = { ...loc.get() };
    let locChanged = false;
    for (const key of ALIASES[field]) {
      if (typeof o[key] === 'string' && String(o[key]).trim()) { o[key] = ''; locChanged = true; }
    }
    if (locChanged) { loc.set(o); changed = true; }
  }
  return { payload: changed ? next : payload, changed };
}

/**
 * Apply ONE fix step to the asset payload. Pure — returns a new payload when
 * something changed. The headline and the CTA are never dropped; the CTA is
 * never shortened.
 */
export function applyFixStep(
  payload: Rec,
  step: FixStepId,
  failures: VisualFailure[],
): { payload: Rec; changed: boolean; detail: string[] } {
  switch (step) {
    case 'shorten_flagged_fields':
      return shortenFlagged(payload, failures);
    case 'drop_keyInsight':
      return { ...dropOverlayField(payload, 'keyInsight'), detail: ['keyInsight'] };
    case 'drop_supportingText':
      return { ...dropOverlayField(payload, 'supportingText'), detail: ['supportingText'] };
    case 'drop_hook':
      return { ...dropOverlayField(payload, 'hook'), detail: ['hook'] };
    case 'compact_preset':
      // No compact preset/type tier can be selected from the payload (density
      // is derived from the copy length), so this step never changes anything.
      return { payload, changed: false, detail: [] };
    default:
      return { payload, changed: false, detail: [] };
  }
}

/* ── loop ────────────────────────────────────────────────────────────── */

/** Flags of a fail-closed `render_manifest_rejected:<a,b>` error, or null when it is another error. */
export function manifestRejectionFlags(error: unknown): string[] | null {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const m = /render_manifest_rejected:([^\s]*)/.exec(message);
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}

function isFixableRejection(flags: string[] | null): boolean {
  return Array.isArray(flags) && flags.some((f) => !NEEDS_NEW_IMAGE_FLAGS.has(f));
}

export interface VisualRepairDisclosure {
  /** Number of RE-renders performed (0 = the loop could not fix anything). */
  attempts: number;
  steps: string[];
  /** Human descriptions of the failures the loop resolved. */
  resolved: string[];
  /** The kept attempt's failures that still need attention. */
  remaining: VisualFailure[];
  providerImageReused: boolean;
  /** Provider flags that only a NEW AI image could fix — never regenerated here. */
  needsNewImage?: string[];
  /** Why the loop stopped. */
  stopReason: 'passed' | 'no_fixable_failures' | 'no_improvement' | 'max_attempts' | 'time_budget' | 'no_fix_step_left' | 'disabled' | 'retry_error';
}

export interface VisualFixLoopDeps {
  dispatch: (payload: Rec, options: RenderOptions) => Promise<RenderedMediaBundle>;
  validate: (metadata: Rec, contentType?: string) => VisualVerdict;
  maxAttempts?: number;
  timeBudgetMs?: number;
  now?: () => number;
}

type Attempt = { bundle: RenderedMediaBundle; verdict: VisualVerdict } | { error: unknown; flags: string[] | null };

function failureKey(f: VisualFailure): string {
  return `${f.category}|${f.flag}|${f.slide ?? ''}|${f.field ?? ''}`;
}

function attemptFailureCount(a: Attempt): number {
  return 'verdict' in a ? a.verdict.failures.length : Number.POSITIVE_INFINITY;
}

/**
 * Render, validate, and — on a fixable failure — fix + re-render (bounded).
 * Returns the kept bundle with `visual_validation` (and its `repair`
 * disclosure when the loop engaged) on its metadata.
 */
export async function runVisualFixLoop(
  assetPayload: Rec,
  options: RenderOptions,
  contentType: string,
  deps: VisualFixLoopDeps,
): Promise<RenderedMediaBundle> {
  const maxAttempts = Math.max(0, Math.min(MAX_FIX_ATTEMPTS, deps.maxAttempts ?? resolveMaxFixAttempts()));
  const budgetMs = deps.timeBudgetMs ?? FIX_LOOP_TIME_BUDGET_MS;
  const now = deps.now ?? Date.now;

  let captured: ProviderImageReuse | null = options.reuseProviderImage ?? null;
  const firstOptions: RenderOptions = {
    ...options,
    captureProviderImage: (c) => {
      if (!captured) captured = c;
      if (typeof options.captureProviderImage === 'function') options.captureProviderImage(c);
    },
  };

  const run = async (payload: Rec, opts: RenderOptions): Promise<Attempt> => {
    try {
      const bundle = await deps.dispatch(payload, opts);
      return { bundle, verdict: deps.validate(obj(bundle.metadata), contentType) };
    } catch (error) {
      return { error, flags: manifestRejectionFlags(error) };
    }
  };

  const first = await run(assetPayload, firstOptions);
  if ('error' in first && !isFixableRejection(first.flags)) throw first.error;
  if ('verdict' in first && (first.verdict.passed || obj(first.bundle.metadata).placeholder)) {
    return withVerdict(first.bundle, first.verdict, null);
  }

  let best: Attempt = first;
  let last: Attempt = first;
  let currentPayload = assetPayload;
  let attempts = 0;
  let stepIndex = 0;
  const steps: string[] = [];
  let stopReason: VisualRepairDisclosure['stopReason'] = maxAttempts === 0 ? 'disabled' : 'max_attempts';
  const loopStartedAt = now();

  while (attempts < maxAttempts) {
    if ('verdict' in last && last.verdict.passed) { stopReason = 'passed'; break; }
    if ('verdict' in last && !last.verdict.failures.some((f) => SHORTENABLE_CATEGORIES.has(f.category))) {
      stopReason = 'no_fixable_failures'; break;
    }
    if ('error' in last && !isFixableRejection(last.flags)) { stopReason = 'no_fixable_failures'; break; }
    if (now() - loopStartedAt >= budgetMs) { stopReason = 'time_budget'; break; }

    // Next step that actually changes the payload.
    const failures = 'verdict' in last ? last.verdict.failures : [];
    let fixed: { payload: Rec; changed: boolean; detail: string[] } | null = null;
    let stepId: FixStepId | null = null;
    while (stepIndex < FIX_STEP_ORDER.length) {
      const candidate = FIX_STEP_ORDER[stepIndex++];
      const r = applyFixStep(currentPayload, candidate, failures);
      if (r.changed) { fixed = r; stepId = candidate; break; }
    }
    if (!fixed || !stepId) { stopReason = 'no_fix_step_left'; break; }

    currentPayload = fixed.payload;
    attempts += 1;
    steps.push(stepId === 'shorten_flagged_fields' && fixed.detail.length ? `${stepId}:${fixed.detail.join(',')}` : stepId);

    const retryOptions: RenderOptions = {
      ...options,
      // Never a second paid AI image: reuse the first one, or none at all.
      reuseProviderImage: captured,
      noProviderImage: captured ? undefined : true,
      captureProviderImage: null,
      // Never a second paid copy-enrichment call either.
      skipInfographicCopyEnrichment: true,
    };
    const retry = await run(currentPayload, retryOptions);
    if ('error' in retry && !isFixableRejection(retry.flags)) {
      // A different, non-fixable failure: keep what we have.
      stopReason = 'retry_error';
      break;
    }
    const improved = attemptFailureCount(retry) < attemptFailureCount(last)
      || ('verdict' in retry && 'error' in last);
    if (attemptFailureCount(retry) < attemptFailureCount(best) || ('verdict' in retry && 'error' in best)) best = retry;
    const bothErrors = 'error' in retry && 'error' in last;
    last = retry;
    if ('verdict' in retry && retry.verdict.passed) { stopReason = 'passed'; break; }
    if (!improved && !bothErrors) { stopReason = 'no_improvement'; break; }
  }

  // Every attempt failed closed: surface the ORIGINAL error unchanged.
  if ('error' in best) throw 'error' in first ? first.error : best.error;

  const initialFailures = 'verdict' in first ? first.verdict.failures : [];
  const remainingKeys = new Set(best.verdict.failures.map(failureKey));
  const resolved = 'verdict' in first
    ? Array.from(new Set(initialFailures.filter((f) => !remainingKeys.has(failureKey(f))).map((f) => describeVisualFailure(f))))
    : [`Render was rejected by layout checks (${(first.flags ?? []).join(', ')})`];
  const providerFlags = Array.isArray(obj(obj(best.bundle.metadata).provider_text_validation).flags)
    ? (obj(obj(best.bundle.metadata).provider_text_validation).flags as unknown[]).map(String)
    : [];
  const needsNewImage = Array.from(new Set(providerFlags.filter((f) => NEEDS_NEW_IMAGE_FLAGS.has(f))));
  const repair: VisualRepairDisclosure = {
    attempts,
    steps,
    resolved,
    remaining: best.verdict.failures,
    providerImageReused: attempts > 0 && Boolean(captured),
    ...(needsNewImage.length ? { needsNewImage } : {}),
    stopReason: best.verdict.passed ? 'passed' : stopReason,
  };
  return withVerdict(best.bundle, best.verdict, repair);
}

function withVerdict(bundle: RenderedMediaBundle, verdict: VisualVerdict, repair: VisualRepairDisclosure | null): RenderedMediaBundle {
  return {
    ...bundle,
    metadata: {
      ...obj(bundle.metadata),
      visual_validation: repair ? { ...verdict, repair } : verdict,
    },
  };
}

/**
 * Template Content Ingestion — make user-entered template content authoritative.
 *
 * Phase: Template Content Ingestion (Carousel + Infographic).
 *
 * Principle: when a creator template supplies user-entered structured content
 * (carousel slides / infographic sections), that content is the canonical
 * source. AI becomes a field-level assistant that fills ONLY empty slots — it
 * is no longer the owner of the generated structure.
 *
 * This runs AFTER the engine generated a full draft and BEFORE render, so the
 * generated draft is available to fill empty slots (deterministic partial
 * generation). It NEVER rewrites or reorders authored content.
 *
 * Pure + decoupled (operates on plain payload records). The orchestrator calls
 * `applyAuthoritativeTemplateContent` once between adapt and render. With no
 * template content present, every function is a strict no-op → non-template and
 * AI-only flows are byte-identical.
 *
 * Renderer seams consumed (NO renderer change):
 *   - carousel:    asset_payload.slides[]  (renderAsset reads this array)
 *   - infographic: media_bundle.metadata.thread_visual_transform.items[]
 *                  (resolveInfographicSections reads this; "label: detail"
 *                   strings split on the first colon → title / body)
 */

type Rec = Record<string, unknown>;

function safeObject(value: unknown): Rec {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : {};
}

function asArray(value: unknown): Rec[] {
  return Array.isArray(value)
    ? value.filter((v) => v && typeof v === 'object' && !Array.isArray(v)).map((v) => v as Rec)
    : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

const CAROUSEL_CONTENT_TYPES = new Set(['carousel', 'slider', 'pdf']);

/* ── Carousel ───────────────────────────────────────────────────────── */

/** A slide carries authored content when its title/headline OR body is set. */
export function isSlideFilled(slide: Rec): boolean {
  return Boolean(str(slide.title) || str(slide.headline)) || Boolean(str(slide.body) || str(slide.body_text));
}

/** True when at least one user slide was authored (manual / paste / AI-filled). */
export function hasAuthoredCarouselContent(creatorCard: Rec): boolean {
  return asArray(creatorCard.slides).some(isSlideFilled);
}

/** Normalize a user slide into the renderer's expected slide shape. */
function normalizeUserSlide(slide: Rec, index: number): Rec {
  const title = str(slide.title) || str(slide.headline);
  const body = str(slide.body) || str(slide.body_text);
  const out: Rec = {
    slide_number: index + 1,
    headline: title,
    title,
    body,
    body_text: body,
  };
  if (str(slide.role)) out.role = str(slide.role);
  return out;
}

/**
 * Deterministic merge: authored slides win verbatim; empty slots are filled
 * from the generated draft at the SAME index (partial generation). Output
 * length === user slide count; order is preserved exactly.
 */
export function mergeAuthoritativeCarouselSlides(
  userSlides: Rec[],
  generatedSlides: Rec[],
): { slides: Rec[]; authored: number; filledFromGenerated: number } {
  const slides: Rec[] = [];
  let authored = 0;
  let filledFromGenerated = 0;
  for (let i = 0; i < userSlides.length; i++) {
    const u = userSlides[i];
    if (isSlideFilled(u)) {
      slides.push(normalizeUserSlide(u, i));
      authored += 1;
    } else if (generatedSlides[i]) {
      // Re-index the generated slide so slide_number stays contiguous.
      slides.push({ ...generatedSlides[i], slide_number: i + 1 });
      filledFromGenerated += 1;
    } else {
      slides.push(normalizeUserSlide(u, i));
    }
  }
  return { slides, authored, filledFromGenerated };
}

/* ── Infographic ────────────────────────────────────────────────────── */

/** A section row is authored when ANY of its field values is set. */
export function isSectionAuthored(row: Rec): boolean {
  return Object.values(row).some((v) => str(v).length > 0);
}

/** True when at least one infographic section row was authored. */
export function hasAuthoredInfographicContent(creatorCard: Rec): boolean {
  return asArray(creatorCard.infographic_sections).some(isSectionAuthored);
}

/**
 * Build the `thread_visual_transform.items` the infographic renderer consumes.
 * Each authored section becomes a "primary: detail" line (the renderer splits
 * on the first colon → card title / body). Order preserved; empty rows dropped.
 */
export function buildInfographicTransformItems(sections: Rec[]): string[] {
  const items: string[] = [];
  for (const row of sections) {
    if (!isSectionAuthored(row)) continue;
    const values = Object.values(row).map((v) => str(v));
    const primary = values[0] || '';
    const detail = values.slice(1).find((v) => v.length > 0) || '';
    const line = detail ? `${primary}: ${detail}` : primary;
    if (line) items.push(line);
  }
  return items;
}

/* ── Entry point ────────────────────────────────────────────────────── */

export interface AuthoritativeMergeResult<T extends Rec = Rec> {
  output: T;
  applied: 'carousel' | 'infographic' | null;
  /** Authored slides/sections that were honored verbatim. */
  authoredCount: number;
  /** Empty carousel slots filled from the generated draft. */
  filledFromGenerated: number;
}

/**
 * Apply authoritative template content to a canonical creator output, between
 * adapt and render. Returns a NEW output (no mutation of the input) when a
 * merge applied; otherwise returns the input unchanged.
 */
export function applyAuthoritativeTemplateContent<T extends Rec>(
  output: T,
  creatorCard: Rec,
  contentType: string,
): AuthoritativeMergeResult<T> {
  const ct = String(contentType || '').trim().toLowerCase();
  const assetPayload = safeObject((output as Rec).asset_payload);

  // ── Carousel family ──
  if (CAROUSEL_CONTENT_TYPES.has(ct) && hasAuthoredCarouselContent(creatorCard)) {
    const userSlides = asArray(creatorCard.slides);
    const generatedSlides = asArray(assetPayload.slides);
    const merged = mergeAuthoritativeCarouselSlides(userSlides, generatedSlides);
    const nextOutput = {
      ...(output as Rec),
      asset_payload: { ...assetPayload, slides: merged.slides, slide_count: merged.slides.length },
    } as unknown as T;
    return { output: nextOutput, applied: 'carousel', authoredCount: merged.authored, filledFromGenerated: merged.filledFromGenerated };
  }

  // ── Infographic ──
  if (ct === 'infographic' && hasAuthoredInfographicContent(creatorCard)) {
    const items = buildInfographicTransformItems(asArray(creatorCard.infographic_sections));
    if (items.length === 0) {
      return { output, applied: null, authoredCount: 0, filledFromGenerated: 0 };
    }
    const mediaBundle = safeObject(assetPayload.media_bundle);
    const metadata = safeObject(mediaBundle.metadata);
    const templateFields = safeObject(creatorCard.template_fields);
    const title = str(templateFields.headline);
    const nextMetadata: Rec = {
      ...metadata,
      thread_visual_transform: { items, source: 'template_authored' },
    };
    // Template title field (when present) overrides the infographic header.
    if (title) nextMetadata.topic = title;
    const nextOutput = {
      ...(output as Rec),
      asset_payload: {
        ...assetPayload,
        media_bundle: { ...mediaBundle, metadata: nextMetadata },
      },
    } as unknown as T;
    return { output: nextOutput, applied: 'infographic', authoredCount: items.length, filledFromGenerated: 0 };
  }

  return { output, applied: null, authoredCount: 0, filledFromGenerated: 0 };
}

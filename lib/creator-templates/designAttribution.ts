/**
 * Design Attribution — the immutable stamp every generated Creator asset carries
 * so analytics can be rolled back up to its Template, Collection, and Campaign
 * Design System. Pure (no DB). Additive metadata only — it never changes
 * generation or rendering; it rides alongside the existing asset metadata and
 * persists through publishing.
 */

export interface DesignAttribution {
  campaignId: string | null;
  campaignDesignSystemId: string | null;
  collectionId: string | null;
  collectionVersion: number | null;
  templateId: string | null;
  templateVersion: number | null;
}

/** Metadata key under which the stamp lives (stable across the pipeline). */
export const DESIGN_ATTRIBUTION_KEY = '__design_attribution';

export function buildDesignAttribution(input: Partial<DesignAttribution>): DesignAttribution {
  return {
    campaignId: input.campaignId ?? null,
    campaignDesignSystemId: input.campaignDesignSystemId ?? null,
    collectionId: input.collectionId ?? null,
    collectionVersion: typeof input.collectionVersion === 'number' ? input.collectionVersion : null,
    templateId: input.templateId ?? null,
    templateVersion: typeof input.templateVersion === 'number' ? input.templateVersion : null,
  };
}

/**
 * Stamp attribution onto an asset metadata object (immutably — returns a new
 * object; the stamp is frozen). Idempotent: re-stamping with the SAME values is
 * a no-op; a stamp is never overwritten with different values (immutable once
 * set) — the original wins, preserving provenance through edits/republish.
 */
export function stampDesignAttribution(metadata: Record<string, unknown> | null | undefined, attribution: DesignAttribution): Record<string, unknown> {
  const base = metadata && typeof metadata === 'object' ? metadata : {};
  const existing = (base as Record<string, unknown>)[DESIGN_ATTRIBUTION_KEY];
  if (existing && typeof existing === 'object') return base as Record<string, unknown>; // immutable once set
  return { ...base, [DESIGN_ATTRIBUTION_KEY]: Object.freeze({ ...attribution }) };
}

export function readDesignAttribution(metadata: unknown): DesignAttribution | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>)[DESIGN_ATTRIBUTION_KEY];
  if (!raw || typeof raw !== 'object') return null;
  return buildDesignAttribution(raw as Partial<DesignAttribution>);
}

/** A stamp is usable for rollups when it ties an asset to at least a template. */
export function isAttributed(a: DesignAttribution | null): a is DesignAttribution {
  return !!a && !!a.templateId;
}

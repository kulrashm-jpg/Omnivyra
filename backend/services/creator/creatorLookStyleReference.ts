/**
 * The SELECTED reference image as a STYLE reference (owner 2026-10-25:
 * "generation is new but inspired by the image reference selected").
 *
 * The reference is the chosen LOOK's sample (`public/creator-showcases/<look>/
 * image.webp`) or, when no look is chosen, the curated SAMPLE the user picked in
 * the gallery (`blueprint_id`, same showcase folder). It is sent to images.edit
 * BY DEFAULT as a style reference so the output visibly draws on its medium,
 * palette, texture, line, lighting and mood — while the scene is new every
 * time: the main prompt body carries the "original scene, not a copy"
 * instruction, the positional instruction below rides with the image, and the
 * seeded "This version:" novelty layer gives every generation its own setting,
 * composition, viewpoint, light and background.
 *
 * Fidelity: ALWAYS standard. input_fidelity 'high' is reserved for the user's
 * own subject/product photo; when such a photo needs it, the photo goes alone
 * and the look stays prompt-only (a high-fidelity call would reproduce the
 * style reference too faithfully).
 *
 * Switches:
 *   CREATOR_LOOK_SAMPLE_REFERENCE=off                  → style references off (prompt-only)
 *   CREATOR_IMAGE_REFERENCE_MODE = explicit non-'edit' → THE global reference
 *                                                        kill switch; reported 'disabled'
 *
 * Read from LOCAL disk first; a fetch from APP_URL is only the fallback for a
 * deployment whose function bundle does not carry `public/`. Only registry look
 * ids or strictly slug-only showcase ids ever build a path, so a crafted id
 * cannot walk out of `public/creator-showcases`.
 */

import path from 'path';
import { promises as fs } from 'fs';
import { getVisualStyle } from '../../../lib/creator-outcomes/creatorVisualStyleRegistry';
import { selectedLookIdFromCreatorCard } from '../../../lib/creator-outcomes/lookPrecedence';
import { userReferenceDeliveryAllowed, type ReferenceFidelity } from './creatorMultimodalReferences';

/** Showcases are small; anything bigger is not a showcase and is not sent. */
const MAX_SHOWCASE_BYTES = 8 * 1024 * 1024;

/** Showcase folder ids: lowercase slug only. */
const SHOWCASE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** The look chosen on this render's metadata (image family), or null. */
export function lookIdFromRenderMetadata(metadata: Record<string, unknown>): string | null {
  const card = obj(metadata.creator_card);
  const guided = Object.keys(obj(metadata.guided_creative)).length > 0 ? obj(metadata.guided_creative) : obj(card.guided_creative);
  return selectedLookIdFromCreatorCard({ guided_creative: guided, creator_content_asset_type: 'image' }, 'image');
}

/** The curated sample picked in the gallery (used when no look is chosen), as a showcase id, or null. */
export function curatedSampleIdFromRenderMetadata(metadata: Record<string, unknown>): string | null {
  const raw = typeof metadata.blueprint_id === 'string' ? metadata.blueprint_id.trim() : '';
  return SHOWCASE_ID.test(raw) ? raw : null;
}

/** Is this render one of the "More versions in this look" variations? */
export function lookVariationFromRenderMetadata(metadata: Record<string, unknown>): { index: number; count: number } | null {
  const raw = Object.keys(obj(metadata.look_variation)).length > 0
    ? obj(metadata.look_variation)
    : obj(obj(metadata.creator_card).look_variation);
  const index = Number(raw.index);
  const count = Number(raw.count);
  if (!Number.isFinite(index) || !Number.isFinite(count) || count < 1) return null;
  return { index, count };
}

/** The showcase folder id for a registry look or a slug-only sample id; null otherwise. */
function showcaseId(id: string): string | null {
  const style = getVisualStyle(id);
  if (style) return style.id;
  return SHOWCASE_ID.test(id) ? id : null;
}

/**
 * Local path of a look's / sample's showcase. Registry ids, or slug-only ids
 * (no dots, no slashes), are the only inputs that build a path.
 */
export function lookShowcaseLocalPath(lookId: string, cwd: string = process.cwd()): string | null {
  const id = showcaseId(lookId);
  if (!id) return null;
  return path.join(cwd, 'public', 'creator-showcases', id, 'image.webp');
}

export const LOOK_STYLE_REFERENCE_MIME = 'image/webp';

/** The positional instruction that rides with the attached style reference. */
export function lookStyleReferenceInstruction(lookTitle: string | null, opts?: { lastOfSeveral?: boolean }): string {
  const which = opts?.lastOfSeveral ? 'The LAST attached image' : 'The attached image';
  const look = lookTitle ? `the ${lookTitle} look` : 'the chosen look';
  return `${which} is a style reference for ${look}. Match its rendering medium, colour palette, line work and shading, texture, lighting and mood. Do NOT copy its layout, composition, subject, characters, objects or any text or lettering from it — the content comes only from this brief, and the scene is the new one described under "This version:".`;
}

/**
 * 'attached'     — the reference rides as a standard-fidelity style image.
 * 'prompt_only'  — conveyed by the prompt alone (CREATOR_LOOK_SAMPLE_REFERENCE=off,
 *                  or the user's own photo needs high fidelity).
 * 'disabled'     — the global reference kill switch blocked it.
 * 'unavailable'  — no showcase bytes for that id.
 */
export type LookStyleReferenceStatus = 'attached' | 'disabled' | 'unavailable' | 'not_requested' | 'prompt_only';

/** Style references are on unless CREATOR_LOOK_SAMPLE_REFERENCE=off. */
export function lookSampleReferenceEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.CREATOR_LOOK_SAMPLE_REFERENCE || '').trim().toLowerCase() !== 'off';
}

/** What the render will send besides the reference. */
export type LookStyleReferenceContext = {
  /** User photos that will actually be sent as image input. */
  userReferenceCount: number;
  /** Fidelity of that call, decided by the user photos' purposes. */
  userReferenceFidelity: ReferenceFidelity;
};

export type LookStyleReferenceResolution = {
  status: LookStyleReferenceStatus;
  /** The showcase id used (look id, or the curated sample id). */
  lookId: string | null;
  lookTitle: string | null;
  /** Whether the reference is the chosen look's sample or the gallery's curated sample. */
  kind: 'look' | 'sample' | null;
  reference: { bytes: Buffer; mimeType: string; source: 'local' | 'remote' } | null;
};

export type LookShowcaseLoaders = {
  readLocal?: (absolutePath: string) => Promise<Buffer>;
  fetchRemote?: (url: string) => Promise<Buffer | null>;
};

async function defaultFetchRemote(url: string): Promise<Buffer | null> {
  const { safeFetch, readCapped } = await import('../../../lib/security/safeFetch');
  const resp = await safeFetch(url, { method: 'GET' });
  if (!resp.ok) return null;
  return await readCapped(resp);
}

/** Load a showcase's bytes: local `public/` first, APP_URL only as a fallback. */
export async function loadLookShowcaseBytes(
  lookId: string,
  loaders?: LookShowcaseLoaders,
): Promise<{ bytes: Buffer; mimeType: string; source: 'local' | 'remote' } | null> {
  const id = showcaseId(lookId);
  const local = lookShowcaseLocalPath(lookId);
  if (!id || !local) return null;
  const readLocal = loaders?.readLocal ?? ((p: string) => fs.readFile(p));
  try {
    const bytes = await readLocal(local);
    if (bytes.length > 0 && bytes.length <= MAX_SHOWCASE_BYTES) {
      return { bytes, mimeType: LOOK_STYLE_REFERENCE_MIME, source: 'local' };
    }
  } catch {
    // Not on disk in this deployment — fall through to the remote copy.
  }
  const base = String(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
  if (!base) return null;
  try {
    const bytes = await (loaders?.fetchRemote ?? defaultFetchRemote)(`${base}/creator-showcases/${id}/image.webp`);
    if (bytes && bytes.length > 0 && bytes.length <= MAX_SHOWCASE_BYTES) {
      return { bytes, mimeType: LOOK_STYLE_REFERENCE_MIME, source: 'remote' };
    }
  } catch {
    // Unreachable — the render proceeds with the look prompt-only.
  }
  return null;
}

/**
 * Should this render carry the selected reference as a style image, and if so,
 * the bytes. Never throws; any failure is a status, and the render proceeds
 * prompt-only. Default: attached at standard fidelity — also as the only image.
 */
export async function resolveLookStyleReference(
  metadata: Record<string, unknown>,
  loaders?: LookShowcaseLoaders,
  context?: LookStyleReferenceContext,
): Promise<LookStyleReferenceResolution> {
  const lookId = lookIdFromRenderMetadata(metadata);
  const sampleId = lookId ? null : curatedSampleIdFromRenderMetadata(metadata);
  const refId = lookId ?? sampleId;
  const kind: 'look' | 'sample' | null = lookId ? 'look' : sampleId ? 'sample' : null;
  const lookTitle = refId ? getVisualStyle(refId)?.title ?? null : null;
  const base = { lookId: refId, lookTitle, kind, reference: null };
  if (!refId) return { ...base, status: 'not_requested' };
  if (!lookSampleReferenceEnabled()) return { ...base, status: 'prompt_only' };
  // THE kill switch: an explicit non-'edit' CREATOR_IMAGE_REFERENCE_MODE.
  if (!userReferenceDeliveryAllowed()) return { ...base, status: 'disabled' };
  // Never on a high-fidelity call: the user's subject/product photo goes alone.
  if (context && context.userReferenceCount > 0 && context.userReferenceFidelity === 'high') {
    return { ...base, status: 'prompt_only' };
  }
  const loaded = await loadLookShowcaseBytes(refId, loaders).catch(() => null);
  if (!loaded) return { ...base, status: 'unavailable' };
  return { ...base, status: 'attached', reference: loaded };
}

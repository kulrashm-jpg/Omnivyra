/**
 * The look's own sample image as a STYLE reference (PR5 — variations from looks).
 *
 * Every look has a curated sample at `public/creator-showcases/<id>/image.webp`.
 * For "More versions in this look" (and whenever the global reference mode is
 * 'edit') that sample is sent to images.edit at NORMAL fidelity, with an
 * instruction to take its medium, palette, line work, texture and lighting and
 * nothing else — never its layout, subject or text.
 *
 * Read from LOCAL disk first (works in dev and preview, where APP_URL points at
 * production or at nothing); a fetch from APP_URL is only the fallback for a
 * deployment whose function bundle does not carry `public/`.
 *
 * Gates (owner decision, same switch as the user-photo path):
 *   CREATOR_IMAGE_REFERENCE_MODE = 'edit'    → look reference on for every look render
 *   unset / empty                            → look reference only for a requested variation
 *   any other explicit value (kill switch)   → never sent; reported as 'disabled'
 */

import path from 'path';
import { promises as fs } from 'fs';
import { getVisualStyle } from '../../../lib/creator-outcomes/creatorVisualStyleRegistry';
import { selectedLookIdFromCreatorCard } from '../../../lib/creator-outcomes/lookPrecedence';
import { creatorImageReferenceModeEnabled, userReferenceDeliveryAllowed } from './creatorMultimodalReferences';

/** Showcases are small; anything bigger is not a showcase and is not sent. */
const MAX_SHOWCASE_BYTES = 8 * 1024 * 1024;

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** The look chosen on this render's metadata (image family), or null. */
export function lookIdFromRenderMetadata(metadata: Record<string, unknown>): string | null {
  const card = obj(metadata.creator_card);
  const guided = Object.keys(obj(metadata.guided_creative)).length > 0 ? obj(metadata.guided_creative) : obj(card.guided_creative);
  return selectedLookIdFromCreatorCard({ guided_creative: guided, creator_content_asset_type: 'image' }, 'image');
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

/**
 * Local path of a look's showcase. Only registry ids resolve — the id is never
 * used to build a path until it has matched a registry row, so a crafted id
 * cannot walk out of `public/creator-showcases`.
 */
export function lookShowcaseLocalPath(lookId: string, cwd: string = process.cwd()): string | null {
  const style = getVisualStyle(lookId);
  if (!style) return null;
  return path.join(cwd, 'public', 'creator-showcases', style.id, 'image.webp');
}

export const LOOK_STYLE_REFERENCE_MIME = 'image/webp';

/** The prompt instruction that rides with the style reference. */
export function lookStyleReferenceInstruction(lookTitle: string | null, opts?: { lastOfSeveral?: boolean }): string {
  const which = opts?.lastOfSeveral ? 'The LAST attached image' : 'The attached image';
  const look = lookTitle ? `the ${lookTitle} look` : 'the chosen look';
  return `${which} is a style reference for ${look}. Match its rendering medium, colour palette, line work and shading, texture and lighting. Do NOT copy its layout, composition, subject, characters, objects or any text or lettering from it — the content comes only from this brief.`;
}

export type LookStyleReferenceStatus = 'attached' | 'disabled' | 'unavailable' | 'not_requested';

export type LookStyleReferenceResolution = {
  status: LookStyleReferenceStatus;
  lookId: string | null;
  lookTitle: string | null;
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

/** Load a look's showcase bytes: local `public/` first, APP_URL only as a fallback. */
export async function loadLookShowcaseBytes(
  lookId: string,
  loaders?: LookShowcaseLoaders,
): Promise<{ bytes: Buffer; mimeType: string; source: 'local' | 'remote' } | null> {
  const local = lookShowcaseLocalPath(lookId);
  if (!local) return null;
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
    const style = getVisualStyle(lookId)!;
    const bytes = await (loaders?.fetchRemote ?? defaultFetchRemote)(`${base}/creator-showcases/${style.id}/image.webp`);
    if (bytes && bytes.length > 0 && bytes.length <= MAX_SHOWCASE_BYTES) {
      return { bytes, mimeType: LOOK_STYLE_REFERENCE_MIME, source: 'remote' };
    }
  } catch {
    // Unreachable — the render falls back to text-to-image.
  }
  return null;
}

/**
 * Should this render carry the look's sample as a style reference, and if so,
 * the bytes. Never throws; any failure is a status, and the render proceeds
 * text-to-image.
 */
export async function resolveLookStyleReference(
  metadata: Record<string, unknown>,
  loaders?: LookShowcaseLoaders,
): Promise<LookStyleReferenceResolution> {
  const lookId = lookIdFromRenderMetadata(metadata);
  const lookTitle = lookId ? getVisualStyle(lookId)?.title ?? null : null;
  const base = { lookId, lookTitle, reference: null };
  if (!lookId) return { ...base, status: 'not_requested' };
  const requested = lookVariationFromRenderMetadata(metadata) !== null || creatorImageReferenceModeEnabled();
  if (!requested) return { ...base, status: 'not_requested' };
  // THE kill switch: an explicit non-'edit' CREATOR_IMAGE_REFERENCE_MODE.
  if (!userReferenceDeliveryAllowed()) return { ...base, status: 'disabled' };
  const loaded = await loadLookShowcaseBytes(lookId, loaders).catch(() => null);
  if (!loaded) return { ...base, status: 'unavailable' };
  return { ...base, status: 'attached', reference: loaded };
}

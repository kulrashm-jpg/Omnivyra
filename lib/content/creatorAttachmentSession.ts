/**
 * CreatorAttachmentSession — the ONE canonical owner of the asset-attachment
 * lifecycle: Launch → Configuration → Generation → Preview → Attachment → Return
 * → Schedule.
 *
 * It consolidates the previously-scattered ephemeral state (the
 * `writer_creator_prefill_<token>` payload + the `return_to` query param + the
 * implicit draft token) into a SINGLE sessionStorage object, and owns the
 * attach + return orchestration. Durable persistence stays canonical
 * (`appendWriterAttachedAssetDurable`) — the session calls it, never duplicates it.
 *
 * Creator never learns Writer internals: it only loads the session and calls
 * `attachAssetToSession()`. Writer consumes the durable store + the session's
 * return destination. New launch sources (Campaign Creator / Automation /
 * Calendar / AI Assistant / Workflow Engine) are launch ADAPTERS over
 * `createAttachmentSession` — no lifecycle changes.
 */

import {
  appendWriterAttachedAssetDurable,
  getWriterCreatorPrefillKey,
  type WriterCreatorSourcePayload,
  type WriterAttachedAsset,
  type WriterSourceType,
} from './writerCreatorAssetLaunch';
import type { AttachmentMode, SourceTextTransform } from './writerCreatorAttachmentContracts';
import {
  registerGeneratedAsset,
  addAssetVersion,
  type CreatorAssetRef,
} from './creatorAssetLibrary';
import { attachUsage, writerDraftConsumer } from './creatorAssetUsageGraph';
import { convergeCreatorAssetId } from './creatorAssetIdentity';

export type AttachmentLaunchSource =
  | 'writer'
  | 'campaign-creator'
  | 'automation'
  | 'content-calendar'
  | 'ai-assistant'
  | 'workflow-engine';

export interface CreatorAttachmentSession {
  token: string;
  source: AttachmentLaunchSource;
  /** Canonical launch context (today: the writer source payload). */
  launchContext: WriterCreatorSourcePayload;
  /** Internal path to return to after attach (owned here — no page reads return_to). */
  returnDestination: string | null;
  /** The draft this attaches to. */
  draft: { sourceType: WriterSourceType; sourceId: string; companyId: string | null };
  /** Routing/composition resolved at launch. */
  assetType: string;
  attachmentMode: AttachmentMode | null;
  sourceTextTransform: SourceTextTransform | null;
  layout: string | null;
  platform: string | null;
  /** Lifecycle — REFERENCES only (assetId + version + selectedVariant). The
   *  canonical payloads live in the Creator Asset Library, never here. */
  assets: CreatorAssetRef[];
  selectedRef: CreatorAssetRef | null;
  attachmentState: 'pending' | 'attached';
  regenerationHistory: Array<{ at: string; assetId: string | null }>;
  replacementHistory: Array<{ at: string; fromAssetId: string | null; toAssetId: string | null }>;
  createdAt: string;
}

const sessionKey = (token: string) => `creator_attachment_session_${token}`;

export function saveAttachmentSession(session: CreatorAttachmentSession): void {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.setItem(sessionKey(session.token), JSON.stringify(session)); } catch { /* ignore */ }
}

/** Adapt a legacy bare prefill payload into a minimal session (back-compat). */
function adaptLegacyPayload(lc: WriterCreatorSourcePayload, token: string): CreatorAttachmentSession {
  return {
    token, source: 'writer', launchContext: lc, returnDestination: null,
    draft: { sourceType: lc.sourceType, sourceId: lc.sourceId, companyId: null },
    assetType: lc.compositionIntent?.assetType ?? 'supporting_image',
    attachmentMode: lc.compositionIntent?.attachmentMode ?? null,
    sourceTextTransform: lc.compositionIntent?.copyPolicy?.sourceTextTransform ?? null,
    layout: null, platform: lc.platform ?? null,
    assets: [], selectedRef: null, attachmentState: 'pending',
    regenerationHistory: [], replacementHistory: [], createdAt: lc.createdAt ?? '',
  };
}

export function loadAttachmentSession(token: string): CreatorAttachmentSession | null {
  if (typeof window === 'undefined' || !token) return null;
  try {
    const raw = window.sessionStorage.getItem(sessionKey(token));
    if (raw) return JSON.parse(raw) as CreatorAttachmentSession;
    const legacy = window.sessionStorage.getItem(getWriterCreatorPrefillKey(token));
    if (legacy) return adaptLegacyPayload(JSON.parse(legacy) as WriterCreatorSourcePayload, token);
    return null;
  } catch { return null; }
}

export interface CreateAttachmentSessionInput {
  source?: AttachmentLaunchSource;
  launchContext: WriterCreatorSourcePayload;
  returnDestination?: string | null;
  companyId?: string | null;
  assetType: string;
  attachmentMode?: AttachmentMode | null;
  sourceTextTransform?: SourceTextTransform | null;
  layout?: string | null;
  platform?: string | null;
  /** Injectable for deterministic tests. */
  token?: string;
  now?: string;
}

/**
 * Launch adapter — create + persist the session. Every launch source (Writer
 * today, Campaign Creator / Automation / … tomorrow) calls this; nothing else
 * about the lifecycle changes.
 */
export function createAttachmentSession(input: CreateAttachmentSessionInput): CreatorAttachmentSession {
  const lc = input.launchContext;
  const token = input.token ?? `${lc.sourceType}_${input.assetType}_${(input.now ? Date.parse(input.now) : Date.now())}`;
  const dest = input.returnDestination && input.returnDestination.startsWith('/') ? input.returnDestination : null;
  const session: CreatorAttachmentSession = {
    token,
    source: input.source ?? 'writer',
    launchContext: lc,
    returnDestination: dest,
    draft: { sourceType: lc.sourceType, sourceId: lc.sourceId, companyId: input.companyId ?? null },
    assetType: input.assetType,
    attachmentMode: input.attachmentMode ?? lc.compositionIntent?.attachmentMode ?? null,
    sourceTextTransform: input.sourceTextTransform ?? lc.compositionIntent?.copyPolicy?.sourceTextTransform ?? null,
    layout: input.layout ?? null,
    platform: input.platform ?? lc.platform ?? null,
    assets: [],
    selectedRef: null,
    attachmentState: 'pending',
    regenerationHistory: [],
    replacementHistory: [],
    createdAt: input.now ?? new Date().toISOString(),
  };
  saveAttachmentSession(session);
  return session;
}

/**
 * Attach a generated asset to its session. The asset is FIRST registered in the
 * canonical Creator Asset Library (stable id + version) — that's the single
 * source of truth. The session then stores only a REFERENCE. Re-attaching within
 * a session (regeneration) adds a new VERSION to the same library asset, so
 * existing references keep resolving. Durable writer persistence references the
 * same stable Asset ID (no duplicated session payload). Creator never touches
 * Writer internals — it just calls this.
 */
export async function attachAssetToSession(
  token: string,
  payload: WriterAttachedAsset,
  opts?: { companyId?: string | null; sourceContent?: Record<string, unknown>; now?: string },
): Promise<CreatorAttachmentSession | null> {
  const session = loadAttachmentSession(token);
  const at = opts?.now ?? new Date().toISOString();

  // 1) Library is the single source of truth (async backend). Re-attach in-session
  //    = a new version of the currently-selected asset; first attach = a new asset.
  const registered = session?.selectedRef
    ? (await addAssetVersion(session.selectedRef.assetId, payload, 'regenerate', { now: at })
        ?? await registerGeneratedAsset(payload, { op: 'generate', now: at }))
    : await registerGeneratedAsset(payload, { op: 'generate', now: at });
  let ref = registered.ref;

  // 2) Durable writer persistence returns the CANONICAL persisted Asset ID.
  const persisted = await appendWriterAttachedAssetDurable({
    companyId: opts?.companyId ?? session?.draft.companyId ?? null,
    sourceType: session?.draft.sourceType ?? 'post',
    sourceId: session?.draft.sourceId ?? '',
    asset: { ...payload, id: ref.assetId },
    sourceContent: opts?.sourceContent,
  });

  // 2b) Identity convergence — replace the temporary factory id with the canonical
  //     persisted id across Library + Usage Graph BEFORE the edge is recorded, so the
  //     server resolver can resolve this asset in the SAME session. No-op offline /
  //     when persistence echoes the temp id (caller keeps the temp ref as fallback).
  if (persisted?.id && persisted.id !== ref.assetId) {
    const canonical = await convergeCreatorAssetId(ref.assetId, persisted.id, { now: at });
    if (canonical) ref = canonical;
  }

  // 3) Relationship ownership lives in the canonical Usage Graph — the session
  //    no longer infers "where the asset is used"; it just records the edge.
  if (session) {
    await attachUsage(ref, writerDraftConsumer(session.draft.sourceType, session.draft.sourceId), { role: 'attachment', now: at });
  }

  if (!session) return null;

  // 4) Session stores REFERENCES only (its own resume state).
  const prev = session.selectedRef;
  const next: CreatorAttachmentSession = {
    ...session,
    assets: [ref, ...session.assets.filter((r) => r.assetId !== ref.assetId)].slice(0, 12),
    selectedRef: ref,
    attachmentState: 'attached',
    regenerationHistory: [{ at, assetId: ref.assetId }, ...session.regenerationHistory].slice(0, 24),
    replacementHistory: prev && prev.assetId !== ref.assetId
      ? [{ at, fromAssetId: prev.assetId, toAssetId: ref.assetId }, ...session.replacementHistory].slice(0, 24)
      : session.replacementHistory,
  };
  saveAttachmentSession(next);
  return next;
}

/** Owned return destination — pages ask the session, never the URL. */
export function resolveReturnDestination(token: string): string | null {
  const dest = loadAttachmentSession(token)?.returnDestination ?? null;
  return dest && dest.startsWith('/') ? dest : null;
}

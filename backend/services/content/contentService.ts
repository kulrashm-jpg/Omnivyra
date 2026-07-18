/**
 * Canonical Content Service — Wave 1 spine over Supabase.
 *
 * The single write/read seam for the canonical Content entity and its children
 * (content_variant, content_asset, content_revision). See
 * supabase/migrations/20260718000000_canonical_content_foundation.sql.
 *
 * Design notes:
 *  - NEW SPINE for post/thread (which had no server persistence). blog/article/
 *    story are exposed as adapter-backed reads via `adaptExternalContent` — this
 *    service does NOT copy or backfill their rows.
 *  - Uses the shared service-role admin client (`backend/db/supabaseClient`),
 *    consistent with neighboring backend services. The service role bypasses
 *    RLS, so EVERY method is explicitly company-scoped (`.eq('company_id', …)`).
 *  - Rows are snake_case; the service maps them to/from the camelCase DTOs in
 *    lib/content/canonicalContent.ts. Callers never see snake_case.
 *  - Wave 1 only: NO originality/embeddings/memory/AI-consolidation/quality.
 */

import { supabase } from '../../db/supabaseClient';
import { canTransition } from '../../../lib/content/contentLifecycle';
import type {
  CanonicalContent,
  CanonicalContentType,
  ContentAssetLink,
  ContentLifecycleStatus,
  ContentRevision,
  ContentRevisionType,
  ContentSourceRef,
  ContentVariant,
  VariantApprovalState,
} from '../../../lib/content/canonicalContent';

const CONTENT_TABLE = 'content';
const VARIANT_TABLE = 'content_variant';
const ASSET_TABLE = 'content_asset';
const REVISION_TABLE = 'content_revision';

// ── error helper ────────────────────────────────────────────────────────────

function fail(op: string, error: { message?: string } | null): never {
  throw new Error(`[contentService] ${op} failed: ${error?.message ?? 'unknown error'}`);
}

// ── row ↔ DTO mappers ───────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

function asJson(value: any): Record<string, unknown> | null {
  if (value == null) return null;
  return value as Record<string, unknown>;
}

function mapContentRow(row: any): CanonicalContent {
  return {
    id: row.id,
    companyId: row.company_id,
    contentType: row.content_type as CanonicalContentType,
    lifecycleStatus: row.lifecycle_status as ContentLifecycleStatus,
    title: row.title ?? null,
    body: row.body ?? null,
    topic: row.topic ?? null,
    objective: row.objective ?? null,
    audience: row.audience ?? null,
    tone: row.tone ?? null,
    brief: asJson(row.brief),
    sourceMetadata: asJson(row.source_metadata),
    sourceRef: (row.source_ref ?? null) as ContentSourceRef | null,
    currentRevision: row.current_revision,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? null,
  };
}

function mapVariantRow(row: any): ContentVariant {
  return {
    id: row.id,
    contentId: row.content_id,
    companyId: row.company_id,
    platform: row.platform,
    sourceVersion: row.source_version,
    generatedContent: row.generated_content ?? null,
    editedContent: row.edited_content ?? null,
    adaptationMetadata: asJson(row.adaptation_metadata),
    approvalState: row.approval_state as VariantApprovalState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAssetRow(row: any): ContentAssetLink {
  return {
    id: row.id,
    contentId: row.content_id,
    variantId: row.variant_id ?? null,
    companyId: row.company_id,
    assetId: row.asset_id,
    role: row.role,
    version: row.version,
    metadata: asJson(row.metadata),
    createdAt: row.created_at,
  };
}

function mapRevisionRow(row: any): ContentRevision {
  return {
    id: row.id,
    contentId: row.content_id,
    companyId: row.company_id,
    revision: row.revision,
    revisionType: row.revision_type as ContentRevisionType,
    snapshot: (row.snapshot ?? {}) as Record<string, unknown>,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
  };
}

/**
 * The content fields captured in a revision snapshot. Kept in one place so
 * create/update snapshot identically.
 */
function snapshotFields(row: any): Record<string, unknown> {
  return {
    title: row.title ?? null,
    body: row.body ?? null,
    topic: row.topic ?? null,
    objective: row.objective ?? null,
    audience: row.audience ?? null,
    tone: row.tone ?? null,
    brief: row.brief ?? null,
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ── inputs ──────────────────────────────────────────────────────────────────

export interface CreateContentInput {
  companyId: string;
  contentType: CanonicalContentType;
  title?: string | null;
  body?: string | null;
  topic?: string | null;
  objective?: string | null;
  audience?: string | null;
  tone?: string | null;
  brief?: Record<string, unknown> | null;
  sourceMetadata?: Record<string, unknown> | null;
  sourceRef?: ContentSourceRef | null;
  lifecycleStatus?: ContentLifecycleStatus;
  createdBy?: string | null;
}

/** Mutable content fields patchable via `updateContent`. Lifecycle & revision
 *  bookkeeping are NOT patchable here (use `setLifecycleStatus`). */
export interface UpdateContentPatch {
  title?: string | null;
  body?: string | null;
  topic?: string | null;
  objective?: string | null;
  audience?: string | null;
  tone?: string | null;
  brief?: Record<string, unknown> | null;
  sourceMetadata?: Record<string, unknown> | null;
}

export interface ListContentFilter {
  contentType?: CanonicalContentType;
  status?: ContentLifecycleStatus;
  limit?: number;
}

export interface UpsertVariantData {
  generatedContent?: string | null;
  editedContent?: string | null;
  adaptationMetadata?: Record<string, unknown> | null;
  sourceVersion?: number;
  approvalState?: VariantApprovalState;
}

export interface AssociateAssetInput {
  assetId: string;
  variantId?: string | null;
  role?: string;
  version?: number;
  metadata?: Record<string, unknown> | null;
}

/**
 * An external (blog/article/story) row projected through the canonical read.
 * The adapter builds a read-through DTO; nothing is persisted.
 */
export interface ExternalContentRow {
  table: string;
  id: string;
  companyId: string;
  contentType: CanonicalContentType;
  title?: string | null;
  body?: string | null;
  topic?: string | null;
  objective?: string | null;
  audience?: string | null;
  tone?: string | null;
  brief?: Record<string, unknown> | null;
  sourceMetadata?: Record<string, unknown> | null;
  lifecycleStatus?: ContentLifecycleStatus;
  currentRevision?: number;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string | null;
}

// ── content ─────────────────────────────────────────────────────────────────

/**
 * Insert a canonical content row plus its initial revision (type 'generated',
 * revision 1). Returns the persisted DTO.
 */
export async function createContent(input: CreateContentInput): Promise<CanonicalContent> {
  const insertRow = {
    company_id: input.companyId,
    content_type: input.contentType,
    lifecycle_status: input.lifecycleStatus ?? 'draft',
    title: input.title ?? null,
    body: input.body ?? null,
    topic: input.topic ?? null,
    objective: input.objective ?? null,
    audience: input.audience ?? null,
    tone: input.tone ?? null,
    brief: input.brief ?? null,
    source_metadata: input.sourceMetadata ?? null,
    source_ref: input.sourceRef ?? null,
    current_revision: 1,
    created_by: input.createdBy ?? null,
  };

  const { data, error } = await supabase
    .from(CONTENT_TABLE)
    .insert(insertRow)
    .select('*')
    .single();
  if (error || !data) fail('createContent', error);

  // Initial revision snapshot.
  const { error: revError } = await supabase.from(REVISION_TABLE).insert({
    content_id: data.id,
    company_id: input.companyId,
    revision: 1,
    revision_type: 'generated',
    snapshot: snapshotFields(data),
    created_by: input.createdBy ?? null,
  });
  if (revError) fail('createContent(revision)', revError);

  return mapContentRow(data);
}

/** Fetch one company-scoped content row, or null if absent. */
export async function getContent(
  id: string,
  companyId: string,
): Promise<CanonicalContent | null> {
  const { data, error } = await supabase
    .from(CONTENT_TABLE)
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) fail('getContent', error);
  return data ? mapContentRow(data) : null;
}

/**
 * Apply a field patch, snapshot the new state as a revision, and bump
 * current_revision. `opts.revisionType` labels the snapshot.
 */
export async function updateContent(
  id: string,
  companyId: string,
  patch: UpdateContentPatch,
  opts: { revisionType: ContentRevisionType },
): Promise<CanonicalContent> {
  const existing = await getContent(id, companyId);
  if (!existing) fail('updateContent', { message: 'content not found for company' });

  const nextRevision = existing.currentRevision + 1;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const updateRow: Record<string, any> = { current_revision: nextRevision };
  if ('title' in patch) updateRow.title = patch.title ?? null;
  if ('body' in patch) updateRow.body = patch.body ?? null;
  if ('topic' in patch) updateRow.topic = patch.topic ?? null;
  if ('objective' in patch) updateRow.objective = patch.objective ?? null;
  if ('audience' in patch) updateRow.audience = patch.audience ?? null;
  if ('tone' in patch) updateRow.tone = patch.tone ?? null;
  if ('brief' in patch) updateRow.brief = patch.brief ?? null;
  if ('sourceMetadata' in patch) updateRow.source_metadata = patch.sourceMetadata ?? null;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const { data, error } = await supabase
    .from(CONTENT_TABLE)
    .update(updateRow)
    .eq('id', id)
    .eq('company_id', companyId)
    .select('*')
    .single();
  if (error || !data) fail('updateContent', error);

  const { error: revError } = await supabase.from(REVISION_TABLE).insert({
    content_id: id,
    company_id: companyId,
    revision: nextRevision,
    revision_type: opts.revisionType,
    snapshot: snapshotFields(data),
    created_by: existing.createdBy ?? null,
  });
  if (revError) fail('updateContent(revision)', revError);

  return mapContentRow(data);
}

/** List company content, newest-first, with optional type/status/limit filters. */
export async function listContent(
  companyId: string,
  filter: ListContentFilter = {},
): Promise<CanonicalContent[]> {
  let query = supabase
    .from(CONTENT_TABLE)
    .select('*')
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false });

  if (filter.contentType) query = query.eq('content_type', filter.contentType);
  if (filter.status) query = query.eq('lifecycle_status', filter.status);
  if (typeof filter.limit === 'number') query = query.limit(filter.limit);

  const { data, error } = await query;
  if (error) fail('listContent', error);
  return (data ?? []).map(mapContentRow);
}

/**
 * Validate the transition and set the lifecycle status. Sets/clears archived_at
 * to match the target state. Throws on a disallowed transition.
 */
export async function setLifecycleStatus(
  id: string,
  companyId: string,
  status: ContentLifecycleStatus,
): Promise<CanonicalContent> {
  const existing = await getContent(id, companyId);
  if (!existing) fail('setLifecycleStatus', { message: 'content not found for company' });

  if (!canTransition(existing.lifecycleStatus, status)) {
    fail(
      'setLifecycleStatus',
      { message: `illegal transition ${existing.lifecycleStatus} → ${status}` },
    );
  }

  const { data, error } = await supabase
    .from(CONTENT_TABLE)
    .update({
      lifecycle_status: status,
      archived_at: status === 'archived' ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .eq('company_id', companyId)
    .select('*')
    .single();
  if (error || !data) fail('setLifecycleStatus', error);
  return mapContentRow(data);
}

// ── variants ────────────────────────────────────────────────────────────────

/**
 * Upsert a platform variant on (content_id, platform). Re-adapting a platform
 * updates the existing variant in place. NEVER writes the parent content row.
 */
export async function upsertVariant(
  contentId: string,
  companyId: string,
  platform: string,
  data: UpsertVariantData,
): Promise<ContentVariant> {
  const row = {
    content_id: contentId,
    company_id: companyId,
    platform,
    source_version: data.sourceVersion ?? 1,
    generated_content: data.generatedContent ?? null,
    edited_content: data.editedContent ?? null,
    adaptation_metadata: data.adaptationMetadata ?? null,
    approval_state: data.approvalState ?? 'draft',
  };

  const { data: result, error } = await supabase
    .from(VARIANT_TABLE)
    .upsert(row, { onConflict: 'content_id,platform' })
    .select('*')
    .single();
  if (error || !result) fail('upsertVariant', error);
  return mapVariantRow(result);
}

/** List all platform variants for a content row (company-scoped). */
export async function listVariants(
  contentId: string,
  companyId: string,
): Promise<ContentVariant[]> {
  const { data, error } = await supabase
    .from(VARIANT_TABLE)
    .select('*')
    .eq('content_id', contentId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: true });
  if (error) fail('listVariants', error);
  return (data ?? []).map(mapVariantRow);
}

// ── assets ──────────────────────────────────────────────────────────────────

/**
 * Idempotently associate an asset with a content row (optionally a variant).
 * Mirrors the content_asset_unique_link_uidx (content_id, asset_id,
 * COALESCE(variant_id), version): an existing matching link is returned as-is
 * instead of creating a duplicate.
 */
export async function associateAsset(
  contentId: string,
  companyId: string,
  input: AssociateAssetInput,
): Promise<ContentAssetLink> {
  const variantId = input.variantId ?? null;
  const version = input.version ?? 1;

  let existingQuery = supabase
    .from(ASSET_TABLE)
    .select('*')
    .eq('content_id', contentId)
    .eq('company_id', companyId)
    .eq('asset_id', input.assetId)
    .eq('version', version);
  existingQuery = variantId === null
    ? existingQuery.is('variant_id', null)
    : existingQuery.eq('variant_id', variantId);

  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) fail('associateAsset(lookup)', existingError);
  if (existing) return mapAssetRow(existing);

  const { data, error } = await supabase
    .from(ASSET_TABLE)
    .insert({
      content_id: contentId,
      company_id: companyId,
      asset_id: input.assetId,
      variant_id: variantId,
      role: input.role ?? 'primary',
      version,
      metadata: input.metadata ?? null,
    })
    .select('*')
    .single();
  if (error || !data) fail('associateAsset', error);
  return mapAssetRow(data);
}

/** List all asset associations for a content row (company-scoped). */
export async function listAssets(
  contentId: string,
  companyId: string,
): Promise<ContentAssetLink[]> {
  const { data, error } = await supabase
    .from(ASSET_TABLE)
    .select('*')
    .eq('content_id', contentId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: true });
  if (error) fail('listAssets', error);
  return (data ?? []).map(mapAssetRow);
}

// ── revisions ───────────────────────────────────────────────────────────────

/** List revisions for a content row, most-recent first. */
export async function listRevisions(
  contentId: string,
  companyId: string,
): Promise<ContentRevision[]> {
  const { data, error } = await supabase
    .from(REVISION_TABLE)
    .select('*')
    .eq('content_id', contentId)
    .eq('company_id', companyId)
    .order('revision', { ascending: false });
  if (error) fail('listRevisions', error);
  return (data ?? []).map(mapRevisionRow);
}

/** Fetch a single revision by its monotonic number, or null. */
export async function getRevision(
  contentId: string,
  companyId: string,
  revision: number,
): Promise<ContentRevision | null> {
  const { data, error } = await supabase
    .from(REVISION_TABLE)
    .select('*')
    .eq('content_id', contentId)
    .eq('company_id', companyId)
    .eq('revision', revision)
    .maybeSingle();
  if (error) fail('getRevision', error);
  return data ? mapRevisionRow(data) : null;
}

// ── adapter (blog / article / story read-through) ───────────────────────────

/**
 * Build a canonical CanonicalContent DTO for an external (blog/article/story)
 * row WITHOUT persisting anything. `sourceRef` points back at the owning row so
 * consumers can read blog/article/story through the canonical shape. No copy,
 * no backfill — this is a pure projection.
 */
export function adaptExternalContent(row: ExternalContentRow): CanonicalContent {
  return {
    id: row.id,
    companyId: row.companyId,
    contentType: row.contentType,
    lifecycleStatus: row.lifecycleStatus ?? 'adapted',
    title: row.title ?? null,
    body: row.body ?? null,
    topic: row.topic ?? null,
    objective: row.objective ?? null,
    audience: row.audience ?? null,
    tone: row.tone ?? null,
    brief: row.brief ?? null,
    sourceMetadata: row.sourceMetadata ?? null,
    sourceRef: { table: row.table, id: row.id },
    currentRevision: row.currentRevision ?? 1,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt ?? new Date(0).toISOString(),
    updatedAt: row.updatedAt ?? row.createdAt ?? new Date(0).toISOString(),
    archivedAt: row.archivedAt ?? null,
  };
}

/**
 * Canonical Content — TypeScript DTOs (camelCase) mirroring the Wave 1
 * canonical-content schema (see supabase/migrations/20260718000000_canonical_content_foundation.sql).
 *
 * These are the single source-of-truth shapes for the canonical Content spine:
 * content → content_variant / content_asset / content_revision. DB columns are
 * snake_case; every field here is the camelCase mirror. jsonb columns are typed
 * as structured records where the shape is known and `Record<string, unknown>`
 * (or a narrow union) otherwise.
 *
 * Wave 1 scope only — NO originality/embeddings/memory/AI-consolidation/
 * quality-scoring surface. Additive + backward compatible.
 */

/**
 * The ONE canonical lifecycle. Mirrors the content.lifecycle_status CHECK.
 * Ordered progression is defined in contentLifecycle.ts (DEFAULT_LIFECYCLE).
 */
export type ContentLifecycleStatus =
  | 'draft'
  | 'generated'
  | 'edited'
  // WRITER-EXEC-005 Wave 4 (ADDITIVE): human/AI quality-review gate that sits
  // between 'edited' and 'approved'. Mirrors the widened content.lifecycle_status
  // CHECK in 20260718000002_content_quality_collaboration.sql. Every pre-existing
  // value remains valid; this only widens the set.
  | 'quality_reviewed'
  | 'approved'
  | 'adapted'
  | 'scheduled'
  | 'published'
  | 'archived';

/** Mirrors the content.content_type CHECK. */
export type CanonicalContentType = 'post' | 'thread' | 'blog' | 'article' | 'story';

/** Mirrors content_variant.approval_state CHECK. */
export type VariantApprovalState = 'draft' | 'approved' | 'rejected';

/** Mirrors content_revision.revision_type CHECK. */
export type ContentRevisionType = 'generated' | 'autosave' | 'manual' | 'pre_adapt' | 'pre_publish';

/**
 * Adapter link stored in content.source_ref for blog/article/story rows.
 * Points back at the owning table row so the adapter reads through without
 * copying/backfilling data. Matches the {"table","id"} jsonb shape and the
 * content_source_ref_uidx unique index.
 */
export interface ContentSourceRef {
  table: string;
  id: string;
}

/**
 * The canonical Content object (public.content).
 * NEW SPINE for post/thread; blog/article/story are adapter-backed reads that
 * carry a populated `sourceRef`.
 */
export interface CanonicalContent {
  id: string;
  companyId: string;
  contentType: CanonicalContentType;
  lifecycleStatus: ContentLifecycleStatus;
  title: string | null;
  body: string | null;
  topic: string | null;
  objective: string | null;
  audience: string | null;
  tone: string | null;
  /** Canonical brief / context snapshot captured at generation time. */
  brief: Record<string, unknown> | null;
  /** Generation trace, master_content, decision_trace, etc. */
  sourceMetadata: Record<string, unknown> | null;
  /** Adapter link for blog/article/story; null for native post/thread rows. */
  sourceRef: ContentSourceRef | null;
  currentRevision: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/**
 * A platform variant (public.content_variant) — a CHILD of a canonical Content
 * row. A variant NEVER overwrites its parent; it records how the parent was
 * adapted for one platform and keeps user edits separate from AI output.
 */
export interface ContentVariant {
  id: string;
  contentId: string;
  companyId: string;
  platform: string;
  /** Parent revision this variant derived from. */
  sourceVersion: number;
  generatedContent: string | null;
  editedContent: string | null;
  adaptationMetadata: Record<string, unknown> | null;
  approvalState: VariantApprovalState;
  createdAt: string;
  updatedAt: string;
}

/**
 * An asset association (public.content_asset). Association-only join with
 * version history; the asset bytes/library remain in creator_assets. `assetId`
 * is a SOFT reference (no hard FK).
 */
export interface ContentAssetLink {
  id: string;
  contentId: string;
  variantId: string | null;
  companyId: string;
  assetId: string;
  role: string;
  version: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * An autosave / undo / draft-recovery snapshot (public.content_revision).
 * `revision` is monotonic per content row; `snapshot` captures the content
 * fields at that revision.
 */
export interface ContentRevision {
  id: string;
  contentId: string;
  companyId: string;
  revision: number;
  revisionType: ContentRevisionType;
  snapshot: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
}

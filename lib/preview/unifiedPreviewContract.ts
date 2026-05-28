/**
 * G9 — Unified preview contract.
 *
 * Canonical, intentionally non-coercive shape describing data that any text-
 * content preview can render. Existing specialized renderers (PostPreviewModal's
 * per-platform faithful chrome, BlogEditorForm's longform editor) stay as-is —
 * they have legitimate reasons to be specialized. This contract is the surface
 * a NEW preview consumer should adopt, and what UnifiedTextPreview accepts.
 *
 * Re-exports the existing ThreadNode + CreatorAttachment types from
 * ThreadSequencePreview so all preview consumers see one canonical shape.
 */

export type {
  ThreadNode,
  CreatorAttachment,
} from '../../components/thread/ThreadSequencePreview';

export type UnifiedPreviewCreationMode = 'ai' | 'manual';

export type UnifiedPreviewPayload = {
  /** 'post' | 'thread' | 'newsletter' | 'article' | 'guide' | etc. */
  contentType: string;
  /** Origin mode — informs empty-state copy and minor framing. */
  creationMode?: UnifiedPreviewCreationMode;
  /** Single-block text body (post, single-platform variant). */
  text?: string;
  /** Multi-node sequence (threads). When present, takes precedence over `text`. */
  threadNodes?: import('../../components/thread/ThreadSequencePreview').ThreadNode[];
  /** Asset attachments. Per-node attachments belong on the node, not here. */
  assets?: import('../../components/thread/ThreadSequencePreview').CreatorAttachment[];
  /** Target platforms. When empty/omitted, a single generic card is rendered. */
  platforms?: string[];
  /** Free-form extension surface for renderer-specific hints. */
  metadata?: Record<string, unknown>;
};

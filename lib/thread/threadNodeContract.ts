/**
 * Phase 1B.1 — Server-canonical ThreadNode payload contract.
 *
 * SERVER-SIDE projection of the Phase 1A `ThreadNode` UI type. Carries the
 * fields needed for the multi-row insert path:
 *
 *   - position    (0-indexed; 0 = root)
 *   - content     (the per-node text)
 *   - attachments (G6/G2 — optional per-node attachments; see notes below)
 *
 * G6/G2 — per-node attachments:
 *   The `attachments` field is the canonical per-node attachment list. It is
 *   OPTIONAL and ADDITIVE: existing callers that omit it produce identical
 *   behavior to pre-G6 (text-only children). Callers that include it pass the
 *   attachments through the persistence wrapper, which in turn projects them
 *   into per-child `media_urls` + `media_types` arrays inside the
 *   `insert_thread_atomic` / `replace_thread_children` RPC payloads.
 *
 *   Activation requires the migration `20260809_thread_per_node_attachments.sql`
 *   to be applied. Until then, the new fields in the RPC payload are silently
 *   ignored by Postgres (JSONB extraction is no-error on missing keys), so the
 *   contract change is forward-compatible with the un-migrated RPC.
 */

import {
  parseCanonicalAttachments,
  type CanonicalAttachment,
} from '@/lib/shared/attachments/canonicalAttachment';

export type ThreadNodePayload = {
  position: number;
  content: string;
  /** G6/G2 — optional per-node attachments. Empty array == no attachments. */
  attachments?: CanonicalAttachment[];
};

/**
 * Permissive parser. Returns a validated ThreadNodePayload[] or null.
 *
 * G2-final — asset-only node policy:
 *   A node is valid when it has EITHER non-empty content OR at least one
 *   attachment. A node with both empty content AND no attachments is
 *   genuinely empty and fails the whole parse (returns null). This matches
 *   platform reality:
 *     - Twitter / Instagram / Facebook: text-only OR media-only nodes are
 *       legitimate (e.g. an image-only tweet in a chain).
 *     - LinkedIn: prefers text, but the publisher's platform-readiness
 *       guards reject any node a specific platform can't handle. The
 *       parser stays permissive; the publisher remains the platform-rule
 *       gatekeeper.
 *   Empty-everywhere nodes have no useful meaning and indicate a UI bug,
 *   so the parser still rejects them.
 */
export function parseThreadNodesPayload(raw: unknown): ThreadNodePayload[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ThreadNodePayload[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry || typeof entry !== 'object') return null;
    const obj = entry as Record<string, unknown>;
    const positionRaw = obj.position;
    const contentRaw = obj.content;
    const position = typeof positionRaw === 'number' ? positionRaw : Number(positionRaw);
    const content = typeof contentRaw === 'string' ? contentRaw : '';
    if (!Number.isFinite(position) || position < 0) return null;
    // G6/G2 — parse per-node attachments. Permissive: malformed entries are
    // dropped silently (an empty array is a valid no-attachments result).
    const attachments = parseCanonicalAttachments(obj.attachments);
    if (!content.trim() && attachments.length === 0) return null;
    out.push({
      position,
      content,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
  }
  // Stable sort by position so root is always at index 0
  out.sort((a, b) => a.position - b.position);
  return out;
}

/**
 * Per-platform content_type for thread nodes.
 *
 *   - twitter  → 'thread'  (chk_content_type allows 'thread' for twitter)
 *   - linkedin → 'post'    (chk_content_type allows only post/article/video/audio_event)
 *   - others   → 'post'    (safe default; specific platforms can extend later)
 *
 * Must align with the chk_content_type constraint defined in
 * database/comprehensive-scheduling-schema.sql:706
 */
export function coerceThreadContentTypeForPlatform(platform: string): string {
  const key = String(platform || '').toLowerCase().trim();
  if (key === 'twitter') return 'thread';
  return 'post';
}

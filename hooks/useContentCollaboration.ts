/**
 * useContentCollaboration — client collaboration primitives for one canonical
 * piece of content (WRITER-EXEC-005 Wave 4, items 4 / 6 / 8).
 *
 * Loads the section blocks, the deterministic recommendations, and the quality
 * scorecard for a `contentId`, and exposes the human↔AI collaboration surface:
 * accept / reject / accept-all recommendations, restore the original text,
 * compare a recommendation's before/after, and lock a section against automated
 * rewrites.
 *
 * ADDITIVE + backward compatible: with a null `contentId` the hook is fully
 * INERT (returns nulls / no-ops), so legacy callers that have no content id keep
 * working exactly as before.
 *
 * Client-side enforcement (belt to the server's authority):
 *   - LOCKED section → all recommendations targeting it are marked
 *     non-applicable (`nonApplicableReason: 'locked'`) and cannot be accepted.
 *     AI may not modify a locked block.
 *   - MANUAL PRECEDENCE → a manual edit to a block sets `manuallyEdited` and
 *     changes the block text, which makes any recommendation whose `before` no
 *     longer matches the block STALE (`nonApplicableReason: 'stale'`). Accepting
 *     a stale rec is blocked (and reported) unless the caller passes
 *     `{ force: true }`. Manual edits take precedence over automated suggestions.
 *
 * All shapes come from the shared Wave-4 contract lib/content/quality/types.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ContentBlock,
  ContentBlockType,
  QualityScorecard,
  Recommendation,
} from '../lib/content/quality/types';

// ── public types ──────────────────────────────────────────────────────────────

/** A working block: the contract block plus local collaboration state. */
export interface CollaborationBlock extends ContentBlock {
  /** True once the user has manually edited this block (manual precedence). */
  manuallyEdited: boolean;
}

/** Why a recommendation cannot currently be applied. `null` = applicable. */
export type NonApplicableReason = 'locked' | 'stale' | null;

/** A recommendation annotated with client-side applicability. */
export interface AnnotatedRecommendation extends Recommendation {
  /** False when the rec cannot be applied right now (locked / stale). */
  applicable: boolean;
  /** The reason it is non-applicable, or null when applicable. */
  nonApplicableReason: NonApplicableReason;
}

/** Outcome of an accept attempt. */
export interface AcceptResult {
  ok: boolean;
  reason?: Exclude<NonApplicableReason, null> | 'not_found' | 'inert' | 'already_resolved';
  recommendationId?: string;
}

export interface UseContentCollaborationOptions {
  /** Company scope for the REST endpoints (required to hit the network). */
  companyId?: string | null;
}

export interface UseContentCollaborationResult {
  blocks: CollaborationBlock[] | null;
  /** Recommendations annotated with client-side applicability. */
  recommendations: AnnotatedRecommendation[] | null;
  quality: QualityScorecard | null;
  loading: boolean;
  error: string | null;

  /** Accept one recommendation. Blocked when locked/stale unless `force`. */
  acceptRecommendation: (id: string, opts?: { force?: boolean }) => Promise<AcceptResult>;
  /** Reject one recommendation. */
  rejectRecommendation: (id: string) => Promise<AcceptResult>;
  /** Accept every applicable, pending recommendation (skips locked/stale). */
  acceptAll: () => Promise<{ accepted: number; skipped: number }>;
  /** Restore all blocks + recommendation state to the originally-loaded copy. */
  restoreOriginal: () => void;
  /** The before/after text spans for a recommendation, or null if unknown. */
  compareChanges: (recId: string) => { before: string; after: string } | null;
  /** Lock / unlock a section against automated rewrites. */
  lockSection: (blockId: string, locked: boolean) => Promise<void>;
  /** Manually edit a block's text (sets `manuallyEdited`; manual precedence). */
  editBlock: (blockId: string, text: string) => void;

  /** Re-fetch blocks + recommendations + quality from the server. */
  reload: () => Promise<void>;
}

const INERT: UseContentCollaborationResult = {
  blocks: null,
  recommendations: null,
  quality: null,
  loading: false,
  error: null,
  acceptRecommendation: async () => ({ ok: false, reason: 'inert' }),
  rejectRecommendation: async () => ({ ok: false, reason: 'inert' }),
  acceptAll: async () => ({ accepted: 0, skipped: 0 }),
  restoreOriginal: () => {},
  compareChanges: () => null,
  lockSection: async () => {},
  editBlock: () => {},
  reload: async () => {},
};

// ── helpers ─────────────────────────────────────────────────────────────────

function buildQuery(companyId?: string | null): string {
  return companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
}

/** Stable key for a block whether or not it has been persisted. */
function blockKey(block: Pick<ContentBlock, 'id' | 'position'>): string {
  return block.id ?? `pos:${block.position}`;
}

function toCollaborationBlock(block: ContentBlock): CollaborationBlock {
  return { ...block, manuallyEdited: false };
}

/** Locate the block a recommendation targets (by blockId, else by section). */
function targetBlock(
  rec: Recommendation,
  blocks: CollaborationBlock[],
): CollaborationBlock | undefined {
  if (rec.blockId) {
    const byId = blocks.find((b) => b.id === rec.blockId);
    if (byId) return byId;
  }
  const section: ContentBlockType = rec.affectedSection;
  return blocks.find((b) => b.blockType === section);
}

/**
 * Annotate one recommendation with client-side applicability. A rec is
 * non-applicable when its target block is locked, or when the block's current
 * text no longer matches the rec's `before` (stale — a manual edit or a prior
 * accepted rec moved the text).
 */
function annotate(
  rec: Recommendation,
  blocks: CollaborationBlock[],
): AnnotatedRecommendation {
  // Already-resolved recs are never "applicable" for a fresh accept.
  if (rec.status !== 'pending') {
    return { ...rec, applicable: false, nonApplicableReason: null };
  }
  const block = targetBlock(rec, blocks);
  if (block && block.locked) {
    return { ...rec, applicable: false, nonApplicableReason: 'locked' };
  }
  // Stale: the target text drifted from what the rec was computed against.
  if (block && rec.before !== '' && block.text !== rec.before) {
    return { ...rec, applicable: false, nonApplicableReason: 'stale' };
  }
  return { ...rec, applicable: true, nonApplicableReason: null };
}

// ── hook ──────────────────────────────────────────────────────────────────────

/**
 * Collaboration primitives for one canonical content row. Pass `null` for
 * `contentId` to keep the hook inert (legacy callers).
 */
export function useContentCollaboration(
  contentId: string | null,
  opts: UseContentCollaborationOptions = {},
): UseContentCollaborationResult {
  const { companyId = null } = opts;
  const active = Boolean(contentId);

  // Server-loaded ("original") snapshots for restoreOriginal().
  const [serverBlocks, setServerBlocks] = useState<ContentBlock[]>([]);
  const [serverRecs, setServerRecs] = useState<Recommendation[]>([]);

  // Working copies.
  const [blocks, setBlocks] = useState<CollaborationBlock[]>([]);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [quality, setQuality] = useState<QualityScorecard | null>(null);
  const [loading, setLoading] = useState<boolean>(active);
  const [error, setError] = useState<string | null>(null);

  const contentIdRef = useRef<string | null>(contentId);
  const companyIdRef = useRef<string | null>(companyId);
  const blocksRef = useRef<CollaborationBlock[]>(blocks);
  const recsRef = useRef<Recommendation[]>(recs);
  contentIdRef.current = contentId;
  companyIdRef.current = companyId;
  blocksRef.current = blocks;
  recsRef.current = recs;

  // ---- Load ----------------------------------------------------------------
  const load = useCallback(async () => {
    const id = contentIdRef.current;
    if (!id) return;
    const q = buildQuery(companyIdRef.current);
    setLoading(true);
    setError(null);
    try {
      const [blocksRes, recsRes, qualityRes] = await Promise.all([
        fetch(`/api/content/${encodeURIComponent(id)}/blocks${q}`, { credentials: 'include' }),
        fetch(`/api/content/${encodeURIComponent(id)}/recommendations${q}`, { credentials: 'include' }),
        fetch(`/api/content/${encodeURIComponent(id)}/quality${q}`, { credentials: 'include' }),
      ]);

      const blocksBody = blocksRes.ok ? await blocksRes.json().catch(() => ({})) : {};
      const recsBody = recsRes.ok ? await recsRes.json().catch(() => ({})) : {};
      const qualityBody = qualityRes.ok ? await qualityRes.json().catch(() => ({})) : {};

      const loadedBlocks: ContentBlock[] = Array.isArray(blocksBody?.blocks)
        ? blocksBody.blocks
        : Array.isArray(blocksBody)
          ? blocksBody
          : [];
      const loadedRecs: Recommendation[] = Array.isArray(recsBody?.recommendations)
        ? recsBody.recommendations
        : Array.isArray(recsBody)
          ? recsBody
          : [];
      const loadedQuality: QualityScorecard | null =
        (qualityBody?.quality as QualityScorecard | undefined) ??
        (qualityBody?.scorecard as QualityScorecard | undefined) ??
        null;

      setServerBlocks(loadedBlocks);
      setServerRecs(loadedRecs);
      setBlocks(loadedBlocks.map(toCollaborationBlock));
      setRecs(loadedRecs);
      setQuality(loadedQuality);

      if (!blocksRes.ok && !recsRes.ok && !qualityRes.ok) {
        setError('Failed to load collaboration data');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load collaboration data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) {
      setServerBlocks([]);
      setServerRecs([]);
      setBlocks([]);
      setRecs([]);
      setQuality(null);
      setLoading(false);
      setError(null);
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, contentId, companyId]);

  // ---- Derived: annotated recommendations ----------------------------------
  const annotated = useMemo<AnnotatedRecommendation[]>(
    () => recs.map((rec) => annotate(rec, blocks)),
    [recs, blocks],
  );

  // ---- Network write helpers (best-effort; local state stays optimistic) ---
  const postRecommendation = useCallback(
    async (recommendationId: string, action: 'accept' | 'reject') => {
      const id = contentIdRef.current;
      if (!id) return;
      try {
        await fetch(`/api/content/${encodeURIComponent(id)}/recommendations${buildQuery(companyIdRef.current)}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, id: recommendationId, recommendationId }),
        });
      } catch {
        // Optimistic: keep the local change; the server is a durability belt.
      }
    },
    [],
  );

  const postBlock = useCallback(
    async (body: Record<string, unknown>) => {
      const id = contentIdRef.current;
      if (!id) return;
      try {
        await fetch(`/api/content/${encodeURIComponent(id)}/blocks${buildQuery(companyIdRef.current)}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {
        // Optimistic; ignore transient network errors.
      }
    },
    [],
  );

  // ---- Accept / reject -----------------------------------------------------
  const applyAccept = useCallback(
    (recId: string, force: boolean): AcceptResult => {
      const currentBlocks = blocksRef.current;
      const rec = recsRef.current.find((r) => r.id === recId);
      if (!rec) return { ok: false, reason: 'not_found', recommendationId: recId };
      if (rec.status !== 'pending') {
        return { ok: false, reason: 'already_resolved', recommendationId: recId };
      }

      const block = targetBlock(rec, currentBlocks);
      // Enforcement: never modify a locked section.
      if (block && block.locked) {
        return { ok: false, reason: 'locked', recommendationId: recId };
      }
      // Enforcement: manual precedence — a stale rec is blocked unless forced.
      const stale = Boolean(block && rec.before !== '' && block.text !== rec.before);
      if (stale && !force) {
        return { ok: false, reason: 'stale', recommendationId: recId };
      }

      // Apply: replace the block text with the rec's `after`, and mark the rec
      // accepted. An accepted AI change is not a manual edit.
      if (block && rec.after !== undefined) {
        setBlocks((prev) =>
          prev.map((b) =>
            blockKey(b) === blockKey(block) ? { ...b, text: rec.after, manuallyEdited: false } : b,
          ),
        );
      }
      setRecs((prev) => prev.map((r) => (r.id === recId ? { ...r, status: 'accepted' } : r)));
      return { ok: true, recommendationId: recId };
    },
    [],
  );

  const acceptRecommendation = useCallback(
    async (id: string, options?: { force?: boolean }): Promise<AcceptResult> => {
      const result = applyAccept(id, Boolean(options?.force));
      if (result.ok) await postRecommendation(id, 'accept');
      return result;
    },
    [applyAccept, postRecommendation],
  );

  const rejectRecommendation = useCallback(
    async (id: string): Promise<AcceptResult> => {
      const rec = recsRef.current.find((r) => r.id === id);
      if (!rec) return { ok: false, reason: 'not_found', recommendationId: id };
      if (rec.status !== 'pending') {
        return { ok: false, reason: 'already_resolved', recommendationId: id };
      }
      setRecs((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'rejected' } : r)));
      await postRecommendation(id, 'reject');
      return { ok: true, recommendationId: id };
    },
    [postRecommendation],
  );

  const acceptAll = useCallback(async (): Promise<{ accepted: number; skipped: number }> => {
    let accepted = 0;
    let skipped = 0;
    // Snapshot the pending rec ids; applyAccept re-reads live state each time so
    // staleness introduced by an earlier accept is honored for later recs.
    const pendingIds = recsRef.current.filter((r) => r.status === 'pending' && r.id).map((r) => r.id as string);
    for (const recId of pendingIds) {
      const result = applyAccept(recId, false);
      if (result.ok) {
        accepted += 1;
        await postRecommendation(recId, 'accept');
      } else {
        skipped += 1;
      }
    }
    return { accepted, skipped };
  }, [applyAccept, postRecommendation]);

  // ---- Restore / compare ---------------------------------------------------
  const restoreOriginal = useCallback(() => {
    setBlocks(serverBlocks.map(toCollaborationBlock));
    setRecs(serverRecs.map((r) => ({ ...r })));
  }, [serverBlocks, serverRecs]);

  const compareChanges = useCallback(
    (recId: string): { before: string; after: string } | null => {
      const rec = recsRef.current.find((r) => r.id === recId);
      if (!rec) return null;
      const block = targetBlock(rec, blocksRef.current);
      // Prefer the rec's own recorded spans; fall back to the live block text.
      const before = rec.before !== '' ? rec.before : block?.text ?? '';
      return { before, after: rec.after ?? '' };
    },
    [],
  );

  // ---- Lock / manual edit --------------------------------------------------
  const lockSection = useCallback(
    async (blockId: string, locked: boolean): Promise<void> => {
      setBlocks((prev) => prev.map((b) => (b.id === blockId ? { ...b, locked } : b)));
      await postBlock({ action: 'lock', blockId, locked });
    },
    [postBlock],
  );

  const editBlock = useCallback((blockId: string, text: string) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, text, manuallyEdited: true } : b)),
    );
  }, []);

  if (!active) return INERT;

  return {
    blocks,
    recommendations: annotated,
    quality,
    loading,
    error,
    acceptRecommendation,
    rejectRecommendation,
    acceptAll,
    restoreOriginal,
    compareChanges,
    lockSection,
    editBlock,
    reload: load,
  };
}

export default useContentCollaboration;

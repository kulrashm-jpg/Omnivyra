/**
 * useCanonicalContent — the single client source of truth for one canonical
 * piece of content (post/thread) addressed by id.
 *
 * Wave 1 (items 2/4/7): canonical content on the client + editing safety.
 * ADDITIVE + backward compatible: with a null `contentId` the hook is fully
 * INERT (returns nulls / no-ops), so legacy callers that have no content id
 * keep working exactly as before.
 *
 * Responsibilities:
 *   - Load the canonical content by id (GET /api/content/:id) on mount.
 *   - Keep a local working copy of the editable fields (setField / patch) with
 *     a `dirty` flag.
 *   - Autosave: debounced (~1.2s) PATCH with revisionType:'autosave' while
 *     dirty. Never fires when clean. Exposes `saving` / `lastSavedAt`.
 *   - Undo / redo over an in-memory snapshot stack seeded from the working copy.
 *     Undo/redo mutate the working copy and mark it dirty (which autosaves).
 *   - Unsaved-changes detection (`hasUnsavedChanges`) + a `beforeunload` guard
 *     registered only while dirty and torn down on cleanup.
 *   - Draft recovery: a TRANSIENT sessionStorage cache (keyed by contentId)
 *     lets a reload detect a locally-edited copy that differs from the server.
 *     The DB content is ALWAYS authoritative; recovery is opt-in via recover().
 *
 * Durable revision snapshots are produced server-side by every PATCH, so this
 * hook does not need to fetch the full revision list to function (GET
 * /revisions remains available for richer recovery UIs later).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CanonicalContent,
  ContentRevisionType,
} from '../lib/content/canonicalContent';

/** The editable subset of a canonical content row (mirrors UpdateContentPatch). */
export interface CanonicalWorkingCopy {
  title: string | null;
  body: string | null;
  topic: string | null;
  objective: string | null;
  audience: string | null;
  tone: string | null;
  brief: Record<string, unknown> | null;
  sourceMetadata: Record<string, unknown> | null;
}

const EDITABLE_KEYS: Array<keyof CanonicalWorkingCopy> = [
  'title',
  'body',
  'topic',
  'objective',
  'audience',
  'tone',
  'brief',
  'sourceMetadata',
];

export interface UseCanonicalContentOptions {
  /** Company scope for the canonical REST endpoints (required to hit the network). */
  companyId?: string | null;
  /** Autosave debounce window in ms. Default 1200. */
  autosaveDelayMs?: number;
  /** Set false to disable the debounced autosave (manual save() still works). Default true. */
  autosave?: boolean;
  /** Set false to disable the sessionStorage draft-recovery cache. Default true. */
  enableRecovery?: boolean;
}

export interface UseCanonicalContentResult {
  /** Live view: server content merged with local edits. Null when inert / not loaded. */
  content: CanonicalContent | null;
  /** Last known server-authoritative content (no local edits applied). */
  serverContent: CanonicalContent | null;
  loading: boolean;
  error: string | null;

  dirty: boolean;
  hasUnsavedChanges: boolean;
  saving: boolean;
  lastSavedAt: number | null;

  setField: <K extends keyof CanonicalWorkingCopy>(key: K, value: CanonicalWorkingCopy[K]) => void;
  patch: (partial: Partial<CanonicalWorkingCopy>) => void;
  /** Force an immediate save of the current working copy (flushes any pending autosave). */
  save: (revisionType?: ContentRevisionType) => Promise<void>;
  /** Re-fetch the server content, discarding local edits and the undo stack. */
  reload: () => Promise<void>;

  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  /** A locally-cached draft differs from the server copy and can be restored. */
  recoverable: boolean;
  /** Apply the cached local draft into the working copy (marks dirty → autosaves). */
  recover: () => void;
  /** Dismiss the recovery offer and drop the cached draft. */
  dismissRecovery: () => void;
}

const INERT: UseCanonicalContentResult = {
  content: null,
  serverContent: null,
  loading: false,
  error: null,
  dirty: false,
  hasUnsavedChanges: false,
  saving: false,
  lastSavedAt: null,
  setField: () => {},
  patch: () => {},
  save: async () => {},
  reload: async () => {},
  undo: () => {},
  redo: () => {},
  canUndo: false,
  canRedo: false,
  recoverable: false,
  recover: () => {},
  dismissRecovery: () => {},
};

function extractWorkingCopy(content: CanonicalContent): CanonicalWorkingCopy {
  return {
    title: content.title ?? null,
    body: content.body ?? null,
    topic: content.topic ?? null,
    objective: content.objective ?? null,
    audience: content.audience ?? null,
    tone: content.tone ?? null,
    brief: content.brief ?? null,
    sourceMetadata: content.sourceMetadata ?? null,
  };
}

/** Stable structural equality for the small editable subset. */
function sameWorkingCopy(a: CanonicalWorkingCopy | null, b: CanonicalWorkingCopy | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function recoveryKey(contentId: string): string {
  return `canonical-content-draft:${contentId}`;
}

function buildQuery(companyId?: string | null): string {
  return companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
}

/**
 * The single client source of truth for one canonical content row.
 * Pass `null` for contentId to keep the hook inert (legacy callers).
 */
export function useCanonicalContent(
  contentId: string | null,
  opts: UseCanonicalContentOptions = {},
): UseCanonicalContentResult {
  const { companyId = null, autosaveDelayMs = 1200, autosave = true, enableRecovery = true } = opts;

  const active = Boolean(contentId);

  const [serverContent, setServerContent] = useState<CanonicalContent | null>(null);
  const [working, setWorking] = useState<CanonicalWorkingCopy | null>(null);
  const [loading, setLoading] = useState<boolean>(active);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [recoverable, setRecoverable] = useState<boolean>(false);

  // Undo/redo snapshot stacks (in-memory). `undoStack` holds prior working
  // copies (most recent last); `redoStack` holds copies popped by undo().
  const [undoStack, setUndoStack] = useState<CanonicalWorkingCopy[]>([]);
  const [redoStack, setRedoStack] = useState<CanonicalWorkingCopy[]>([]);

  // Refs so the debounced autosave + beforeunload guard read live values
  // without re-subscribing on every keystroke.
  const workingRef = useRef<CanonicalWorkingCopy | null>(null);
  const dirtyRef = useRef<boolean>(false);
  const companyIdRef = useRef<string | null>(companyId);
  const contentIdRef = useRef<string | null>(contentId);
  const savingRef = useRef<boolean>(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cachedDraftRef = useRef<CanonicalWorkingCopy | null>(null);

  workingRef.current = working;
  dirtyRef.current = dirty;
  companyIdRef.current = companyId;
  contentIdRef.current = contentId;
  savingRef.current = saving;

  const writeRecoveryCache = useCallback(
    (copy: CanonicalWorkingCopy | null) => {
      if (!enableRecovery || typeof window === 'undefined') return;
      const id = contentIdRef.current;
      if (!id) return;
      try {
        if (copy) {
          window.sessionStorage.setItem(
            recoveryKey(id),
            JSON.stringify({ savedAt: Date.now(), working: copy }),
          );
        } else {
          window.sessionStorage.removeItem(recoveryKey(id));
        }
      } catch {
        // sessionStorage is a best-effort transient cache; ignore quota/security errors.
      }
    },
    [enableRecovery],
  );

  const readRecoveryCache = useCallback((id: string): CanonicalWorkingCopy | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(recoveryKey(id));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { working?: CanonicalWorkingCopy };
      return parsed && parsed.working && typeof parsed.working === 'object' ? parsed.working : null;
    } catch {
      return null;
    }
  }, []);

  // ---- Load (GET) ----------------------------------------------------------
  const load = useCallback(async () => {
    const id = contentIdRef.current;
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/content/${encodeURIComponent(id)}${buildQuery(companyIdRef.current)}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string })?.error || `Failed to load content (${res.status})`);
      }
      const data = (await res.json()) as { content?: CanonicalContent };
      const loaded = data.content ?? null;
      setServerContent(loaded);
      const seeded = loaded ? extractWorkingCopy(loaded) : null;
      setWorking(seeded);
      setDirty(false);
      setUndoStack([]);
      setRedoStack([]);

      // Draft recovery: compare the server copy to any cached local draft.
      if (loaded && enableRecovery) {
        const cached = readRecoveryCache(loaded.id);
        cachedDraftRef.current = cached;
        setRecoverable(Boolean(cached && seeded && !sameWorkingCopy(cached, seeded)));
      } else {
        cachedDraftRef.current = null;
        setRecoverable(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load content');
      setServerContent(null);
      setWorking(null);
    } finally {
      setLoading(false);
    }
  }, [enableRecovery, readRecoveryCache]);

  useEffect(() => {
    if (!active) {
      // Reset to inert state if the id is cleared.
      setServerContent(null);
      setWorking(null);
      setLoading(false);
      setError(null);
      setDirty(false);
      setRecoverable(false);
      setUndoStack([]);
      setRedoStack([]);
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, contentId, companyId]);

  // ---- Save (PATCH) --------------------------------------------------------
  const persist = useCallback(
    async (revisionType: ContentRevisionType) => {
      const id = contentIdRef.current;
      const copy = workingRef.current;
      if (!id || !copy) return;
      if (savingRef.current) return;
      setSaving(true);
      try {
        const res = await fetch(`/api/content/${encodeURIComponent(id)}${buildQuery(companyIdRef.current)}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patch: copy, revisionType }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string })?.error || `Failed to save content (${res.status})`);
        }
        const data = (await res.json()) as { content?: CanonicalContent };
        const saved = data.content ?? null;
        if (saved) {
          setServerContent(saved);
          // Only clear dirty if no edits landed while the request was in flight.
          const latest = workingRef.current;
          const savedCopy = extractWorkingCopy(saved);
          if (sameWorkingCopy(latest, savedCopy)) {
            setDirty(false);
          }
        }
        setLastSavedAt(Date.now());
        setError(null);
        // The server copy is now authoritative; drop the recovery offer.
        setRecoverable(false);
        cachedDraftRef.current = null;
        writeRecoveryCache(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save content');
      } finally {
        setSaving(false);
      }
    },
    [writeRecoveryCache],
  );

  const save = useCallback(
    async (revisionType: ContentRevisionType = 'manual') => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (!dirtyRef.current) return;
      await persist(revisionType);
    },
    [persist],
  );

  // ---- Debounced autosave --------------------------------------------------
  useEffect(() => {
    if (!active || !autosave) return;
    if (!dirty) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      // Guard re-check: never autosave a clean copy.
      if (dirtyRef.current) void persist('autosave');
    }, autosaveDelayMs);
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
    // `working` is a dep so each edit resets the debounce window.
  }, [active, autosave, dirty, working, autosaveDelayMs, persist]);

  // ---- Edit primitives -----------------------------------------------------
  // Commit a new working copy: push the previous copy to the undo stack,
  // clear redo, mark dirty, and refresh the transient recovery cache.
  const commit = useCallback(
    (next: CanonicalWorkingCopy) => {
      setWorking((prev) => {
        if (prev && sameWorkingCopy(prev, next)) return prev;
        if (prev) setUndoStack((stack) => [...stack, prev]);
        setRedoStack([]);
        setDirty(true);
        writeRecoveryCache(next);
        return next;
      });
    },
    [writeRecoveryCache],
  );

  const patch = useCallback(
    (partial: Partial<CanonicalWorkingCopy>) => {
      const base = workingRef.current;
      if (!base) return;
      commit({ ...base, ...partial });
    },
    [commit],
  );

  const setField = useCallback(
    <K extends keyof CanonicalWorkingCopy>(key: K, value: CanonicalWorkingCopy[K]) => {
      const base = workingRef.current;
      if (!base) return;
      if (!EDITABLE_KEYS.includes(key)) return;
      commit({ ...base, [key]: value });
    },
    [commit],
  );

  // ---- Undo / redo ---------------------------------------------------------
  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const prev = stack[stack.length - 1];
      const current = workingRef.current;
      if (current) setRedoStack((redo) => [...redo, current]);
      setWorking(prev);
      setDirty(true);
      writeRecoveryCache(prev);
      return stack.slice(0, -1);
    });
  }, [writeRecoveryCache]);

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const next = stack[stack.length - 1];
      const current = workingRef.current;
      if (current) setUndoStack((undoS) => [...undoS, current]);
      setWorking(next);
      setDirty(true);
      writeRecoveryCache(next);
      return stack.slice(0, -1);
    });
  }, [writeRecoveryCache]);

  // ---- Draft recovery ------------------------------------------------------
  const recover = useCallback(() => {
    const cached = cachedDraftRef.current;
    if (!cached) return;
    commit(cached);
    setRecoverable(false);
  }, [commit]);

  const dismissRecovery = useCallback(() => {
    setRecoverable(false);
    cachedDraftRef.current = null;
    writeRecoveryCache(null);
  }, [writeRecoveryCache]);

  // ---- beforeunload guard (only while dirty) -------------------------------
  useEffect(() => {
    if (!active || !dirty || typeof window === 'undefined') return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers require returnValue to be set to trigger the prompt.
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active, dirty]);

  // ---- Derived live view ---------------------------------------------------
  const content = useMemo<CanonicalContent | null>(() => {
    if (!serverContent) return null;
    if (!working) return serverContent;
    return { ...serverContent, ...working };
  }, [serverContent, working]);

  if (!active) return INERT;

  return {
    content,
    serverContent,
    loading,
    error,
    dirty,
    hasUnsavedChanges: dirty,
    saving,
    lastSavedAt,
    setField,
    patch,
    save,
    reload: load,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    recoverable,
    recover,
    dismissRecovery,
  };
}

export default useCanonicalContent;

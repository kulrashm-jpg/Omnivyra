/**
 * Long-Form Runtime Adapter (Writer Wave 3 — item 1, "one runtime, adapters
 * where required").
 *
 * The canonical `GenerationRuntime`
 * (backend/services/content/runtime/generationRuntime.ts) owns the short-form
 * post/thread pipeline directly. Long-form (blog / article / guide / newsletter
 * / whitepaper / story) is produced by its OWN quality-gated engines and MUST
 * NOT be rewritten. This adapter is the thin seam that lets long-form "flow
 * through the runtime envelope" (policy + observability) WITHOUT touching those
 * engines: it delegates the actual generation to the existing entry points
 * (runBlogGeneration / runArticleGeneration / runStoryGeneration) UNCHANGED and
 * returns their EXACT native result, wrapping only a fail-safe observability +
 * timing envelope around the call.
 *
 * Design constraints honoured:
 *  - Backward compatible: the delegated result is byte-identical to calling the
 *    engine directly. The envelope is side-effect-only (metrics/timing) and can
 *    never alter or break generation — every observability write is wrapped so a
 *    failing metric is swallowed.
 *  - Self-contained: this module deliberately does NOT import generationRuntime.ts
 *    so it stays build-safe while that module is authored concurrently. It exposes
 *    a small structural surface (`longFormRuntimeAdapter`) that the canonical
 *    GenerationRuntime can register/dispatch to once it lands.
 *
 * WAVE3-TODO: when generationRuntime.ts is present, register this adapter with it
 * (e.g. runtime.registerAdapter(longFormRuntimeAdapter)) so long-form requests are
 * dispatched here through the same envelope the short-form path uses. No engine
 * change is required for that wiring — this file is already the delegation seam.
 */

import {
  runBlogGeneration,
  type BlogGenerationRequest,
  type BlogGenerationResult,
} from '../../../../lib/blog/runBlogGeneration';
import {
  runArticleGeneration,
  type ArticleGenerationRequest,
  type ArticleGenerationResult,
} from '../../../../lib/article/runArticleGeneration';
import {
  runStoryGeneration,
  type StoryGenerationRequest,
  type StoryGenerationResult,
} from '../../../../lib/story/runStoryGeneration';
import { recordRawCounter } from '../../../observability';

/** Long-form content families this adapter fronts. */
export type LongFormKind = 'blog' | 'article' | 'story';

/** Fail-safe observability envelope. Never throws, never alters the result. */
async function withLongFormEnvelope<T>(
  kind: LongFormKind,
  companyId: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await run();
    safeCounter('content.longform.runtime.ok', { kind });
    safeTiming(kind, companyId, Date.now() - startedAt, 'ok');
    return result;
  } catch (error) {
    safeCounter('content.longform.runtime.error', { kind });
    safeTiming(kind, companyId, Date.now() - startedAt, 'error');
    // Preserve the engine's own failure semantics — the envelope only observes.
    throw error;
  }
}

function safeCounter(name: string, tags: Record<string, string>): void {
  try {
    recordRawCounter(name, 1, tags);
  } catch {
    /* observability is best-effort; never let a metric break generation */
  }
}

function safeTiming(
  kind: LongFormKind,
  companyId: string | undefined,
  durationMs: number,
  status: 'ok' | 'error',
): void {
  try {
    console.info('[content-runtime][longform]', { kind, companyId: companyId ?? null, durationMs, status });
  } catch {
    /* no-op */
  }
}

/**
 * The long-form adapter surface. Each method delegates to the existing engine
 * entry point unchanged and returns its native result; only the observability
 * envelope is added. The canonical GenerationRuntime registers/dispatches to
 * these once it is present (WAVE3-TODO above).
 */
export const longFormRuntimeAdapter = {
  /** Content families handled here (superset kinds map onto blog/article/story engines upstream). */
  kinds: ['blog', 'article', 'story'] as const,

  runBlog(req: BlogGenerationRequest): Promise<BlogGenerationResult> {
    return withLongFormEnvelope('blog', req.company_id, () => runBlogGeneration(req));
  },
  runArticle(req: ArticleGenerationRequest): Promise<ArticleGenerationResult> {
    return withLongFormEnvelope('article', req.company_id, () => runArticleGeneration(req));
  },
  runStory(req: StoryGenerationRequest): Promise<StoryGenerationResult> {
    return withLongFormEnvelope('story', req.company_id, () => runStoryGeneration(req));
  },
};

export type LongFormRuntimeAdapter = typeof longFormRuntimeAdapter;

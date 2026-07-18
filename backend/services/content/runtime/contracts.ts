/**
 * Writer Wave 3 — AI Runtime Consolidation: CANONICAL CONTRACTS.
 *
 * This module is the single, dependency-free source of truth for the interfaces
 * every Writer runtime component depends on. It defines the shapes that flow
 * between the future GenerationRuntime and its collaborators (context resolver,
 * prompt assembler, deterministic formatter, variant generator, originality
 * gate, persistence) so that model/temperature/format/retry decisions stop
 * being hardcoded at each call site and instead flow through one typed seam.
 *
 * SCOPE — Wave 3 only. Contracts + task-policy registry + deterministic
 * formatter. NO quality scoring / engagement / ranking surface. Every export
 * here is additive and type-only (interfaces + string unions); importing this
 * file has zero runtime cost and cannot change existing behavior.
 *
 * DETERMINISM — this file contains NO runtime logic. It is pure type
 * declarations. The one value-carrying concept (RetryPolicy.classify) is
 * declared as a method signature; its implementation lives in the registry.
 */

import type { OriginalityResult } from '../../../../lib/content/originality/types';

// ─────────────────────────────────────────────────────────────────────────────
// Content taxonomy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The canonical Writer content types. Mirrors CanonicalContentType in
 * lib/content/canonicalContent.ts (the DB content.content_type CHECK), restated
 * here so the runtime contracts carry no dependency on the persistence DTOs.
 */
export type WriterContentType = 'post' | 'thread' | 'blog' | 'article' | 'story';

/**
 * The tasks the task-policy registry can be asked about. Extends the content
 * types with the two cross-cutting generation tasks that already run with their
 * own distinct model/temperature today:
 *   - 'variant' — deterministic per-platform rewrite of an accepted master.
 *   - 'adapt'   — on-demand single-platform re-adaptation (quick-platform-adapt).
 */
export type WriterTask = WriterContentType | 'variant' | 'adapt';

// ─────────────────────────────────────────────────────────────────────────────
// Generation context + request/output
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The fully-resolved context a generation runs against. Produced by a
 * ContextResolver from a raw GenerationRequest: identity, platform profile,
 * brief, and originality context are all resolved once, up front, so the prompt
 * assembler and downstream stages never re-resolve them.
 */
export interface GenerationContext {
  companyId: string;
  contentType: WriterContentType;
  platform?: string;
  campaignId?: string;
  objective?: string;
  audience?: string;
  tone?: string;
  /** Resolved brand/company identity snapshot (opaque to the runtime spine). */
  brand?: unknown;
  /** Per-platform adaptation profile (see lib/content/platformAdaptationProfiles.ts). */
  platformProfile?: unknown;
  /** Originality/memory context threaded to the gate + regeneration nudge. */
  originalityContext?: unknown;
  /** Canonical brief/context snapshot captured at generation time. */
  brief?: Record<string, unknown>;
  /** Escape hatch for raw, not-yet-modelled request fields. */
  raw?: Record<string, unknown>;
}

/**
 * A fully-assembled prompt: the system + user messages that go to the provider,
 * plus optional non-message metadata (template name/version/hash, etc.).
 */
export interface PromptSet {
  system: string;
  user: string;
  meta?: Record<string, unknown>;
}

/**
 * The classified failure kinds a RetryPolicy distinguishes. Mirrors the AI
 * gateway's current behavior: rate-limit / overload / network is retryable
 * ('transient'/'provider'), timeouts are their own class, everything else is
 * fatal (no retry).
 */
export type RetryErrorClass = 'transient' | 'provider' | 'timeout' | 'fatal';

/**
 * The retry contract. `classify` maps an arbitrary error to a RetryErrorClass so
 * the runtime can decide whether to retry, fall back, or surface immediately.
 */
export interface RetryPolicy {
  /** Total attempts including the first (1 initial + N-1 retries). */
  maxAttempts: number;
  /** Base backoff between attempts, in milliseconds. */
  backoffMs: number;
  /** Classify a thrown error into a retry disposition. */
  classify(err: unknown): RetryErrorClass;
}

/**
 * The complete execution policy for one task: which model, at what temperature,
 * with what determinism seed, retry contract, timeout, cache, and streaming.
 * This is the object the registry hands back so call sites stop hardcoding
 * `model: process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0.7`.
 */
export interface TaskPolicy {
  model: string;
  temperature: number;
  /** Deterministic seed; null = opt-in (provider default, current behavior). */
  seed: number | null;
  retry: RetryPolicy;
  timeoutMs: number;
  cache: { enabled: boolean; key?: string };
  streaming: boolean;
}

/**
 * The raw request a caller submits to a GenerationRuntime. A superset of the
 * fields today's runPostGeneration accepts, kept open (`[k: string]: unknown`)
 * so callers can pass extra hints without a contract change.
 */
export interface GenerationRequest {
  companyId: string;
  contentType: WriterContentType;
  topic?: string;
  platform?: string;
  campaignId?: string;
  objective?: string;
  brief?: Record<string, unknown>;
  extraInstruction?: string;
  [k: string]: unknown;
}

/**
 * The normalized output of a generation. `master`/`variants` stay `unknown` so
 * the spine does not couple to the concrete MasterContentPayload /
 * PlatformVariantPayload shapes; callers narrow as needed.
 */
export interface GenerationOutput {
  master: unknown;
  variants?: unknown[];
  contentId?: string | null;
  originality?: OriginalityResult | null;
  metrics?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component interfaces — the seams a GenerationRuntime composes
// ─────────────────────────────────────────────────────────────────────────────

/** Resolves a raw request into a fully-populated GenerationContext. */
export interface ContextResolver {
  resolve(req: GenerationRequest): Promise<GenerationContext>;
}

/** Assembles the system + user prompt for a resolved context under a policy. */
export interface PromptAssembler {
  assemble(ctx: GenerationContext, policy: TaskPolicy): PromptSet;
}

/**
 * A pure, deterministic text transformer. Moves platform char-trimming, hashtag
 * placement, emoji spacing, and capitalization/spacing normalization OUT of the
 * model. `format` must be idempotent and side-effect-free.
 */
export interface Formatter {
  format(text: string, platform: string, contentType?: string): string;
}

/** Produces per-platform variants from an accepted master text. */
export interface VariantGenerator {
  generate(masterText: string, platforms: string[], ctx: GenerationContext): Promise<unknown[]>;
}

/** The originality gate — asserts a candidate is sufficiently original. */
export interface OriginalityGate {
  assert(input: {
    companyId: string;
    contentType: WriterContentType | string;
    platform?: string;
    candidateText: string;
  }): Promise<OriginalityResult>;
}

/** Persists an accepted generation and returns its canonical content id. */
export interface Persistence {
  persist(input: {
    context: GenerationContext;
    master: unknown;
    variants?: unknown[];
    originality?: OriginalityResult | null;
  }): Promise<{ contentId: string | null }>;
}

/**
 * The top-level runtime seam. THE single entry point interactive Writer
 * endpoints will depend on once Wave 3 wiring lands — composes the resolver,
 * assembler, formatter, variant generator, originality gate, and persistence
 * under the task policy resolved from the registry.
 */
export interface GenerationRuntime {
  generate(req: GenerationRequest): Promise<GenerationOutput>;
}

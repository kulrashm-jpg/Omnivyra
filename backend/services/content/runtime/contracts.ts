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
import type { CommunicationIntent, GenerationInstanceId } from '../../../platform/intelligence';

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
  /**
   * WS-1a (PMO-ADR-06) — the immutable Semantic Root this generation inherits
   * from, threaded once by the runtime. ADDITIVE + OPTIONAL: absent ⇒ the
   * pre-WS-1a code paths run byte-identically (flag OFF default). When present,
   * the prompt assembler and downstream stages source topic / communication
   * intent / core message from this single object instead of re-deriving them.
   */
  semanticRoot?: SemanticRoot;
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
  /**
   * WS-1c-2 (PMO-ADR-08) — NO-PERSIST MODE. Both flags are ADDITIVE + OPTIONAL and
   * default to TODAY's behavior, so a caller that passes neither runs
   * byte-identically to before this wave.
   *
   *   persist        — `false` ⇒ SKIP canonical persistence (createContent /
   *                    persistOriginality); `output.contentId` stays null. Does
   *                    NOT govern the content_memory write, which is its own
   *                    gated stage. Default (`undefined`/`true`) ⇒ persist as today.
   *   runOriginality — `false` ⇒ SKIP the originality gate + regeneration loop
   *                    (a single generation is produced); `output.originality` is
   *                    null. Default (`undefined`/`true`) ⇒ run the gate as today.
   *
   * Together `{ persist: false, runOriginality: false }` turns the ONE runtime
   * into a pure generation engine (context → prompt → generate → variants) that
   * persistence-free legacy generators can delegate to WITHOUT the runtime ever
   * double-persisting or re-running a gate they never had.
   */
  persist?: boolean;
  runOriginality?: boolean;
  /**
   * WS-1c-2b (PMO-ADR-08) — BOLT CONVERGENCE passthroughs. STRICTLY ADDITIVE +
   * OPTIONAL + OPT-IN. A caller that supplies NEITHER produces a BYTE-IDENTICAL
   * generation item to before this wave (buildGenerationItem emits the matching
   * `intent.pain_point` / `intent.outcome_promise` keys ONLY when the value is
   * present). These are NOT BOLT-specific concepts — the master generation
   * primitive (generateMasterContentFromIntent) already reads `intent.pain_point`
   * and `intent.outcome_promise` for EVERY content type; this simply lets any
   * caller thread the explicit audience problem + promised outcome through the
   * shared request instead of relying on the primitive's internal defaults. The
   * full `writer_content_brief` continues to flow through the existing `brief`
   * field (buildGenerationItem already passes it through as item.writer_content_brief).
   *
   *   painPoint      — the audience problem this content addresses.
   *   outcomePromise — the concrete outcome/value the reader should walk away with.
   */
  painPoint?: string;
  outcomePromise?: string;
  /**
   * WS-1c-3b (PMO-ADR-09) — TASK-PROFILE SELECTOR. STRICTLY ADDITIVE + OPTIONAL.
   * When set to a REGISTERED non-master profile key (e.g. 'day_content',
   * 'blueprint'), the runtime routes this request through that profile's
   * structured/blueprint output path instead of the default master path. Absent,
   * empty, 'master', or an unregistered value ⇒ the runtime runs the DEFAULT
   * master body BYTE-IDENTICALLY (existing callers never set this, so the master /
   * post / thread / #7 / BOLT paths are unperturbed). The profile path reuses the
   * ONE canonical context read + the ONE gateway; it produces a profile-specific
   * output shape (NOT `content: string`) and is persistence-free by contract
   * (the delegating family persists per its own legacy behavior).
   */
  taskProfile?: string;
  /**
   * WS-1c-3b — opaque per-profile input bag. A profile's buildMessages/parse read
   * their family-specific inputs (campaign/week/day/trend/angle/…) from here. Kept
   * unmodelled so adding a profile never changes this contract. Ignored entirely
   * by the master path.
   */
  taskProfileInput?: Record<string, unknown>;
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
  /**
   * WS-1a (PMO-ADR-06) — the Semantic Root this artifact inherited from, and the
   * continuity/lineage record linking it to persistence. Present ONLY when the
   * Semantic Spine is flag-enabled; absent ⇒ output is shape-identical to today.
   */
  semanticRoot?: SemanticRoot;
  semanticContinuity?: SemanticContinuity;
  /**
   * Orchestration-only visual bridge (no image call). Carries the semantic
   * lineage across to the (frozen) image seam: the visual brief is derived from
   * the content brief, the image text from the communication intent, and the
   * image prompt consumes the generated text rather than re-inventing context.
   */
  visualBrief?: VisualBrief;
  imagePromptSpec?: ImagePromptSpec;
}

// ─────────────────────────────────────────────────────────────────────────────
// WS-1a — Semantic Spine (PMO-ADR-06). A1 Module-owned. Pure type declarations.
//
// The canonical generation-time semantic IDENTITY every artifact inherits from.
// One immutable Semantic Root per request threads through the pipeline so no
// downstream stage can independently invent a different communication objective:
//   Business Goal → Campaign Goal? → Topic → Communication Intent → Core Message
//   → Content Brief → Generated Text → Visual Brief → Image Prompt → …
//
// IMMUTABILITY — every field is `readonly`; the builder (semanticSpine.ts)
// Object.freeze()s the constructed root so no later stage can mutate the shared
// identity. `publication_lineage` (Wave 5) remains the lifecycle EVENT LOG; the
// Semantic Root is the generation-time identity. They are LINKED (semanticRootId
// carried into lineage metadata / content.source_metadata), NOT duplicated.
// ─────────────────────────────────────────────────────────────────────────────

/** The canonical brief the Semantic Root carries (mirror of the resolved brief). */
export interface SemanticContentBrief {
  readonly topic: string;
  readonly objective?: string;
  readonly audience?: string;
  readonly tone?: string;
  readonly painPoint?: string;
  readonly outcomePromise?: string;
  readonly keyPoints?: readonly string[];
  /** The unmodelled remainder of the source brief, carried opaque. */
  readonly raw?: Record<string, unknown>;
}

/**
 * The immutable Semantic Root — one per generation request. All fields readonly;
 * the constructed instance is Object.freeze()d by the builder.
 */
export interface SemanticRoot {
  /**
   * The DETERMINISTIC grouping key (platform `SemanticRootId`, `sroot_<24-hex>`).
   * ICR-1 (TD-13): derived via the canonical platform `deriveSemanticRootId` from
   * (companyId, communicationIntent, campaignId, normalized topic), so the SAME
   * intent seed converges on the SAME id here (A1 producer) and in the A2
   * coordination layer. Per-run uniqueness now lives in `generationInstanceId`.
   */
  readonly semanticRootId: string;
  /** UNIQUE id for this concrete generation run (platform `sgen_<uuid>`). */
  readonly generationInstanceId: GenerationInstanceId;
  readonly businessGoalId?: string;
  readonly campaignId?: string;
  readonly topic: string;
  /** The communication objective — the ONE intent every stage must preserve. */
  readonly communicationIntent: CommunicationIntent;
  readonly coreMessage: string;
  readonly contentBrief: SemanticContentBrief;
  /** ISO creation time (identity provenance). */
  readonly createdAt: string;
}

/**
 * Semantic Continuity (lineage) — the reconstructable link between the immutable
 * Semantic Root and the persisted content. `generationLineageRef` is a SOFT
 * reference into the existing `publication_lineage` store (Wave 5); no second
 * lineage table/service is introduced.
 */
export interface SemanticContinuity {
  readonly semanticRootId: string;
  readonly communicationIntent: CommunicationIntent;
  readonly topic: string;
  readonly campaignId?: string;
  readonly contentId: string | null;
  /** Soft-ref into the ONE existing lineage store; NOT a parallel store. */
  readonly generationLineageRef: {
    readonly store: 'publication_lineage';
    readonly contentId: string | null;
    readonly semanticRootId: string;
  };
}

/**
 * Visual Brief — orchestration-only. Derived from the content brief; carries the
 * image text (derived from communication intent) and the semantic identity so a
 * downstream image stage inherits the SAME intent instead of re-deriving it.
 * This module never generates an image and never calls the image seam.
 */
export interface VisualBrief {
  readonly semanticRootId: string;
  readonly derivedFrom: 'content_brief';
  readonly topic: string;
  readonly communicationIntent: CommunicationIntent;
  readonly coreMessage: string;
  /** Image text derived from the communication intent (the on-image message). */
  readonly imageText: string;
  readonly visualTheme: string;
  readonly audience?: string;
  /**
   * WS-1b — the HUMAN-READABLE business objective inherited from the content
   * brief (NOT the canonical `communicationIntent` enum token). Carried so a
   * downstream image stage can narrate a natural objective (TD-15) instead of the
   * grouping-vocabulary token. ADDITIVE + OPTIONAL (A1 contract only).
   */
  readonly objective?: string;
  /** WS-1b — tone/positioning inherited from the content brief. ADDITIVE + OPTIONAL. */
  readonly tone?: string;
}

/**
 * Image Prompt Spec — orchestration-only. The image prompt CONSUMES the
 * generated text (passed in) rather than re-inventing context, preserving
 * continuity. No image is produced here.
 */
export interface ImagePromptSpec {
  readonly semanticRootId: string;
  readonly derivedFrom: 'generated_text';
  readonly imagePrompt: string;
  readonly imageText: string;
  readonly visualTheme: string;
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

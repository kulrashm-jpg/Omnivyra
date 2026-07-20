/**
 * WS-1c-3b (PMO-ADR-09) — TASK-PROFILE CAPABILITY: CONTRACTS.
 *
 * The runtime is single-master-shaped: `getTaskPolicy` throws for non-
 * `WriterContentType`, the master primitive returns a single `content: string`,
 * and `promptAssembler` builds ONE master prompt. Two live families do not fit
 * that shape (#9 day-content STRUCTURED object; #10 BLUEPRINT), so this module
 * adds an ADDITIVE "output/task profile" axis ALONGSIDE — never altering — the
 * closed master path.
 *
 * A task profile bundles the three things that vary between output families while
 * REUSING everything else the runtime already owns:
 *   - which content types / task keys it serves (the additive content-type axis);
 *   - prompt construction, sourced from the ONE canonical context read;
 *   - the execution policy (model / temperature / gateway operation / format);
 *   - the output shape + its parser/validator.
 *
 * The DEFAULT 'master' profile is NOT represented here — it stays implemented
 * inline in `generationRuntime.generate()` precisely so it remains byte-identical
 * (a registry entry would be a refactor of the sacred path). This registry holds
 * ONLY the non-master profiles; the runtime falls through to the master body when
 * no registered profile is selected.
 *
 * PURE TYPES — importing this file has zero runtime cost and cannot change
 * behavior.
 */

import type { NormalizedContentContext } from '../../../context/canonicalContentContextResolver';
import type { GenerationRequest } from '../contracts';

/**
 * The resolved context a profile runs against. `norm` is the SINGLE canonical
 * content-context read (resolveContentContext) — the same reader the master path
 * uses — so no profile re-implements company grounding. Family-specific inputs
 * (campaign/week/day/trend/angle/…) travel opaque on `req.taskProfileInput`.
 */
export interface TaskProfileContext {
  companyId: string;
  /** THE ONE canonical context read (brand identity / audience / tone / block). */
  norm: NormalizedContentContext;
  /** The raw request (carries topic/platform/objective + taskProfileInput). */
  req: GenerationRequest;
  /** Convenience accessor for the opaque per-profile input bag. */
  input: Record<string, unknown>;
}

/**
 * A profile's execution policy. Distinct from the closed 5-type `getTaskPolicy`
 * (which is untouched): a profile names its own gateway operation + model +
 * temperature + response format, matching the family it converges. This is how
 * the content-type/task axis is extended ADDITIVELY without altering the 5.
 */
export interface TaskProfilePolicy {
  model: string;
  temperature: number;
  /** The gateway `operation` label (billing/observability), matching legacy. */
  operation: string;
  /** JSON mode when the family requests structured output. */
  responseFormat?: { type: 'json_object' };
}

/** The system + user messages a profile feeds the ONE gateway. */
export interface TaskProfileMessages {
  system: string;
  user: string;
}

/**
 * A task profile. `TOutput` is the family's structured shape (day-content object,
 * blueprint, …). The runtime places it on `GenerationOutput.master` verbatim.
 */
export interface TaskProfile<TOutput = unknown> {
  /** The selector key callers pass as `req.taskProfile`. */
  readonly key: string;
  /**
   * The content types / task keys this profile serves — the ADDITIVE extension of
   * the content-type axis. Declarative only (used by tooling/tests); the runtime
   * selects on `key`, so declaring a superset type here never touches the closed 5.
   */
  readonly contentTypes: readonly string[];
  /** Resolve the execution policy for this request (family-faithful values). */
  policy(ctx: TaskProfileContext): TaskProfilePolicy;
  /** Build system+user messages from the canonical context + family inputs. */
  buildMessages(ctx: TaskProfileContext): TaskProfileMessages;
  /** Parse + validate the raw model output into the family's shape. */
  parse(raw: string, ctx: TaskProfileContext): TOutput;
}

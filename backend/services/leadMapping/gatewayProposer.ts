/**
 * PI-LDB-5 — the mapping engine's model-facing port, bound to the ONE approved
 * AI gateway.
 *
 * ─── WHAT THIS FILE IS, AND WHAT IT DELIBERATELY IS NOT ───────────────────
 * `mappingEngine.proposeFieldMappings()` takes an optional `MappingProposer`.
 * Until now nothing supplied one, so the engine ran on its six deterministic
 * signals alone — which works, and is why the import path was never broken by
 * the absence, but it also means no column was ever mapped by semantic
 * understanding. This file is that proposer, and nothing else:
 *
 *   - It is NOT a second AI client. It calls `runBilledAiCompletion`, the
 *     existing binding helper, which reserves credits, executes through
 *     `aiGateway.runCompletionWithOperation`, and partially confirms against
 *     actual token counts. There is no direct provider call here, no API key
 *     read here, and no second credit path.
 *   - It is NOT a scorer. The model's vote is one nomination among the
 *     deterministic signals; `mappingScorer` owns the number. See the note in
 *     `mappingTypes.ts` on why `ProposalFromModel` has no confidence field.
 *   - It is NOT a writer. It returns opinions about headers. The canonical
 *     write path stays behind `ingestionBoundary` and its column allowlist.
 *
 * ─── THE THREE THINGS A MODEL MUST NOT BE ABLE TO DO ──────────────────────
 * 1. INVENT A DESTINATION. The request carries the serialised registry and the
 *    response is filtered against it here, by key. The engine filters again in
 *    `indexModelProposals`. Two independent checks on purpose: this one keeps
 *    an invented destination out of the engine at all, and the engine's keeps
 *    the guarantee even if this file is replaced by another transport. A
 *    prompt-injected `"target": "users.password_hash"` is dropped by key
 *    lookup before it is ever a candidate, and no code path turns a string
 *    from the model into a column name.
 * 2. SEE A REAL CONTACT DETAIL. Samples arrive already redacted by
 *    `redactSamples`, and this file re-asserts that with `assertRedacted`
 *    immediately before the payload leaves the process. The engine asserts it
 *    too; the duplicate is cheap and this is the last line where it still
 *    matters.
 * 3. BE CACHED. `leadAttributeMapping` is registered in `NO_CACHE_OPS`
 *    (`aiResponseCache.ts`). Caching in this platform is opt-OUT: an operation
 *    absent from that set is cached, and `aiResponseCache` persists tokenised
 *    prompt words to Redis for near-match reuse. Redaction and the no-cache
 *    registration are BOTH required; neither is sufficient alone.
 *
 * ─── WHAT HAPPENS WHEN THE GATEWAY IS UNAVAILABLE ────────────────────────
 * This function throws, and `proposeFieldMappings` catches it, records ONE
 * `degraded` entry, and completes deterministically. An AI outage, an
 * exhausted credit balance, a missing pricing row or a malformed response
 * therefore lowers the QUALITY of a suggestion; it never takes an import down
 * and never silently drops a column. That is the whole reason the port is
 * optional.
 *
 * ─── UNAPPLIED DEPENDENCY (read before judging a production failure) ─────
 * `lead_attribute_mapping` is a new credit action. `assertCanonicalCreditAction`
 * hard-fails for an action the monetization registry cannot resolve, and
 * `fetchActionPricingRow` throws for an action with no `action_pricing_config`
 * row. The registry entry ships in this change; the two catalog rows ship in
 * migration `20270211000004`, which is NOT applied anywhere real. Until it is
 * applied, this proposer throws on every call and the engine degrades to
 * deterministic mapping. That is fail-closed and costs nothing — no credits
 * are reserved and no model call is made, because the assertion runs before
 * the executor — but it does mean AI mapping is dark in production until that
 * migration lands.
 */

// TYPE-ONLY, deliberately. A value import of the billing helper pulls the whole
// billing graph — and with it `@/config`, which validates the full environment
// at module load and throws without live Supabase, Redis, OpenAI and encryption
// credentials. Every existing billed caller in this repo therefore reaches it
// through `await import(...)` at call time (see pages/api/creator-templates/
// field-assist.ts and pages/api/campaign-content/assist.ts), and this file
// follows the same idiom. The practical effect is that the mapping ENGINE and
// its proposer stay loadable — and unit-testable — in a process that has no
// credentials at all, which is what makes the deterministic path testable
// without doubling it.
import type { runBilledAiCompletion } from '../billing/runBilledAiCompletion';
import type { CreditAction } from '../creditDeductionService';
import { assertRedacted } from './sampleRedaction';
import type {
  AllowedTarget,
  MappingProposer,
  ProposalFromModel,
  ProposerRequest,
} from './mappingTypes';

/**
 * The gateway operation name. Registered in TWO places that must stay in step:
 *   - `NO_CACHE_OPS` in `aiResponseCache.ts`, or the response is cached;
 *   - `process_type_mapping` in `shared/monetization/featureRegistry.ts`, or
 *     `logUsageEvent` silently refuses the `usage_events` row and the spend is
 *     unaccounted (the failure mode the F0 audit found on 23 process types).
 */
export const LEAD_ATTRIBUTE_MAPPING_OPERATION = 'leadAttributeMapping';

/**
 * The credit action. Token-priced through `llm_model_pricing`.
 *
 * Typed as `CreditAction` rather than a loose string so that removing it from
 * the union — which would break billing — fails the typecheck here instead of
 * at runtime inside `assertCanonicalCreditAction`.
 */
export const LEAD_ATTRIBUTE_MAPPING_ACTION: CreditAction = 'lead_attribute_mapping';

/** The model this operation is priced and budgeted for. */
export const LEAD_ATTRIBUTE_MAPPING_PROVIDER = 'openai';
export const LEAD_ATTRIBUTE_MAPPING_MODEL = 'gpt-4o-mini';

/**
 * Output budget. One line of JSON per header — a target key, up to two
 * alternates and a short reason — is comfortably under 60 tokens, so 40 per
 * header plus overhead is generous without leaving room for the model to
 * write an essay we would then truncate mid-JSON.
 */
const OUTPUT_TOKENS_PER_HEADER = 40;
const OUTPUT_TOKENS_FLOOR = 400;
const OUTPUT_TOKENS_CEILING = 3_000;

/** Input ceiling. `validateModelLimits` rejects a budget the model cannot hold. */
const INPUT_TOKENS_FLOOR = 1_500;
const INPUT_TOKENS_CEILING = 12_000;

/** How much model prose we keep. Surfaced to a tenant as context, never scored. */
const MAX_REASONING_CHARS = 240;

/** Alternates beyond the third add noise to a review screen, not information. */
const MAX_ALTERNATIVES = 3;

/** The verified caller. Never assembled from a request body. */
export interface GatewayProposerContext {
  /**
   * The VERIFIED tenant. This is the org the credits are reserved against and
   * the org the usage row is attributed to, so it must come from the session,
   * never from the payload being mapped.
   */
  tenantId: string;
  /** The acting user, for idempotency and the audit trail. */
  actorUserId: string;
  /** Which channel is importing. Part of the billing reference. */
  sourceType: string;
  /**
   * The header-set fingerprint from `fingerprintSchema`. Used as the billing
   * reference so the same schema is one identifiable unit of work.
   */
  schemaFingerprint: string;
}

/** Injected so the proposer is testable with no network, no key and no credit. */
export interface GatewayProposerDeps {
  runCompletion?: typeof runBilledAiCompletion;
}

/**
 * Resolves the real billing helper at call time. Separated so the dynamic
 * import has one home and the failure mode is one place: if the billing graph
 * cannot even be LOADED (a missing env var, most likely), that is a gateway
 * failure like any other and the engine degrades.
 */
async function loadBilledCompletion(): Promise<typeof runBilledAiCompletion> {
  const mod = await import('../billing/runBilledAiCompletion');
  return mod.runBilledAiCompletion;
}

/** Thrown for anything that should degrade the engine to deterministic mapping. */
export class GatewayProposerError extends Error {
  constructor(message: string, readonly kind: string) {
    super(message);
    this.name = 'GatewayProposerError';
  }
}

const SYSTEM_PROMPT = [
  'You map column headings from an imported prospect file onto a fixed list of',
  'destination fields. You are one opinion among several signals; a separate',
  'deterministic scorer decides the outcome, so do not argue for a choice.',
  '',
  'Rules:',
  '1. Choose `target` ONLY from the `allowedTargets` keys given to you. A key',
  '   that is not in that list is discarded, and the column is then treated as',
  '   having no suggestion at all.',
  '2. If a heading does not correspond to any allowed target, OMIT it. Do not',
  '   guess, and do not invent a destination. An omitted heading is preserved',
  '   with its original data; a wrong one corrupts a record.',
  '3. Distinguish a fact about the PERSON from a fact about their EMPLOYER.',
  '   Each allowed target states which entity it belongs to.',
  '4. Set `uncertain: true` when a heading could reasonably mean more than one',
  '   allowed target. A human is asked in that case, which is the right',
  '   outcome; a confident wrong answer is not.',
  '5. Sample values have been redacted to preserve shape and destroy identity.',
  '   Read them for TYPE evidence only. Never comment on an individual value.',
  '',
  'Reply with JSON only, as {"proposals": [...]} where each entry is',
  '{"sourceField": <exact heading as given>, "target": <allowed key>,',
  ' "alternatives": [<allowed keys>], "reasoning": <one short sentence>,',
  ' "confidence": <0..1>, "uncertain": <boolean>}.',
].join('\n');

/**
 * Builds the proposer. The returned function is what `proposeFieldMappings`
 * calls; everything it needs is captured here so the engine stays free of
 * billing, sessions and transport concerns.
 */
export function createGatewayMappingProposer(
  ctx: GatewayProposerContext,
  deps: GatewayProposerDeps = {},
): MappingProposer {
  return async (request: ProposerRequest): Promise<readonly ProposalFromModel[]> => {
    if (request.headers.length === 0) return [];

    // The last assertion before tenant data leaves this process. `redactSamples`
    // produced these and the engine already checked them; this is the boundary
    // where a regression upstream would otherwise become a disclosure.
    for (const values of Object.values(request.samples)) assertRedacted(values);

    const userPrompt = buildUserPrompt(request);
    const maxInputTokens = inputBudget(SYSTEM_PROMPT.length + userPrompt.length);
    const maxOutputTokens = outputBudget(request.headers.length);

    let text: string;
    try {
      const run = deps.runCompletion ?? (await loadBilledCompletion());
      const result = await run({
        module: 'service:lead_attribute_mapping',
        userId: ctx.actorUserId,
        orgId: ctx.tenantId,
        action: LEAD_ATTRIBUTE_MAPPING_ACTION,
        referenceType: 'source_mapping_profile',
        referenceId: `${ctx.sourceType}:${ctx.schemaFingerprint}`,
        llmPricing: {
          provider: LEAD_ATTRIBUTE_MAPPING_PROVIDER,
          model: LEAD_ATTRIBUTE_MAPPING_MODEL,
          maxInputTokens,
          maxOutputTokens,
          actionKey: LEAD_ATTRIBUTE_MAPPING_ACTION,
        },
        idempotency: {
          kind: 'http',
          actorUserId: ctx.actorUserId,
          action: LEAD_ATTRIBUTE_MAPPING_ACTION,
          referenceId: `${ctx.sourceType}:${ctx.schemaFingerprint}`,
          // The fingerprint identifies the header SET; the prompt digest
          // identifies this exact question. Re-proposing the same schema with
          // the same samples is absorbed as one charge, while a genuinely
          // different request — new samples, new field descriptions — is a
          // distinct unit of work rather than a silently reused answer.
          requestBody: { headers: request.headers, prompt: userPrompt },
        },
        note: `AI attribute mapping for ${ctx.sourceType} (${request.headers.length} columns)`,
        completion: {
          model: LEAD_ATTRIBUTE_MAPPING_MODEL,
          // Mapping is a classification, not a composition. The lowest
          // temperature the gateway accepts keeps the same file mapping the
          // same way twice, which is what makes a tenant's approved profile
          // worth storing.
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: maxOutputTokens,
          operation: LEAD_ATTRIBUTE_MAPPING_OPERATION,
          response_format: { type: 'json_object' },
          companyId: ctx.tenantId,
        },
      });
      text = result.text;
    } catch (error) {
      // Credit exhaustion, a missing pricing row, an org control block, a
      // provider outage — all the same to the engine, which degrades. The
      // kind is preserved so the degraded entry says something useful.
      throw new GatewayProposerError(
        error instanceof Error ? error.message : 'gateway call failed',
        'gateway_unavailable',
      );
    }

    return parseProposerResponse(text, request);
  };
}

/**
 * Validates a model response against the closed contract.
 *
 * Exported because this is the security boundary worth testing directly: it is
 * the function that has to hold when the model returns something nobody
 * anticipated. Per-entry, not all-or-nothing — one malformed entry must not
 * discard the work done on the other columns, which is the independence rule
 * `MappingEngineResult` states.
 */
export function parseProposerResponse(
  text: string,
  request: ProposerRequest,
): readonly ProposalFromModel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not recoverable and not ignorable: the engine should say it asked and
    // got nothing usable, rather than look as though it never asked.
    throw new GatewayProposerError('response was not JSON', 'malformed_response');
  }

  const entries = extractEntries(parsed);
  if (entries === null) {
    throw new GatewayProposerError('response had no proposals array', 'malformed_response');
  }

  // Exact header matching. A heading the model reworded is not the heading in
  // the file, and quietly fuzzy-matching it back would map a column the tenant
  // never saw named.
  const knownHeaders = new Set(request.headers);
  const allowed = new Map<string, AllowedTarget>(request.allowedTargets.map((t) => [t.key, t]));

  const out: ProposalFromModel[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (out.length >= request.headers.length) break;
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;

    const sourceField = typeof row.sourceField === 'string' ? row.sourceField : null;
    if (sourceField === null || !knownHeaders.has(sourceField)) continue;
    // First answer per column wins. A second one is a contradiction, and
    // picking the later would let a model override itself at the end of a
    // long response.
    if (seen.has(sourceField)) continue;

    const target = typeof row.target === 'string' ? row.target : null;
    // THE ALLOWLIST. Anything not a registry key — a column name, a table
    // name, an instruction, an empty string — stops here.
    if (target === null || !allowed.has(target)) continue;

    seen.add(sourceField);
    out.push({
      sourceField,
      target,
      alternatives: normaliseAlternatives(row.alternatives, allowed, target),
      reasoning: normaliseReasoning(row.reasoning),
      selfReportedConfidence: normaliseConfidence(row.confidence ?? row.selfReportedConfidence),
      uncertain: row.uncertain === true,
    });
  }

  return out;
}

/** Accepts `{proposals: [...]}` or a bare array, and nothing else. */
function extractEntries(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === 'object' && parsed !== null) {
    const candidate = (parsed as Record<string, unknown>).proposals;
    if (Array.isArray(candidate)) return candidate;
  }
  return null;
}

function normaliseAlternatives(
  raw: unknown,
  allowed: Map<string, AllowedTarget>,
  primary: string,
): readonly string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    if (!allowed.has(value)) continue;       // same allowlist, no exceptions
    if (value === primary) continue;          // an alternate to itself is noise
    if (out.includes(value)) continue;
    out.push(value);
    if (out.length >= MAX_ALTERNATIVES) break;
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Model prose, made safe to show a tenant: single line, length-capped. It is
 * displayed as context and never parsed, so the only risks are a run-on
 * paragraph in a review table and a newline breaking a log line.
 */
function normaliseReasoning(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (flat === '') return undefined;
  return flat.length > MAX_REASONING_CHARS ? `${flat.slice(0, MAX_REASONING_CHARS - 1)}…` : flat;
}

/**
 * Recorded on `ModelEcho` for later calibration and structurally unable to
 * reach the scorer. Out-of-range and non-finite values become `undefined`
 * rather than being clamped, because a model that answered `7` for a 0..1
 * field did not mean 1 — it did not answer the question.
 */
function normaliseConfidence(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  if (raw < 0 || raw > 1) return undefined;
  return raw;
}

function inputBudget(promptChars: number): number {
  // ~4 characters per token, plus headroom for the tokeniser splitting unusual
  // headings more finely than English prose.
  const estimate = Math.ceil(promptChars / 4) + 600;
  return Math.min(INPUT_TOKENS_CEILING, Math.max(INPUT_TOKENS_FLOOR, estimate));
}

function outputBudget(headerCount: number): number {
  const estimate = headerCount * OUTPUT_TOKENS_PER_HEADER + 200;
  return Math.min(OUTPUT_TOKENS_CEILING, Math.max(OUTPUT_TOKENS_FLOOR, estimate));
}

/**
 * The question, as JSON. Structured rather than prose because the headings are
 * tenant data: a heading containing "ignore the above" is a string in a JSON
 * value here, not a sentence in the middle of our instructions.
 */
function buildUserPrompt(request: ProposerRequest): string {
  return JSON.stringify({
    allowedTargets: request.allowedTargets.map((t) => ({
      key: t.key,
      entity: t.entity,
      label: t.label,
      description: t.description,
      dataType: t.dataType,
    })),
    columns: request.headers.map((header) => ({
      sourceField: header,
      description: request.fieldDescriptions?.[header] ?? null,
      redactedSamples: request.samples[header] ?? [],
    })),
  });
}

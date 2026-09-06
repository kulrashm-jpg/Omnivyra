/**
 * A1 — the AI ICP Generator.
 *
 * Company Profile → evidence → model reasoning → frozen criteria + frozen
 * proposal → the canonical persistence path. It produces a PROPOSAL and can
 * never produce a ratified ICP: it writes through `createIcpVersion`, which
 * accepts only `draft` or `proposed`, and `ratifyIcpVersion` requires a human
 * user id with no default.
 *
 * ─── IT ADDS NO STORE, NO MODEL FRAMEWORK AND NO SCORING ──────────────────
 * Company Profile is read from `company_profiles` through the same
 * `ownedDbTable` seam the prospect spine already uses. The model is invoked
 * through `runCompletionWithOperation`, the repository's canonical gateway,
 * so provider routing, billing guard, retry and pooling are inherited rather
 * than re-implemented. Output is parsed by `parseModelOutput` from the existing
 * safety module. Persistence is `createIcpVersion`. Nothing here is new
 * infrastructure; the generator is a thin intelligence layer.
 *
 * ─── FAILURE IS NEVER A PROPOSAL ──────────────────────────────────────────
 * Every failure path returns a typed refusal and writes NOTHING. In particular
 * a model that fails, times out or returns unusable output does not become an
 * empty proposal — an empty ICP would read downstream as "we looked and there
 * is nothing", which is a claim nobody made.
 */

import { ownedDbTable } from '../../../db/writeOwner';
import { runCompletionWithOperation } from '../../aiGateway';
import { parseModelOutput } from '../../ai/safety';
import { IcpContractError } from '../types';
import { createIcpVersion, ensureIcp } from '../persistence';
import {
  extractProfileEvidence, hasSufficientEvidence,
  PROFILE_EVIDENCE_FIELDS, PROFILE_TRUST_FIELDS, type ProfileEvidence,
} from './evidence';
import {
  buildSystemPrompt, buildUserPrompt,
  ICP_PROMPT_TEMPLATE_NAME, ICP_PROMPT_TEMPLATE_VERSION,
} from './prompt';
import { translateModelOutput, type TranslationDiagnostics } from './translate';

/** The gateway operation label. Registered in `FEATURE_AREA_MAP`. */
export const ICP_GENERATOR_OPERATION = 'generateProspectIcpProposal';

/** Bumped when generator behaviour changes in a way that alters output. */
export const ICP_GENERATOR_VERSION = 'a1.1';

export type GenerationFailureReason =
  | 'no_company_profile'
  | 'insufficient_evidence'
  | 'model_failed'
  | 'model_output_unusable'
  | 'no_usable_criteria'
  | 'contract_violation'
  | 'persist_failed';

export type GenerateIcpResult =
  | {
    readonly ok: true;
    readonly icpId: string;
    readonly versionId: string;
    readonly version: number;
    readonly criteriaCount: number;
    readonly targetCount: number;
    readonly model: string;
    readonly provider: string;
    readonly diagnostics: TranslationDiagnostics;
  }
  | {
    readonly ok: false;
    readonly reason: GenerationFailureReason;
    readonly detail: string;
    /** Present when translation ran; explains what was refused and why. */
    readonly diagnostics?: TranslationDiagnostics;
  };

export interface GenerateIcpPorts {
  loadCompanyProfile(companyId: string): Promise<Record<string, unknown> | null>;
  runCompletion(args: {
    companyId: string;
    system: string;
    user: string;
  }): Promise<{ output: string | null; model: string; provider: string; reasoningTraceId: string }>;
  ensureIcp: typeof ensureIcp;
  createIcpVersion: typeof createIcpVersion;
  now(): string;
}

export const defaultGenerateIcpPorts: GenerateIcpPorts = {
  async loadCompanyProfile(companyId) {
    const { data, error } = await ownedDbTable('company_profiles')
      .select([...PROFILE_EVIDENCE_FIELDS, ...PROFILE_TRUST_FIELDS].join(', '))
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) throw new Error(`company_profile_read_failed:${error.message}`);
    return (data as unknown as Record<string, unknown> | null) ?? null;
  },

  async runCompletion({ companyId, system, user }) {
    const result = await runCompletionWithOperation({
      companyId,
      campaignId: null,
      // Provider-independent: the gateway routes. This mirrors the convention
      // every other profile-reasoning service in the repository uses.
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      operation: ICP_GENERATOR_OPERATION,
      prompt_template_name: ICP_PROMPT_TEMPLATE_NAME,
      prompt_template_version: ICP_PROMPT_TEMPLATE_VERSION,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return {
      output: result.output ?? null,
      model: result.metadata?.model ?? 'unknown',
      provider: result.metadata?.provider ?? 'unknown',
      reasoningTraceId: result.metadata?.reasoning_trace_id ?? 'unknown',
    };
  },

  ensureIcp,
  createIcpVersion,
  now: () => new Date().toISOString(),
};

export interface GenerateIcpInput {
  /** The VERIFIED tenant. Never taken from a request body or from model output. */
  readonly organizationId: string;
  /** Lower-case slug identifying the ICP within the tenant. */
  readonly icpKey: string;
  readonly name?: string | null;
}

/**
 * Generate one AI ICP proposal for a tenant.
 *
 * The tenant id is threaded from the caller's verified context into the profile
 * read, the gateway call and the write. The model is never told the tenant id
 * and could not influence it if it were: `organizationId` is captured before
 * the call and used after it, and nothing read back from the model reaches it.
 */
export async function generateIcpProposal(
  input: GenerateIcpInput,
  ports: GenerateIcpPorts = defaultGenerateIcpPorts,
): Promise<GenerateIcpResult> {
  const organizationId = String(input.organizationId ?? '').trim();
  if (!organizationId) {
    return { ok: false, reason: 'contract_violation', detail: 'organizationId is required' };
  }

  // ── 1. evidence ──────────────────────────────────────────────────────────
  let profile: Record<string, unknown> | null;
  try {
    profile = await ports.loadCompanyProfile(organizationId);
  } catch (e) {
    return { ok: false, reason: 'no_company_profile', detail: e instanceof Error ? e.message : String(e) };
  }
  if (!profile) {
    return {
      ok: false,
      reason: 'no_company_profile',
      detail: 'this tenant has no company_profiles row — there is nothing to derive an ICP from',
    };
  }

  const evidence: ProfileEvidence = extractProfileEvidence(profile);
  if (!hasSufficientEvidence(evidence)) {
    return {
      ok: false,
      reason: 'insufficient_evidence',
      detail:
        `the profile carries ${evidence.presentCount} buyer-relevant field(s) and too few of the `
        + 'signals an ICP must rest on; abstaining rather than proposing a plausible ICP',
    };
  }

  // ── 2. reasoning ─────────────────────────────────────────────────────────
  let completion: Awaited<ReturnType<GenerateIcpPorts['runCompletion']>>;
  try {
    completion = await ports.runCompletion({
      companyId: organizationId,
      system: buildSystemPrompt(),
      user: buildUserPrompt(evidence),
    });
  } catch (e) {
    return { ok: false, reason: 'model_failed', detail: e instanceof Error ? e.message : String(e) };
  }

  const parsed = parseModelOutput<unknown>(completion.output, {
    surface: 'prospectIcp.generator',
    schemaId: `${ICP_PROMPT_TEMPLATE_NAME}@${ICP_PROMPT_TEMPLATE_VERSION}`,
  });
  // `'error' in parsed`, not `!parsed.ok`: the root tsconfig sets
  // `strict: false`, which disables discriminated-union narrowing on a negated
  // boolean discriminant. The `in` check narrows regardless.
  if ('error' in parsed) {
    return { ok: false, reason: 'model_output_unusable', detail: parsed.error.code };
  }

  // ── 3. translation — the frozen contracts are enforced here ──────────────
  const generatedAt = ports.now();
  let translated;
  try {
    translated = translateModelOutput(parsed.value, {
      evidence,
      model: completion.model,
      provider: completion.provider,
      reasoningTraceId: completion.reasoningTraceId,
      promptTemplate: ICP_PROMPT_TEMPLATE_NAME,
      promptVersion: ICP_PROMPT_TEMPLATE_VERSION,
      generatedAt,
    });
  } catch (e) {
    // A contract error here means the model produced something that survived
    // translation but still violates Contract 1 or 2. Nothing is persisted.
    return {
      ok: false,
      reason: 'contract_violation',
      detail: e instanceof IcpContractError ? `${e.code}: ${e.message}` : String(e),
    };
  }

  // An empty criteria set is a failed generation, not a proposal. Persisting it
  // would assert "we looked and found nothing to say", which nobody concluded.
  if (translated.criteria.length === 0) {
    return {
      ok: false,
      reason: 'no_usable_criteria',
      detail: 'every proposed criterion was refused during translation',
      diagnostics: translated.diagnostics,
    };
  }

  // ── 4. canonical persistence ─────────────────────────────────────────────
  try {
    const icp = await ports.ensureIcp(organizationId, input.icpKey, input.name ?? null);
    const created = await ports.createIcpVersion({
      organizationId,
      icpId: icp.icpId,
      criteria: translated.criteria,
      status: 'proposed',          // never 'ratified' — the writer refuses it anyway
      proposal: translated.proposal,
      proposedByModel: completion.model,
    });

    return {
      ok: true,
      icpId: icp.icpId,
      versionId: created.versionId,
      version: created.version,
      criteriaCount: translated.criteria.length,
      targetCount: translated.proposal.targets?.length ?? 0,
      model: completion.model,
      provider: completion.provider,
      diagnostics: translated.diagnostics,
    };
  } catch (e) {
    return {
      ok: false,
      reason: 'persist_failed',
      detail: e instanceof IcpContractError ? `${e.code}: ${e.message}` : (e instanceof Error ? e.message : String(e)),
      diagnostics: translated.diagnostics,
    };
  }
}

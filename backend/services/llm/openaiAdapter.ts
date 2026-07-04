import { runCompletion } from '../aiGateway';

const UNKNOWN_ORG = '00000000-0000-0000-0000-000000000000';

export interface LlmJsonResponse<T> {
  data: T;
  raw: string;
  model: string;
}

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export interface DiagnosticPromptOptions {
  organizationId?: string | null;
  campaignId?: string | null;
  userId?: string | null;
  processType?: string;
  /**
   * Activity-consumption correlation envelope (correlation ONLY — not a
   * billing/credit/action key). referenceType = semantic activity type
   * (e.g. 'lead_job', 'opportunity_discovery'); referenceId = activity id
   * (job_id/execution_id/…); parentActivityId = optional nested parent.
   * Written through to unified_transactions.reference_type / reference_id.
   */
  referenceType?: string | null;
  referenceId?: string | null;
  parentActivityId?: string | null;
}

/**
 * Canonical JSON diagnostic prompt. Routes through aiGateway so it inherits the
 * single canonical execution path — provider selection, retry, fallback, usage
 * enforcement, cost governance, and telemetry. It no longer holds its own OpenAI
 * client or usage-ledger writes (that accounting is aiGateway's, avoiding
 * double-counting). The {data,raw,model} contract is unchanged for callers.
 */
export async function runDiagnosticPrompt<T>(
  systemPrompt: string,
  userPrompt: string,
  options: DiagnosticPromptOptions = {}
): Promise<LlmJsonResponse<T>> {
  const organizationId = options.organizationId?.trim() || UNKNOWN_ORG;
  const result = await runCompletion({
    companyId: organizationId === UNKNOWN_ORG ? null : organizationId,
    campaignId: options.campaignId ?? null,
    referenceType: options.referenceType ?? null,
    referenceId: options.referenceId ?? null,
    parentActivityId: options.parentActivityId ?? null,
    model: DEFAULT_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    operation: options.processType || 'runDiagnosticPrompt',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const raw = (result.output ?? '').trim();
  if (!raw) {
    throw new Error('LLM returned empty response');
  }

  let parsed: T;
  try {
    parsed = JSON.parse(raw) as T;
  } catch (error) {
    throw new Error('LLM response is not valid JSON');
  }

  return {
    data: parsed,
    raw,
    model: result.metadata?.model || DEFAULT_MODEL,
  };
}

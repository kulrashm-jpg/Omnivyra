/**
 * The one way Agent-2 ingestion paths call the contribution writer.
 *
 * `recordSourceContribution` RETURNS failures (it never throws); this wrapper
 * makes each outcome observable via provenanceTelemetry and also absorbs a
 * thrown error (e.g. the client itself failing) so a provenance write can never
 * break the ingestion that triggered it.
 */
import { recordSourceContribution } from '../contributionWriter';
import type {
  SourceContributionInput,
  SourceContributionResult,
} from '../../../../lib/prospectProvenance/contract';
import { recordProvenanceOutcome, type ProvenancePath } from './provenanceTelemetry';

export type ContributionRecorder = (input: SourceContributionInput) => Promise<SourceContributionResult>;

export async function recordObservedContribution(
  path: ProvenancePath,
  input: SourceContributionInput,
  recorder: ContributionRecorder = (i) => recordSourceContribution(i),
): Promise<SourceContributionResult> {
  let result: SourceContributionResult;
  try {
    result = await recorder(input);
  } catch (e) {
    result = { status: 'error', code: 'threw', message: e instanceof Error ? e.message : String(e) };
  }
  const detail = {
    organizationId: input.organizationId,
    canonicalLeadId: input.canonicalLeadId,
    sourceCategory: input.sourceCategory,
    externalRef: input.externalRef,
  };
  if (result.status === 'error') {
    recordProvenanceOutcome(path, 'error', { ...detail, code: result.code, message: result.message });
  } else {
    recordProvenanceOutcome(path, result.status, detail);
  }
  return result;
}

/** ISO source time when the source gave a parseable one; otherwise the fallback, flagged. */
export function sourceObservedAt(
  sourceTime: unknown,
  fallback: string,
): { observedAt: string; observedAtBasis: 'source' | 'ingestion' } {
  if (typeof sourceTime === 'string' && sourceTime.trim() && !Number.isNaN(Date.parse(sourceTime.trim()))) {
    // Kept verbatim (not re-serialised) so the source's own timestamp survives.
    return { observedAt: sourceTime.trim(), observedAtBasis: 'source' };
  }
  return { observedAt: fallback, observedAtBasis: 'ingestion' };
}

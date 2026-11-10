/**
 * R3: screen a page of DISCOVERED provider records before they reach ingestion.
 *
 *   import          → returned in `toIngest`, ingested exactly as before;
 *   skip            → NOT ingested (duplicate or already imported), counted;
 *   hold            → NOT ingested, held in the tenant review list, counted;
 *   probe_unknown   → NOT ingested and NOT held, counted per reason. The
 *                     record was not imported, so the next run of the same
 *                     search reconsiders it: nothing is lost, nothing is guessed.
 *
 * Provider-neutral: records are translated with the source's own registered
 * adapter, exactly as the orchestrator will translate them. A record the
 * adapter cannot translate is passed through unchanged, so the orchestrator
 * reports it as a normalisation failure in the usual way.
 */

import { getLeadSourceAdapter } from '../leadIngestion/registry';
import { probeRecord, type ProbePorts, type ProbeVerdict } from './probe';
import { holdForReview, productionProbePorts, type HeldItem } from './repository';

export interface ScreenResult {
  readonly toIngest: Array<Record<string, unknown>>;
  readonly skippedDuplicates: number;
  readonly heldForReview: number;
  readonly probeUnknown: number;
  /** Per-record verdicts, keyed by the provider's own record id. Ids and codes only. */
  readonly verdicts: ReadonlyArray<{ providerRecordId: string | null; verdict: ProbeVerdict['kind']; reason?: string }>;
}

export type ScreenFn = (input: {
  organizationId: string; source: string; records: Array<Record<string, unknown>>; now: string;
}) => Promise<ScreenResult>;

/** No screening: every record is ingested. Used when a caller injects its own ingestion (tests). */
export const passThroughScreen: ScreenFn = async ({ records }) => ({
  toIngest: records, skippedDuplicates: 0, heldForReview: 0, probeUnknown: 0, verdicts: [],
});

export function makeScreen(deps: {
  ports?: ProbePorts;
  hold?: typeof holdForReview;
} = {}): ScreenFn {
  const ports = deps.ports ?? productionProbePorts;
  const hold = deps.hold ?? holdForReview;
  return async ({ organizationId, source, records, now }) => {
    const adapter = getLeadSourceAdapter(source);
    const toIngest: Array<Record<string, unknown>> = [];
    const held: HeldItem[] = [];
    const verdicts: Array<{ providerRecordId: string | null; verdict: ProbeVerdict['kind']; reason?: string }> = [];
    let skipped = 0;
    let unknown = 0;

    for (const raw of records) {
      let normalized;
      try {
        normalized = adapter.translate(raw ?? {}, organizationId).normalized;
      } catch {
        toIngest.push(raw);            // the orchestrator reports the normalisation failure
        continue;
      }
      let v: ProbeVerdict;
      try {
        v = await probeRecord(normalized, ports);
      } catch {
        v = { kind: 'probe_unknown', failed: 'name' };
      }
      const id = normalized.externalId ?? null;
      if (v.kind === 'import') { toIngest.push(raw); verdicts.push({ providerRecordId: id, verdict: 'import' }); continue; }
      if (v.kind === 'skip') { skipped += 1; verdicts.push({ providerRecordId: id, verdict: 'skip', reason: v.reason }); continue; }
      if (v.kind === 'probe_unknown') { unknown += 1; verdicts.push({ providerRecordId: id, verdict: 'probe_unknown', reason: v.failed }); continue; }
      if (!id) { unknown += 1; verdicts.push({ providerRecordId: null, verdict: 'probe_unknown', reason: 'no_record_id' }); continue; }
      held.push({ providerRecordId: id, reason: v.reason, matchedPersonIds: v.matchedPersonIds, raw });
      verdicts.push({ providerRecordId: id, verdict: 'hold', reason: v.reason });
    }

    let heldCount = 0;
    if (held.length) {
      try {
        heldCount = (await hold(organizationId, source, held, now)).held;
      } catch {
        // A hold that could not be written must not become an import. The
        // records stay out, reported as unknown, and the next run reconsiders them.
        unknown += held.length;
        for (const h of held) {
          const row = verdicts.find((x) => x.providerRecordId === h.providerRecordId && x.verdict === 'hold');
          if (row) { row.verdict = 'probe_unknown'; row.reason = 'hold_write_failed'; }
        }
      }
    }
    return { toIngest, skippedDuplicates: skipped, heldForReview: heldCount, probeUnknown: unknown, verdicts };
  };
}

export const screenDiscoveredRecords: ScreenFn = (input) => makeScreen()(input);

/**
 * Drift detection — pure functions that produce DriftAnalysis objects from
 * comparing DB state against provider lookup results. No state mutation,
 * no platform writes.
 *
 * Each detector returns a `DriftAnalysis` whose `kind` maps 1:1 to a
 * telemetry event name. `shouldEmit: false` means "no signal worth logging"
 * (the in_sync happy path); `shouldEmit: true` covers every drift variant.
 *
 * Repair hints are advisory only in this foundation phase.
 */

import { getProviderReconciliationLookup } from './types';
import type {
  DriftAnalysis,
  DetectReplayDriftInput,
  ReconciliationLookupResult,
  VerifyPublishedPostInput,
} from './types';
import { getScheduledPost } from '../../db/queries';

/**
 * Confirm that a DB row claiming `published` + a `platform_post_id` actually
 * corresponds to a live platform post.
 */
export async function verifyPublishedPost(input: VerifyPublishedPostInput): Promise<DriftAnalysis> {
  const lookup = getProviderReconciliationLookup(input.platform);
  if (!lookup) {
    return {
      kind: 'unverifiable',
      platform: input.platform,
      rowId: input.rowId,
      shouldEmit: true,
      diagnostic: `No reconciliation lookup registered for platform "${input.platform}"`,
      tags: { reason: 'no_lookup_registered' },
    };
  }

  let result: ReconciliationLookupResult;
  try {
    const row = await getScheduledPost(input.rowId);
    if (!row) {
      return {
        kind: 'unverifiable',
        platform: input.platform,
        rowId: input.rowId,
        shouldEmit: true,
        diagnostic: `Row ${input.rowId} not found in DB`,
        tags: { reason: 'row_missing' },
      };
    }
    result = await lookup.lookup({ row, socialAccountId: input.socialAccountId });
  } catch (err) {
    return {
      kind: 'unverifiable',
      platform: input.platform,
      rowId: input.rowId,
      shouldEmit: true,
      diagnostic: `Lookup threw: ${(err as Error).message}`,
      tags: { reason: 'lookup_threw' },
    };
  }

  if (result.confidence === 'unverifiable') {
    return {
      kind: 'unverifiable',
      platform: input.platform,
      rowId: input.rowId,
      shouldEmit: true,
      diagnostic: result.diagnostic,
      lookup: result,
    };
  }

  if (result.confidence === 'no_match') {
    // DB has a platform_post_id but the provider can't find it — either the
    // post was deleted or never existed.
    return {
      kind: 'deleted_provider',
      platform: input.platform,
      rowId: input.rowId,
      shouldEmit: true,
      diagnostic: `DB row claims platform_post_id=${input.platformPostId} but provider returned no_match`,
      lookup: result,
      repairHint: 'Confirm the post is intentionally deleted; if not, clear platform_post_id and resume the row',
      tags: { db_platform_post_id: input.platformPostId },
    };
  }

  if (result.confidence === 'exact_match' || result.confidence === 'likely_match') {
    const idsMatch = !result.platformPostId || result.platformPostId === input.platformPostId;
    if (!idsMatch) {
      return {
        kind: 'replay_duplicate',
        platform: input.platform,
        rowId: input.rowId,
        shouldEmit: true,
        diagnostic: `DB claims ${input.platformPostId}; provider found a matching post at ${result.platformPostId}`,
        lookup: result,
        repairHint: 'Investigate retry log; the row may have published twice. Manually decide which platform post to keep.',
        tags: {
          db_platform_post_id: input.platformPostId,
          provider_platform_post_id: result.platformPostId ?? null,
        },
      };
    }
    return {
      kind: 'in_sync',
      platform: input.platform,
      rowId: input.rowId,
      shouldEmit: false,
      diagnostic: 'DB and provider agree on the post id',
      lookup: result,
    };
  }

  return {
    kind: 'unverifiable',
    platform: input.platform,
    rowId: input.rowId,
    shouldEmit: true,
    diagnostic: `Unexpected confidence value: ${String(result.confidence)}`,
    lookup: result,
  };
}

/**
 * Detect replay-duplicate drift on a specific row. Caller passes the row's
 * known platform_post_id; if the provider lookup surfaces a DIFFERENT
 * matching post id, that signals a replay duplicate.
 *
 * Requires the provider lookup to support content-based search (most
 * platforms only support id-based lookup at v1; this detector returns
 * unverifiable when the provider can't help).
 */
export async function detectReplayDrift(input: DetectReplayDriftInput): Promise<DriftAnalysis> {
  // For the foundation phase this is identical to verifyPublishedPost — the
  // verify path already detects id mismatch and classifies as replay_duplicate.
  // Keeping the function separate so the caller's intent is explicit and so
  // future content-search-aware logic can specialize here.
  return verifyPublishedPost({
    rowId: input.rowId,
    platform: input.platform,
    socialAccountId: input.socialAccountId,
    platformPostId: input.platformPostId,
  });
}

/**
 * For a thread root: load all child rows and detect partial-thread drift.
 * Returns one DriftAnalysis describing the aggregate (`in_sync` when ALL
 * children verify; `partial_thread_drift` when any child reports drift).
 */
export async function detectPartialThreadDrift(input: {
  rootRowId: string;
  platform: string;
  socialAccountId: string;
}): Promise<DriftAnalysis> {
  // Foundation phase: deferred. Per-child verification requires loading the
  // children + iterating verifyPublishedPost. Exposing the interface here so
  // the future implementation slots in without changing the caller API.
  return {
    kind: 'unverifiable',
    platform: input.platform,
    rowId: input.rootRowId,
    shouldEmit: true,
    diagnostic: 'detectPartialThreadDrift not yet implemented (foundation phase)',
    tags: { reason: 'foundation_phase_only' },
  };
}

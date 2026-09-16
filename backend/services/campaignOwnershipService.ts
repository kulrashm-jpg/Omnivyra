/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — campaign → tenant binding for enforceCompanyAccess.
 *
 * enforceCompanyAccess({ companyId, campaignId }) proved that the caller is an
 * active member of `companyId`, and then returned success without ever asking
 * whether `campaignId` belonged to that company. A member of company A could
 * therefore authorize against A and pass company B's campaign id, and every
 * route that trusted the guard read or wrote B's campaign (STEP 3AH-84 P1-4,
 * e.g. campaigns/[id]/commit-plan).
 *
 * Ownership records, in the order they are consulted:
 *   1. a `campaign_versions` row pairing this campaign with this company — the
 *      record every creation flow writes (see campaignAccessService
 *      .resolveCampaignCompanyId). The read carries the company predicate, so
 *      it can only ever confirm ownership, never disclose another tenant's row.
 *   2. `campaigns.company_id` — for legacy campaigns that have no version row
 *      for the company (the same authority TenantGuard.requireCampaignTenantAccess
 *      uses).
 *
 * Outcomes:
 *   owned        — a record ties the campaign to the company;
 *   foreign      — the campaign exists but nothing ties it to the company
 *                  (another tenant's campaign, or an orphan with no owner);
 *   not_found    — no campaign with this id exists yet (no campaigns row and
 *                  no campaign_versions row). Creation flows pass the id of the
 *                  campaign they are about to create, and a campaign that does
 *                  not exist cannot belong to another tenant;
 *   lookup_error — a read failed; callers must fail closed (503).
 *
 * This module deliberately imports nothing but the database client, the
 * logger (whose only dependency is the request context) and node's crypto, so
 * the guard in userContextService can use it without the import cycle that
 * campaignAccessService (which imports userContextService) would create.
 */
import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { logger } from './logger';

export type CampaignOwnership = 'owned' | 'foreign' | 'not_found' | 'lookup_error';

async function checkCampaignOwnershipLegacy(
  campaignId: string,
  companyId: string,
): Promise<CampaignOwnership> {
  if (!campaignId || typeof campaignId !== 'string' || !companyId) return 'not_found';

  const version = await supabase
    .from('campaign_versions')
    .select('campaign_id')
    .eq('campaign_id', campaignId)
    .eq('company_id', companyId)
    .limit(1)
    .maybeSingle();
  if (version.error) return 'lookup_error';
  if (version.data) return 'owned';

  const campaign = await supabase
    .from('campaigns')
    .select('company_id')
    .eq('id', campaignId)
    .maybeSingle();
  if (campaign.error) return 'lookup_error';
  if (!campaign.data) {
    // campaign_versions.campaign_id is plain text with no foreign key, so a
    // version row can exist without a campaigns row. Such a row belongs to
    // another company (step 1 already ruled out this one) → foreign, not new.
    const anyVersion = await supabase
      .from('campaign_versions')
      .select('campaign_id')
      .eq('campaign_id', campaignId)
      .limit(1)
      .maybeSingle();
    if (anyVersion.error) return 'lookup_error';
    return anyVersion.data ? 'foreign' : 'not_found';
  }
  const legacyCompany = (campaign.data as { company_id?: string | null }).company_id ?? null;
  // A campaign that exists with no owner record for this company is never
  // "unowned, so allowed" — it is someone else's, or nobody's.
  return legacyCompany && String(legacyCompany) === String(companyId) ? 'owned' : 'foreign';
}

export async function checkCampaignOwnership(
  campaignId: string,
  companyId: string,
): Promise<CampaignOwnership> {
  const result = await checkCampaignOwnershipLegacy(campaignId, companyId);
  // 3AH-113 (WS-A) — shadow only: the canonical resolver runs beside this
  // check and reports disagreement. The returned decision is the legacy one.
  if (companyId) {
    shadowCampaignOwnership('checkCampaignOwnership', campaignId, {
      kind: 'membership',
      claimedCompanyId: String(companyId),
      result,
    });
  }
  return result;
}

// ── 3AH-113 (WS-A) — THE canonical campaign ownership resolver ────────────────

/**
 * Canonical ownership of one campaign, decided from the SET of owner records:
 * `campaigns.company_id` plus the `company_id` of EVERY `campaign_versions` row.
 *
 *   INVALID       — the id is missing, not a string, or blank;
 *   LOOKUP_FAILED — a read failed, or the version rows could not be read in
 *                   full. Never reported as NOT_FOUND: callers must answer 503;
 *   NOT_FOUND     — no campaigns row and no version rows;
 *   UNOWNED       — records exist, but none names a company;
 *   OWNED         — exactly one distinct company across all records;
 *   CONFLICT      — two or more distinct companies. Fail closed: a campaign
 *                   whose records disagree has no owner to act for.
 *
 * Authorization never depends on row ordering: no record is preferred over
 * another, and no "latest" row wins. An empty or whitespace company is absent.
 * `orphan` marks a version-only campaign (no campaigns row).
 */
export type CampaignOwnerSources = {
  campaignRecord: boolean;
  versionRowCount: number;
};

export type CampaignOwnerResolution =
  | { status: 'INVALID' }
  | { status: 'LOOKUP_FAILED' }
  | { status: 'NOT_FOUND' }
  | { status: 'UNOWNED'; sources: CampaignOwnerSources }
  | { status: 'OWNED'; companyId: string; sources: CampaignOwnerSources; orphan: boolean }
  | { status: 'CONFLICT'; companyIds: string[]; sources: CampaignOwnerSources };

function ownerValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const owner = String(value).trim();
  return owner ? owner : null;
}

export async function resolveCampaignOwnership(campaignId: unknown): Promise<CampaignOwnerResolution> {
  if (typeof campaignId !== 'string' || !campaignId.trim()) return { status: 'INVALID' };
  try {
    const [campaign, versions] = await Promise.all([
      supabase.from('campaigns').select('company_id').eq('id', campaignId).maybeSingle(),
      supabase.from('campaign_versions').select('company_id', { count: 'exact' }).eq('campaign_id', campaignId),
    ]);
    if (campaign.error || versions.error) return { status: 'LOOKUP_FAILED' };

    const versionRows = (Array.isArray(versions.data) ? versions.data : []) as Array<{ company_id?: unknown }>;
    // The owner set must be complete. If the database holds more version rows
    // than were returned (a server-side row cap), the set cannot be trusted.
    if (typeof versions.count === 'number' && versions.count > versionRows.length) {
      return { status: 'LOOKUP_FAILED' };
    }

    const campaignRow = campaign.data as { company_id?: unknown } | null;
    const companies = new Set<string>();
    const recordOwner = campaignRow ? ownerValue(campaignRow.company_id) : null;
    if (recordOwner) companies.add(recordOwner);
    for (const row of versionRows) {
      const owner = ownerValue(row?.company_id);
      if (owner) companies.add(owner);
    }

    if (!campaignRow && versionRows.length === 0) return { status: 'NOT_FOUND' };
    const sources: CampaignOwnerSources = { campaignRecord: recordOwner !== null, versionRowCount: versionRows.length };
    if (companies.size === 0) return { status: 'UNOWNED', sources };
    if (companies.size > 1) return { status: 'CONFLICT', companyIds: Array.from(companies).sort(), sources };
    return { status: 'OWNED', companyId: Array.from(companies)[0], sources, orphan: !campaignRow };
  } catch {
    return { status: 'LOOKUP_FAILED' };
  }
}

// ── 3AH-113 (WS-A) — shadow comparison (observe-only) ─────────────────────────

export type OwnershipShadowSeam = 'checkCampaignOwnership' | 'resolveCampaignCompanyId' | 'requireCampaignTenantAccess';

/** What a legacy seam decided, as seen by the shadow comparison. */
export type LegacyOwnershipObservation =
  | { kind: 'membership'; claimedCompanyId: string; result: CampaignOwnership }
  | { kind: 'owner'; ownerCompanyId: string | null; lookupError: boolean };

export type OwnershipComparison = {
  agrees: boolean;
  legacyOutcome: string;
  canonicalOutcome: string;
  ownerRelation: 'same' | 'different' | 'legacy_only' | 'canonical_only' | 'neither';
};

/** The canonical answer to "does `claimedCompanyId` own this campaign?". */
function canonicalMembership(canonical: CampaignOwnerResolution, claimedCompanyId: string): string {
  switch (canonical.status) {
    case 'INVALID':
    case 'NOT_FOUND':
      return 'not_found';
    case 'LOOKUP_FAILED':
      return 'lookup_error';
    case 'UNOWNED':
      return 'foreign';
    case 'CONFLICT':
      return 'conflict';
    case 'OWNED':
      return canonical.companyId === claimedCompanyId ? 'owned' : 'foreign';
  }
}

export function compareCampaignOwnership(
  legacy: LegacyOwnershipObservation,
  canonical: CampaignOwnerResolution,
): OwnershipComparison {
  const canonicalOwner = canonical.status === 'OWNED' ? canonical.companyId : null;
  if (legacy.kind === 'membership') {
    const canonicalOutcome = canonicalMembership(canonical, legacy.claimedCompanyId);
    const legacyOwns = legacy.result === 'owned';
    const canonicalOwns = canonicalOutcome === 'owned';
    return {
      agrees: canonicalOutcome === legacy.result,
      legacyOutcome: legacy.result,
      canonicalOutcome,
      ownerRelation: legacyOwns && canonicalOwns ? 'same'
        : legacyOwns ? 'legacy_only'
          : canonicalOwns ? 'canonical_only' : 'neither',
    };
  }
  const legacyOutcome = legacy.lookupError ? 'lookup_error' : legacy.ownerCompanyId ? 'owner' : 'no_owner';
  const canonicalOutcome = canonical.status === 'LOOKUP_FAILED' ? 'lookup_error' : canonicalOwner ? 'owner' : 'no_owner';
  const ownerRelation = legacy.ownerCompanyId && canonicalOwner
    ? (legacy.ownerCompanyId === canonicalOwner ? 'same' : 'different')
    : legacy.ownerCompanyId ? 'legacy_only'
      : canonicalOwner ? 'canonical_only' : 'neither';
  return {
    agrees: legacyOutcome === canonicalOutcome && (ownerRelation === 'same' || ownerRelation === 'neither'),
    legacyOutcome,
    canonicalOutcome,
    ownerRelation,
  };
}

/**
 * Shadow mode is strictly opt-in: only CAMPAIGN_OWNERSHIP_SHADOW=on enables
 * it, in every environment. Its extra ownership reads run after a denial and
 * before authorization, which the existing route invariants ("a denied caller
 * triggers no further campaign read", "every campaign_versions read carries
 * the authorized company") forbid — so enabling it is a separate, explicit
 * operational decision, never a side effect of deploying this code.
 */
export function isCampaignOwnershipShadowEnabled(): boolean {
  return String(process.env.CAMPAIGN_OWNERSHIP_SHADOW ?? '').trim().toLowerCase() === 'on';
}

/** A non-reversible correlation reference; the raw campaign id is never logged. */
function campaignRef(campaignId: unknown): string {
  if (typeof campaignId !== 'string' || !campaignId) return 'invalid';
  return createHash('sha256').update(`campaign-ownership-shadow:${campaignId}`).digest('hex').slice(0, 16);
}

async function runOwnershipShadow(
  seam: OwnershipShadowSeam,
  campaignId: unknown,
  legacy: LegacyOwnershipObservation,
): Promise<void> {
  const canonical = await resolveCampaignOwnership(campaignId);
  const comparison = compareCampaignOwnership(legacy, canonical);
  if (comparison.agrees) return;
  logger.warn('campaign_ownership_shadow_mismatch', {
    seam,
    campaign_ref: campaignRef(campaignId),
    legacy_outcome: comparison.legacyOutcome,
    canonical_outcome: comparison.canonicalOutcome,
    canonical_status: canonical.status,
    owner_relation: comparison.ownerRelation,
    conflict: canonical.status === 'CONFLICT',
    orphan: canonical.status === 'OWNED' && canonical.orphan,
    lookup_error: canonical.status === 'LOOKUP_FAILED' || (legacy.kind === 'owner' ? legacy.lookupError : legacy.result === 'lookup_error'),
    distinct_company_count: canonical.status === 'CONFLICT' ? canonical.companyIds.length : canonical.status === 'OWNED' ? 1 : 0,
    version_row_count: 'sources' in canonical ? canonical.sources.versionRowCount : null,
  });
}

const pendingOwnershipShadow = new Set<Promise<void>>();

/**
 * Fire-and-forget: never awaited on the request path, never throws, never
 * writes. The caller's decision is final before this is invoked.
 */
export function shadowCampaignOwnership(
  seam: OwnershipShadowSeam,
  campaignId: unknown,
  legacy: LegacyOwnershipObservation,
): void {
  try {
    if (!isCampaignOwnershipShadowEnabled()) return;
    const task = runOwnershipShadow(seam, campaignId, legacy).catch(() => undefined);
    pendingOwnershipShadow.add(task);
    void task.then(() => pendingOwnershipShadow.delete(task));
  } catch {
    /* shadow instrumentation must never affect the request */
  }
}

/** Test seam: wait for in-flight shadow comparisons to settle. */
export async function flushCampaignOwnershipShadow(): Promise<void> {
  while (pendingOwnershipShadow.size > 0) {
    await Promise.all(Array.from(pendingOwnershipShadow));
  }
}

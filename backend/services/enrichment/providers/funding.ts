/**
 * MODE B (owner, 2026-11-10): who pays the vendor, and how a central call is charged.
 *
 *   OWN KEY FIRST. The tenant's own vendor credential (integration_credentials)
 *   wins whenever it exists: the vendor bills the tenant; no Omnivyra credits.
 *
 *   CENTRAL ACCESS, ONLY IF CHOSEN. Otherwise, if the tenant has OPTED INTO
 *   central access for that vendor (a tenant-admin setting) AND Super Admin has
 *   configured the platform key, the platform key is used and the call is
 *   charged in Omnivyra credits at vendor cost x 1.5 (pricingService
 *   `resolveVendorUnitCost`, the existing pricing layer). No vendor cost set ->
 *   the reservation refuses, before any call.
 *
 *   OTHERWISE UNAVAILABLE. Never an environment-variable fallback: the platform
 *   descriptor declares no env names, so only a Super Admin-entered key is used.
 *
 * The credit flow is the platform's own: reserve before the call
 * (`reserveCreditsForWork` with the computed amount), then CONFIRM when the
 * vendor answered (misses included: the vendor billed them) or RELEASE when it
 * did not. Insufficient credits refuse before egress.
 */
import { ownedDbTable } from '../../../db/writeOwner';
// TYPE-ONLY imports of the credential resolver and the credit service: the
// runtime modules load LAZILY, on the first platform-funded call. productionPorts
// imports this file, and its construction must stay inert (no config/DB client
// at import time): the A7 process-death proof loads the executor in a bare
// child process and must not acquire new import-time requirements.
import type { resolveProviderCredential } from '../../providerCredentialResolver';
import { resolveVendorUnitCost } from '../../pricingService';
import type {
  confirmCreditReservation,
  releaseCreditReservation,
  reserveCreditsForWork,
  CreditReservationHandle,
} from '../../creditExecutionServiceContracts';

const credits = () => import('../../creditExecutionServiceContracts');
const lazyResolveProviderCredential: typeof resolveProviderCredential = async (...a) =>
  (await import('../../providerCredentialResolver')).resolveProviderCredential(...a);
const lazyReserve: typeof reserveCreditsForWork = async (...a) => (await credits()).reserveCreditsForWork(...a);
const lazyConfirm: typeof confirmCreditReservation = async (...a) => (await credits()).confirmCreditReservation(...a);
const lazyRelease: typeof releaseCreditReservation = async (...a) => (await credits()).releaseCreditReservation(...a);
import { makeCreditCostPort, PROSPECT_ENRICHMENT_ACTION, tenantFundedExecutionPort } from './cost';
import { tenantCredentialPort } from './credentials';
import type { CostDecision, ExecuteEnrichmentPorts, ResolvedCredential } from './execute';
import { makePlatformDailyCeiling } from './platformCeiling';

/** The tenant setting that opts into central access, per vendor. */
export const CENTRAL_VENDOR_ACCESS_FLAG_KEY = 'central_vendor_access';

/**
 * Vendors that HAVE a central (platform) key, and their descriptor in
 * providerCredentialResolver. A vendor absent here can only be used with the
 * tenant's own key.
 */
export const PLATFORM_CREDENTIAL_KEYS: Readonly<Record<string, string>> = Object.freeze({
  apollo: 'apollo_platform',
});

// Vendor billing units live in ./vendorUnits (pure), re-exported here.
export { VENDOR_UNITS, unitsForCall } from './vendorUnits';
import { unitsForCall } from './vendorUnits';

/**
 * Has this tenant opted into central access for this vendor? An unreadable
 * setting answers NO: central access spends the tenant's credits, so it is
 * never assumed.
 */
export async function hasOptedIntoCentralAccess(organizationId: string, providerId: string): Promise<boolean> {
  try {
    const res = await ownedDbTable('feature_flags').select('enabled, metadata')
      .eq('organization_id', organizationId).eq('flag_key', CENTRAL_VENDOR_ACCESS_FLAG_KEY).limit(1);
    if (res.error || (res.status !== 200 && res.status !== 206) || !Array.isArray(res.data)) return false;
    const row = res.data[0] as { enabled?: boolean; metadata?: { vendors?: unknown } } | undefined;
    if (!row || row.enabled !== true || !Array.isArray(row.metadata?.vendors)) return false;
    return (row.metadata!.vendors as unknown[]).includes(providerId);
  } catch {
    return false;
  }
}

export interface FundedCredentialDeps {
  tenantCredential?: typeof tenantCredentialPort.resolveCredential;
  optedIn?: typeof hasOptedIntoCentralAccess;
  platformCredential?: typeof resolveProviderCredential;
}

/** Own key first; central only when opted in and a MANAGED platform key exists. */
export function makeFundedCredentialPort(deps: FundedCredentialDeps = {}): Pick<ExecuteEnrichmentPorts, 'resolveCredential'> {
  const tenant = deps.tenantCredential ?? tenantCredentialPort.resolveCredential;
  const optedIn = deps.optedIn ?? hasOptedIntoCentralAccess;
  const platform = deps.platformCredential ?? lazyResolveProviderCredential;
  return {
    async resolveCredential({ organizationId, providerId }): Promise<ResolvedCredential | null> {
      const own = await tenant({ organizationId, providerId });
      if (typeof own === 'string' && own.trim()) return { value: own, funding: 'tenant' };
      const platformKey = PLATFORM_CREDENTIAL_KEYS[providerId];
      if (!platformKey || !(await optedIn(organizationId, providerId))) return null;
      const resolved = await platform(platformKey);
      // ONLY a Super Admin-managed key. An environment-sourced value is refused
      // even if one appeared, because the owner rule is "set in Super Admin".
      return resolved.source === 'managed' && resolved.value ? { value: resolved.value, funding: 'platform' } : null;
    },
  };
}

export interface PlatformCostDeps {
  price?: typeof resolveVendorUnitCost;
  reserve?: typeof reserveCreditsForWork;
  confirm?: typeof confirmCreditReservation;
  release?: typeof releaseCreditReservation;
  /** Platform-wide safety backstop for central calls (daily ceiling). */
  allow?: (input: { organizationId: string; providerId: string }) => Promise<string | null>;
}

/**
 * The funding-aware cost port. Tenant-funded calls go to the UNCHANGED
 * tenant-funded port; platform-funded calls reserve real credits through the
 * existing credit-cost port (which keeps its refusal order) and are settled.
 */
export function makeFundedCostPort(deps: PlatformCostDeps = {}): Pick<ExecuteEnrichmentPorts, 'authorizeCost' | 'releaseCost' | 'settleCost'> {
  const price = deps.price ?? resolveVendorUnitCost;
  const reserve = deps.reserve ?? lazyReserve;
  const confirm = deps.confirm ?? lazyConfirm;
  const release = deps.release ?? lazyRelease;
  // Handles live for the duration of ONE execution (authorize -> settle run in
  // sequence in the same call). An abandoned hold expires through the existing
  // reservation timeout; it is never confirmed without a settle.
  const handles = new Map<string, CreditReservationHandle>();

  // Built PER CALL: `makeCreditCostPort` hands its `reserve` a fixed field set
  // without the subject, and the vendor's units depend on the subject. The
  // port's refusal order (unregistered action, fallback resolution, missing
  // pricing key, a reservation that throws) is reused unchanged.
  const creditPortFor = (subject: 'person' | 'account' | undefined) => makeCreditCostPort({
    action: PROSPECT_ENRICHMENT_ACTION,
    reserve: async ({ organizationId, providerId, correlationId }) => {
      const units = unitsForCall(providerId, subject);
      if (!units) throw new Error(`no vendor unit is declared for '${providerId}'`);
      // Throws PricingMissingError until Super Admin sets the vendor's unit cost.
      const priced = await price({ provider: providerId, unit: units.unit, units: units.units, actionKey: PROSPECT_ENRICHMENT_ACTION, orgId: organizationId });
      const result = await reserve({
        userId: organizationId,          // the system sentinel: the org itself (no user session here)
        orgId: organizationId,
        action: PROSPECT_ENRICHMENT_ACTION,
        referenceType: 'prospect_enrichment',
        referenceId: correlationId,
        idempotencyKey: (await credits()).makeIdempotencyKey(organizationId, PROSPECT_ENRICHMENT_ACTION, correlationId),
        amountOverride: priced.credits,
        note: `${providerId} ${units.units} ${units.unit}(s) at vendor cost x ${priced.cost_multiplier}`,
      });
      if (result.status !== 'reserved' && result.status !== 'already_reserved') {
        throw new Error(`credit reservation refused: ${result.status}`);
      }
      const handle = result as CreditReservationHandle;
      handles.set(handle.holdTransactionId, handle);
      return { holdId: handle.holdTransactionId };
    },
  });

  return {
    async authorizeCost(input): Promise<CostDecision> {
      if (input.funding !== 'platform') return tenantFundedExecutionPort.authorizeCost(input);
      const blocked = deps.allow ? await deps.allow({ organizationId: input.organizationId, providerId: input.providerId }) : null;
      if (blocked) return { authorized: false, reason: blocked };
      return creditPortFor(input.subject).authorizeCost(input);
    },
    async releaseCost(holdId, reason) {
      const h = holdId ? handles.get(holdId) : undefined;
      if (!h) return tenantFundedExecutionPort.releaseCost(holdId, reason);
      handles.delete(holdId!);
      await release({ ...h, note: reason });
    },
    async settleCost({ holdId, funding, billable, reason }) {
      if (funding !== 'platform') return;            // own key: nothing reserved, nothing to settle
      const h = holdId ? handles.get(holdId) : undefined;
      if (!h) return;
      handles.delete(holdId!);
      if (billable) {
        await confirm({ ...h, note: reason });
        return h.creditsReserved;               // credits actually charged
      }
      await release({ ...h, note: reason });
      return 0;
    },
  };
}

/**
 * PRODUCTION SINGLETONS (A7K identity contract: productionPorts references
 * these exact objects, never a fresh factory call).
 *
 * The cost port holds a per-process map of open platform holds, keyed by hold
 * id (unique), so one instance serves concurrent executions safely. An entry
 * lives from authorize to settle in the same execution; an execution that dies
 * between them leaves its hold to the existing orphan-hold reaper.
 *
 * The platform daily ceiling is ALWAYS on for platform-funded calls and fails
 * closed (no ceiling configured = no central access).
 */
export const fundedCredentialPort = makeFundedCredentialPort();
export const fundedCostPort = makeFundedCostPort({ allow: makePlatformDailyCeiling() });

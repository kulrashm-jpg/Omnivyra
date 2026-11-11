import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { getTenantDataAckStatus, TenantDataAckRequired } from '../../../backend/services/compliance/tenantDataAck';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantAccess } from '../../../backend/security/TenantGuard';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_ENRICH_EXECUTE } from '../../../shared/contracts/security';
import {
  executeProspectEnrichmentBatch,
  previewProspectEnrichmentBatch,
  MAX_ENRICHMENT_BATCH_PROSPECTS,
  MAX_ENRICHMENT_BATCH_PROVIDER_CALLS,
} from '../../../backend/apiHandlers/prospects/prospectIntelligenceRead';
import {
  allowedAttributesFor,
  readTenantFieldGroups,
} from '../../../backend/services/enrichment/apolloFieldGroups';
import { makeFundedCredentialPort, unitsForCall } from '../../../backend/services/enrichment/providers/funding';
import { readResolvedCredential } from '../../../backend/services/enrichment/providers/execute';
import { resolveVendorUnitCost } from '../../../backend/services/pricingService';
import { PROSPECT_ENRICHMENT_ACTION } from '../../../backend/services/enrichment/providers/cost';

/**
 * PI R1: enrich selected prospects from Apollo, PREVIEW FIRST.
 *
 *   POST /api/prospect-sources/apollo-enrich?companyId=<uuid>
 *     { mode: 'preview', prospectIds: string[] (<=25), maxProviderCalls: n (<=50) }
 *       -> what the run would do: Apollo calls, the attributes per call, the
 *          tenant's chosen field groups, and an estimateHash. Spends nothing.
 *     { mode: 'run', ...same, estimateHash }
 *       -> the run, ONLY if a freshly recomputed estimate has the same hash.
 *          Otherwise 409 `estimate_changed`, and nothing is spent.
 *
 * The tenant's field groups (R1) narrow what is fetched; the adapter's claims
 * narrow it further. This route runs on the TENANT'S OWN Apollo key (mode A):
 * Apollo bills the tenant, so no Omnivyra credits are charged. The platform-key
 * mode (B), with credits, is a separate change.
 *
 * Authorisation is the single-prospect enrich route's: tenant membership, then
 * PROSPECT_ENRICH_EXECUTE, because a run spends the tenant's provider credits.
 */
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const companyId = str(req.query.companyId) ?? str(req.query.company_id);
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });
  const tenant = await requireTenantAccess(req, res, companyId);
  if (!tenant) return;
  const guard = await requireCapability(req, res, {
    capability: PROSPECT_ENRICH_EXECUTE,
    organizationId: companyId,
    reason: 'preview or execute a billable Apollo enrichment batch funded by this tenant',
  });
  if (guard.ok !== true) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const mode = body.mode === 'preview' || body.mode === 'run' ? body.mode : null;
  const ids = Array.isArray(body.prospectIds) ? body.prospectIds.filter((x): x is string => typeof x === 'string') : [];
  const maxProviderCalls = Number(body.maxProviderCalls);
  if (!mode || ids.length === 0 || ids.length > MAX_ENRICHMENT_BATCH_PROSPECTS
    || !Number.isInteger(maxProviderCalls) || maxProviderCalls < 1) {
    return res.status(400).json({
      error: `mode ('preview'|'run'), 1-${MAX_ENRICHMENT_BATCH_PROSPECTS} prospectIds and a positive integer maxProviderCalls are required`,
      code: 'invalid_request',
    });
  }

  try {
    // Data-controller acknowledgement: a RUN fetches vendor data, so it needs a
    // current (or in-grace) 'vendor_data' acknowledgement; a preview fetches
    // nothing and is allowed, returning the state so the notice is shown.
    const ack = await getTenantDataAckStatus(companyId);
    if (mode === 'run' && !ack.categories.vendor_data.allowed) {
      throw new TenantDataAckRequired('vendor_data', ack.categories.vendor_data.state);
    }
    const groups = await readTenantFieldGroups(companyId, { contactAllowed: ack.categories.contact_data.allowed });
    const allowedAttributes = allowedAttributesFor(groups);
    const now = new Date().toISOString();
    const common = {
      organizationId: companyId, prospectIds: ids, sourceId: 'apollo',
      maxProviderCalls: Math.min(maxProviderCalls, MAX_ENRICHMENT_BATCH_PROVIDER_CALLS),
      allowedAttributes, now,
    };
    const estimate = await previewProspectEnrichmentBatch(common);

    if (mode === 'preview') {
      // Who would pay, decided by the SAME credential resolution the run uses.
      // The key VALUE is discarded here; only the funding kind is reported.
      const resolved = readResolvedCredential(
        await makeFundedCredentialPort().resolveCredential({ organizationId: companyId, providerId: 'apollo' }));
      const vendorUnits = estimate.calls.reduce((n, c) => n + (unitsForCall('apollo', c.subject as 'person' | 'account')?.units ?? 0), 0);
      let omnivyraCredits: number | null = 0;
      if (resolved?.funding === 'platform') {
        // Priced exactly as the reservation will be: per call, by the same function.
        omnivyraCredits = 0;
        for (const c of estimate.calls) {
          const u = unitsForCall('apollo', c.subject as 'person' | 'account');
          if (!u) continue;
          try {
            omnivyraCredits += (await resolveVendorUnitCost({
              provider: 'apollo', unit: u.unit, units: u.units, actionKey: PROSPECT_ENRICHMENT_ACTION, orgId: companyId,
            })).credits;
          } catch {
            omnivyraCredits = null;   // no vendor cost set: central access unavailable, the run would refuse
            break;
          }
        }
      }
      return res.status(200).json({
        dataAck: { vendor_data: ack.categories.vendor_data.state, contact_data: ack.categories.contact_data.state },
        fieldGroups: groups,
        funding: resolved?.funding === 'platform' ? 'central_apollo_access'
          : resolved ? 'tenant_apollo_key' : 'no_apollo_access',
        vendorUnits,
        vendorUnit: 'Apollo credit',
        omnivyraCredits,
        estimate,
      });
    }

    if (str(body.estimateHash) !== estimate.estimateHash) {
      // The plans moved since the preview (new data, a changed field group, a
      // claim added). Spend nothing; the user previews again.
      return res.status(409).json({ error: 'the estimate changed since the preview; preview again', code: 'estimate_changed', estimate });
    }
    const result = await executeProspectEnrichmentBatch(common);
    return res.status(200).json({ fieldGroups: groups, estimate, result });
  } catch (e) {
    if (e instanceof TenantDataAckRequired) {
      return res.status(403).json({ error: 'DATA_CONTROLLER_ACK_REQUIRED', category: e.category, state: e.state });
    }
    console.error('[prospect-sources/apollo-enrich]', { mode, message: e instanceof Error ? e.message : 'error' });
    return res.status(500).json({ error: 'APOLLO_ENRICH_FAILED' });
  }
}

export default __createApiRoute(handler, { route: '/api/prospect-sources/apollo-enrich' });

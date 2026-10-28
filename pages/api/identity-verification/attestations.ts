import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Identity verification — operator ATTESTATION records (never verification).
 *
 *   GET    /api/identity-verification/attestations?company_id=<uuid>&person_id=<uuid>
 *          -> { attestations, confersVerification: false }
 *   POST   /api/identity-verification/attestations
 *          { company_id, person_id, platform, provider_user_id, basis, statement,
 *            evidence?: { references?, notes?, observed_at? },
 *            identity_claim_id?, discovered_user_id? }
 *          -> { attestation, replayed, confersVerification: false }
 *   DELETE /api/identity-verification/attestations
 *          { company_id, attestation_id, reason } -> { attestation, confersVerification: false }
 *
 * WHAT THIS IS NOT. Operator confirmation alone does not establish that a person
 * owns an account (product decision). Recording an attestation changes no
 * identity claim, sets no verification state and links nothing: the community
 * person proof refuses every claim whose evidence is not an ACCEPTED person-level
 * proof (backend/services/identityVerification/verificationContract.ts), and
 * operator attestation is a NON_PROVING method. Every response says so.
 *
 * AUTHORIZATION, in order: company membership (`enforceCompanyAccess`), then
 * `PROSPECT_INGEST` in that tenant (COMPANY_ADMIN / SUPER_ADMIN only — an
 * attestation is an assertion about one person, the authority that capability
 * already names). Writes additionally require a phishing-resistant step-up
 * session no older than 10 minutes; the decision is audited by requireCapability
 * (capability_audit_log, resource = the person / attestation). The operator and
 * tenant come from the authenticated principal and the verified company, never
 * from the body.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { PROSPECT_INGEST, type StepUpRequirement } from '../../../shared/contracts/security';
import {
  AttestationError, listAttestations, recordAttestation, withdrawAttestation,
  type AttestationErrorCode,
} from '../../../backend/services/identityVerification/attestationStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const METHODS = ['GET', 'POST', 'DELETE'];

export const ATTESTATION_STEP_UP: StepUpRequirement = {
  capability: PROSPECT_INGEST,
  maxAgeSeconds: 600,
  phishingResistantOnly: true,
  reason: 'Confirm with your passkey to record or withdraw an identity attestation',
};

export const statusForAttestationError = (code: AttestationErrorCode): number => {
  switch (code) {
    case 'invalid_input':
    case 'evidence_invalid':
      return 400;
    case 'person_not_found':
    case 'not_found':
      return 404;
    case 'account_already_attested':
      return 409;
    case 'reference_invalid':
      return 422;
    case 'attestation_unreadable':
      return 503;
    default:
      return 500;
  }
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!METHODS.includes(req.method ?? '')) {
    res.setHeader('Allow', METHODS.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const isWrite = req.method !== 'GET';
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = str(req.query.company_id) ?? str(body.company_id);
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const personId = req.method === 'GET' ? str(req.query.person_id) : str(body.person_id);
  const attestationId = req.method === 'DELETE' ? str(body.attestation_id) : null;

  const guard = await requireCapability(req, res, {
    capability: PROSPECT_INGEST,
    organizationId: companyId,
    reason: req.method === 'GET'
      ? 'read identity attestations'
      : req.method === 'POST' ? 'record an identity attestation (confers no verification)' : 'withdraw an identity attestation',
    resourceId: attestationId ?? personId ?? undefined,
    requireStepUp: isWrite,
    stepUpOverride: isWrite ? ATTESTATION_STEP_UP : undefined,
  });
  // `ok !== true`, not `!ok` (strict:false disables narrowing on a negated boolean).
  if (guard.ok !== true) return;
  const principal = guard.principal;

  try {
    if (req.method === 'GET') {
      if (!personId || !UUID.test(personId)) return res.status(400).json({ error: 'person_id must be a uuid' });
      const attestations = await listAttestations(companyId, personId);
      return res.status(200).json({ attestations, confersVerification: false });
    }
    if (req.method === 'POST') {
      if (!personId || !UUID.test(personId)) return res.status(400).json({ error: 'person_id must be a uuid' });
      const { attestation, replayed } = await recordAttestation({
        organizationId: companyId,                 // the VERIFIED tenant, never the body's
        personId,
        platform: str(body.platform) ?? '',
        providerUserId: str(body.provider_user_id) ?? '',
        identityClaimId: str(body.identity_claim_id),
        discoveredUserId: str(body.discovered_user_id),
        basis: str(body.basis) ?? '',
        statement: typeof body.statement === 'string' ? body.statement : '',
        evidence: body.evidence,
        attestedBy: principal.userId,              // the authenticated operator
        stepUpSessionId: principal.stepUp?.sessionId ?? null,
        stepUpFactor: principal.stepUp?.factor ?? null,
      });
      return res.status(replayed ? 200 : 201).json({ attestation, replayed, confersVerification: false });
    }
    if (!attestationId || !UUID.test(attestationId)) return res.status(400).json({ error: 'attestation_id must be a uuid' });
    const attestation = await withdrawAttestation({
      organizationId: companyId,
      attestationId,
      withdrawnBy: principal.userId,
      reason: typeof body.reason === 'string' ? body.reason : '',
    });
    return res.status(200).json({ attestation, confersVerification: false });
  } catch (e) {
    if (e instanceof AttestationError) {
      return res.status(statusForAttestationError(e.code)).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: 'identity attestation request failed' });
  }
}

export default __createApiRoute(handler, {
  route: '/api/identity-verification/attestations',
});

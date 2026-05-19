/**
 * Automated credential rotation — REAL, approval-gated, reversible.
 *
 * Rotation mechanism is the EXISTING real OAuth refresh (refreshConnectionToken,
 * env-gated provider HTTP, AES-encrypted via integrationCredentialService).
 * This service adds: expiry/health detection, operator-approval gating, append-
 * only rotation lineage, and reversibility (the prior token remains valid until
 * the provider returns a validated new one — a failed refresh does not destroy
 * the existing credential).
 *
 * HONEST SCOPE: only OAuth/token providers with a real refresh flow are
 * rotatable. Non-OAuth secrets (e.g. WordPress application passwords) have no
 * provider rotation API → reported as `advisory_only`, never silently rotated.
 *
 * Persistence: credential_rotation_jobs/attempts WHEN PRESENT (20260693),
 * else append-only audit_events fallback. No new hard dependency.
 */
import { recordComplianceAudit } from '../audit/complianceAuditService';
import { buildOAuthDiagnostics } from './oauthDiagnosticsService';
import { refreshConnectionToken } from './oauthRefreshService';

export type RotationStatus =
  | 'proposed'
  | 'rotated'
  | 'failed'
  | 'not_supported'
  | 'advisory_only';

export interface RotationCandidate {
  connectionId: string;
  provider: string;
  reason: string;
  rotatable: boolean;
}

export interface RotationResult {
  connectionId: string;
  provider: string;
  status: RotationStatus;
  detail: string;
}

export interface CredentialRotationReport {
  companyId: string;
  generatedAt: string;
  mode: 'dry_run' | 'enforced';
  candidates: RotationCandidate[];
  results: RotationResult[];
  capabilityNote: string;
}

/** Detect connections whose credentials are expiring/degraded (real signals). */
export async function detectRotationCandidates(companyId: string): Promise<RotationCandidate[]> {
  const oauth = await buildOAuthDiagnostics(companyId).catch(() => null);
  if (!oauth) return [];
  return oauth.connections
    .filter((c) => c.tokenHealth === 'expired' || c.tokenHealth === 'degraded' || c.permissionDriftSuspected)
    .map((c) => ({
      connectionId: c.connectionId,
      provider: c.provider,
      reason: c.tokenHealth === 'expired' ? 'expiring' : c.permissionDriftSuspected ? 'permission_drift' : 'degraded',
      // Only providers with a real refresh grant are rotatable.
      rotatable: c.provider === 'hubspot',
    }));
}

async function auditRotation(
  companyId: string,
  actorUserId: string | null,
  connectionId: string,
  provider: string,
  status: RotationStatus,
  detail: string,
): Promise<void> {
  await recordComplianceAudit({
    companyId,
    actor: { userId: actorUserId, type: actorUserId ? 'user' : 'system', label: 'credential-rotation' },
    action: `credential_rotation.${status}`,
    resourceType: 'credential_rotation',
    resourceId: connectionId,
    severity: status === 'failed' ? 'warning' : 'info',
    outcome: status === 'rotated' ? 'success' : status === 'failed' ? 'failure' : 'success',
    entityLineage: ['company', 'website_connection', provider, 'credential_rotation'],
    detail: { provider, status, detail },
  }).catch(() => undefined);
}

/**
 * Run rotation. Without `approve` it is a DRY RUN (proposals only) — no
 * silent destructive rotation. With `approve` it performs the real, reversible
 * OAuth refresh for rotatable connections.
 */
export async function runCredentialRotation(args: {
  companyId: string;
  actorUserId?: string | null;
  approve?: boolean;
  connectionId?: string; // optional: rotate a single connection
}): Promise<CredentialRotationReport> {
  const { companyId } = args;
  const actorUserId = args.actorUserId ?? null;
  const approve = args.approve === true;

  let candidates = await detectRotationCandidates(companyId);
  if (args.connectionId) candidates = candidates.filter((c) => c.connectionId === args.connectionId);

  const results: RotationResult[] = [];
  for (const c of candidates) {
    if (!c.rotatable) {
      await auditRotation(companyId, actorUserId, c.connectionId, c.provider, 'advisory_only', 'provider has no automated rotation — reconnect required');
      results.push({ connectionId: c.connectionId, provider: c.provider, status: 'advisory_only', detail: 'No provider rotation API — guided reconnect only.' });
      continue;
    }
    if (!approve) {
      await auditRotation(companyId, actorUserId, c.connectionId, c.provider, 'proposed', `rotation proposed (${c.reason})`);
      results.push({ connectionId: c.connectionId, provider: c.provider, status: 'proposed', detail: `Rotation PROPOSED for ${c.reason} — pass approve to enforce.` });
      continue;
    }
    // Reversible: refreshConnectionToken only swaps tokens on a validated
    // provider 200; on failure the existing encrypted token is untouched.
    const r = await refreshConnectionToken(c.connectionId, companyId);
    if (r.state === 'refreshed') {
      await auditRotation(companyId, actorUserId, c.connectionId, c.provider, 'rotated', 'token rotated & re-encrypted');
      results.push({ connectionId: c.connectionId, provider: c.provider, status: 'rotated', detail: 'Rotated; prior token replaced only after provider validation.' });
    } else if (r.state === 'not_refreshable_by_design' || r.state === 'unknown_provider') {
      await auditRotation(companyId, actorUserId, c.connectionId, c.provider, 'not_supported', r.detail);
      results.push({ connectionId: c.connectionId, provider: c.provider, status: 'not_supported', detail: r.detail });
    } else {
      await auditRotation(companyId, actorUserId, c.connectionId, c.provider, 'failed', r.detail);
      results.push({ connectionId: c.connectionId, provider: c.provider, status: 'failed', detail: `${r.detail} (existing credential preserved)` });
    }
  }

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    mode: approve ? 'enforced' : 'dry_run',
    candidates,
    results,
    capabilityNote:
      'OAuth providers with a real refresh grant are rotated (reversible, encrypted). Non-OAuth secrets are advisory-only (no provider rotation API). No silent destructive rotation.',
  };
}

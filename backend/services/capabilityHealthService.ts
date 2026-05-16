/**
 * Phase 1 — Capability health diagnostics.
 *
 * Detects inconsistent / unsafe states by walking a CapabilityAggregate.
 * Pure derivation over the aggregate — no I/O. Every finding is structured
 * (severity + code + detail) so an operations dashboard can present them
 * without having to interpret prose.
 *
 * Severity ladder:
 *   • info    — informational, no action required (e.g. consent will turn
 *                stale in 30 days)
 *   • warning — degraded posture; monitoring should not start until
 *                resolved (e.g. consent_stale, scope_insufficient)
 *   • error   — unsafe state; capability/consent should be revoked or
 *                cleaned up (e.g. orphan capability, invalid source)
 *
 * Phase 1 surfaces these findings to the Active Leads panel as badges; a
 * later phase wires the same shape into the ops alerting channel.
 */

import type {
  CapabilityAggregate,
  PlatformAggregate,
} from './capabilityAggregationService';
import { LISTENING_SCOPE_REQUIREMENTS } from './capabilityAggregationService';

export const HEALTH_FINDING_CODES = [
  'consent_stale',
  'consent_approaching_stale',
  'revoked_scope_warning',
  'orphan_capability',
  'invalid_source',
  'pending_capability_no_consent',
  'enabled_without_connection',
] as const;
export type HealthFindingCode = (typeof HEALTH_FINDING_CODES)[number];

export type HealthSeverity = 'info' | 'warning' | 'error';

export type HealthFinding = {
  code: HealthFindingCode;
  severity: HealthSeverity;
  platform: string | null;
  detail: string;
};

export type CapabilityHealthReport = {
  organization_id: string;
  generated_at: string;
  findings: HealthFinding[];
  rollups: {
    info: number;
    warning: number;
    error: number;
  };
};

const STALE_DAYS = 180;
const APPROACHING_STALE_DAYS = 150;

function findingsForPlatform(p: PlatformAggregate): HealthFinding[] {
  const out: HealthFinding[] = [];

  for (const cap of p.capabilities) {
    if (cap.enabled && !p.is_connected) {
      out.push({
        code: 'enabled_without_connection',
        severity: 'error',
        platform: p.platform,
        detail: `capability ${cap.capability} enabled but no active OAuth connection`,
      });
    }

    if (cap.enabled && cap.consent_record_age_days != null) {
      if (cap.consent_record_age_days > STALE_DAYS) {
        out.push({
          code: 'consent_stale',
          severity: 'warning',
          platform: p.platform,
          detail: `${cap.capability} consent is ${cap.consent_record_age_days} days old`,
        });
      } else if (cap.consent_record_age_days > APPROACHING_STALE_DAYS) {
        out.push({
          code: 'consent_approaching_stale',
          severity: 'info',
          platform: p.platform,
          detail: `${cap.capability} consent is ${cap.consent_record_age_days} days old (approaching ${STALE_DAYS}-day refresh)`,
        });
      }
    }

    if (cap.status === 'pending' && cap.consent_record_id == null) {
      out.push({
        code: 'pending_capability_no_consent',
        severity: 'info',
        platform: p.platform,
        detail: `${cap.capability} is pending without a backing consent record`,
      });
    }
  }

  const listenRow = p.capabilities.find((c) => c.capability === 'listen');
  if (listenRow?.enabled && p.is_connected) {
    const required = LISTENING_SCOPE_REQUIREMENTS[p.platform] ?? [];
    const missing = required.filter((s) => !p.granted_scopes.includes(s));
    if (missing.length > 0) {
      out.push({
        code: 'revoked_scope_warning',
        severity: 'warning',
        platform: p.platform,
        detail: `granted scopes are missing required scope(s): ${missing.join(', ')}`,
      });
    }
  }

  return out;
}

export function buildCapabilityHealthReport(
  aggregate: CapabilityAggregate,
): CapabilityHealthReport {
  const findings: HealthFinding[] = [];

  for (const p of aggregate.platforms) {
    findings.push(...findingsForPlatform(p));
  }

  // Orphan capability: enabled capability for a platform with no active
  // OAuth connection. Already covered per-platform above, but aggregate-level
  // also handles capabilities for platforms that don't appear in
  // `aggregate.platforms` (defensive — shouldn't happen post-aggregator
  // dedup, but guards against drift).
  const connectedPlatforms = new Set(
    aggregate.platforms.filter((p) => p.is_connected).map((p) => p.platform),
  );

  for (const p of aggregate.platforms) {
    if (p.is_connected) continue;
    const enabledCaps = p.capabilities.filter((c) => c.enabled);
    if (enabledCaps.length > 0 && !connectedPlatforms.has(p.platform)) {
      // Already produced an `enabled_without_connection` per-cap above; add
      // a single orphan_capability summary at platform level too.
      findings.push({
        code: 'orphan_capability',
        severity: 'error',
        platform: p.platform,
        detail: `${enabledCaps.length} enabled capabilit${
          enabledCaps.length === 1 ? 'y' : 'ies'
        } for disconnected platform`,
      });
    }
  }

  // Invalid source: a listening_source claiming an active monitoring mode
  // but pointing to a platform with no active connection.
  for (const src of aggregate.listening_sources) {
    if (src.status !== 'active') continue;
    const meta = (src as unknown as { metadata?: { platform?: string } }).metadata;
    const platformHint = meta?.platform;
    if (platformHint && !connectedPlatforms.has(platformHint.toLowerCase())) {
      findings.push({
        code: 'invalid_source',
        severity: 'error',
        platform: platformHint.toLowerCase(),
        detail: `listening source ${src.id} is active but ${platformHint} is not connected`,
      });
    }
  }

  const rollups = findings.reduce(
    (acc, f) => {
      acc[f.severity] += 1;
      return acc;
    },
    { info: 0, warning: 0, error: 0 },
  );

  return {
    organization_id: aggregate.organization_id,
    generated_at: aggregate.generated_at,
    findings,
    rollups,
  };
}

/**
 * Lightweight per-platform health summary suitable for UI badges. Returns
 * the most-severe finding code per platform; consumers can render a single
 * coloured dot.
 */
export function summarisePlatformHealth(
  report: CapabilityHealthReport,
): Record<string, { severity: HealthSeverity; codes: HealthFindingCode[] }> {
  const byPlatform: Record<string, { severity: HealthSeverity; codes: HealthFindingCode[] }> = {};

  const sevRank: Record<HealthSeverity, number> = { info: 0, warning: 1, error: 2 };

  for (const f of report.findings) {
    if (!f.platform) continue;
    const existing = byPlatform[f.platform];
    if (!existing) {
      byPlatform[f.platform] = { severity: f.severity, codes: [f.code] };
      continue;
    }
    existing.codes.push(f.code);
    if (sevRank[f.severity] > sevRank[existing.severity]) {
      existing.severity = f.severity;
    }
  }

  return byPlatform;
}

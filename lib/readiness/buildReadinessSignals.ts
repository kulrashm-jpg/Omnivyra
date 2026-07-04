/**
 * buildReadinessSignals — normalize raw, canonical, tenant-specific data into
 * the ReadinessSignals contract the readiness registry consumes. This is the
 * ONLY place raw API shapes are read for Readiness. No scoring, no UI.
 *
 * Canonical providers consumed here:
 *   /api/website-intelligence/canonical → snapshot.{domain, tracking, readiness.checks, integrations}
 *   /api/social-accounts/status         → accounts[].{connected, expired, refresh_status}
 *   /api/blogs                          → blogs[] (content library)
 *   /api/creator-templates/collections  → collections[] (template library)
 *   /api/creator-assets                 → assets[] (media assets)
 *   /api/automation/config              → { enabled, auto_reply_enabled, auto_dm_enabled }
 */

import type { ReadinessSignals } from '../../config/readinessRegistry';
import type { FeatureStatus } from '../../backend/services/commandCenterReadinessService';

const nonEmpty = (v: unknown): boolean => {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  return Boolean(v);
};

const CRM_INTEGRATION_TYPES = new Set(['hubspot', 'salesforce', 'pipedrive', 'crm', 'zoho', 'close']);
const REFRESH_PROBLEM = new Set(['failed', 'requires_reconnect']);

export interface WebsiteSnapshotInput {
  domain?: { verified?: boolean } | null;
  tracking?: { active?: boolean; installed?: boolean } | null;
  readiness?: { checks?: Array<{ id?: string; done?: boolean }> } | null;
  integrations?: Array<{ type?: string; status?: string }> | null;
}

export interface RawReadinessInputs {
  profile: Record<string, unknown> | null;
  features: FeatureStatus[];
  socialAccounts: Array<{
    category?: string;
    connected?: boolean;
    expired?: boolean;
    refresh_status?: string | null;
  }> | null;
  /** /api/website-intelligence/canonical → snapshot (or null if unreadable). */
  websiteSnapshot: WebsiteSnapshotInput | null;
  /** Content library count (null = endpoint unavailable). */
  blogsCount: number | null;
  /** Template collection count (null = unavailable). */
  templatesCount: number | null;
  /** Media asset count (null = unavailable). */
  mediaCount: number | null;
  /** Automation config (null = unavailable). */
  automation: { enabled: boolean; autoReply: boolean; autoDm: boolean } | null;
}

const REFRESH_MSG = 'This will refresh automatically.';

export function buildReadinessSignals(input: RawReadinessInputs): ReadinessSignals {
  const p = input.profile ?? {};

  const features: Record<string, number> = {};
  for (const f of input.features) {
    features[f.key] = typeof f.score === 'number' ? f.score : f.status === 'completed' ? 1 : 0;
  }

  // Channels — canonical connection + publish-readiness from refresh_status.
  let channels: ReadinessSignals['channels'];
  if (Array.isArray(input.socialAccounts)) {
    const social = input.socialAccounts.filter((a) => (a.category ?? 'social') === 'social');
    const connectedRows = social.filter((a) => a.connected === true);
    const expiredCount = connectedRows.filter((a) => a.expired === true).length;
    const permissionIssueCount = connectedRows.filter(
      (a) => a.refresh_status != null && REFRESH_PROBLEM.has(String(a.refresh_status).toLowerCase()),
    ).length;
    const publishReadyCount = connectedRows.filter(
      (a) => a.expired !== true && !(a.refresh_status != null && REFRESH_PROBLEM.has(String(a.refresh_status).toLowerCase())),
    ).length;
    channels = {
      available: true,
      reason: null,
      connectedCount: connectedRows.length,
      totalCount: social.length,
      expiredCount,
      publishReadyCount,
      permissionIssueCount,
    };
  } else {
    channels = {
      available: false,
      reason: `Channel connection status could not be loaded. ${REFRESH_MSG}`,
      connectedCount: 0,
      totalCount: 0,
      expiredCount: 0,
      publishReadyCount: 0,
      permissionIssueCount: 0,
    };
  }

  // Foundation — canonical website snapshot.
  const snap = input.websiteSnapshot;
  const analyticsCheck = snap?.readiness?.checks?.find((c) => c.id === 'analytics');
  const foundation: ReadinessSignals['foundation'] = snap
    ? {
        available: true,
        reason: null,
        domainVerified: Boolean(snap.domain?.verified),
        analyticsConnected: Boolean(analyticsCheck?.done),
        trackingActive: Boolean(snap.tracking?.active || snap.tracking?.installed),
      }
    : {
        available: false,
        reason: `Website intelligence could not be loaded. ${REFRESH_MSG}`,
        domainVerified: false,
        analyticsConnected: false,
        trackingActive: false,
      };

  const count = (n: number | null): { available: boolean; reason: string | null; count: number } =>
    n === null
      ? { available: false, reason: `Could not be loaded. ${REFRESH_MSG}`, count: 0 }
      : { available: true, reason: null, count: n };

  // Automation — lead capture + CRM from the website snapshot; workflows from config.
  const leadsCheck = snap?.readiness?.checks?.find((c) => c.id === 'leads');
  const crmConnected = Array.isArray(snap?.integrations)
    ? snap!.integrations!.some((i) => i.type != null && CRM_INTEGRATION_TYPES.has(String(i.type).toLowerCase()))
    : false;

  const websiteUrl =
    typeof p['website_url'] === 'string' && (p['website_url'] as string).trim().length > 0
      ? (p['website_url'] as string).trim()
      : null;

  return {
    features,
    profile: {
      companyProfileComplete: nonEmpty(p['name']) && (nonEmpty(p['industry']) || nonEmpty(p['industry_list'])),
      industry: nonEmpty(p['industry']) || nonEmpty(p['industry_list']),
      regions: nonEmpty(p['geography']) || nonEmpty(p['geography_list']),
      targetAudience: nonEmpty(p['target_audience']) || nonEmpty(p['target_audience_list']),
      websiteUrl,
    },
    channels,
    foundation,
    content: {
      library: count(input.blogsCount),
      templates: count(input.templatesCount),
      media: count(input.mediaCount),
    },
    automation: {
      leadCapture: snap
        ? { available: true, reason: null, configured: Boolean(leadsCheck?.done) }
        : { available: false, reason: `Website intelligence could not be loaded. ${REFRESH_MSG}`, configured: false },
      crm: snap
        ? { available: true, reason: null, configured: crmConnected }
        : { available: false, reason: `Integration status could not be loaded. ${REFRESH_MSG}`, configured: false },
      workflows: input.automation
        ? { available: true, reason: null, configured: input.automation.enabled && (input.automation.autoReply || input.automation.autoDm) }
        : { available: false, reason: `Automation status could not be loaded. ${REFRESH_MSG}`, configured: false },
    },
  };
}

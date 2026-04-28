import { supabase } from '../../db/supabaseClient';
import { getPlatformsWithTokensForOrg } from '../platformTokenService';
import { getCompanyConfiguredPlatformsForConnectors } from '../companyPlatformService';
import { resolveEngagementCapability } from '../engagementCapabilityMap';

/**
 * Per-org platform-health resolver.
 *
 * Answers the product question: "for each platform this org has
 * connected, which egress mechanism (API / RPA / Extension / Publish
 * adapter) and which ingress mechanism (Polling / Webhook) is
 * actually usable right now?"
 *
 * Detection is read-only and cheap:
 *   - API connected     → community_ai_platform_tokens has an access_token
 *                         (+ social_accounts fallback, via
 *                          getPlatformsWithTokensForOrg).
 *   - RPA session       → rpa_sessions row exists for (org, platform) AND
 *                         expires_at is null or in the future.
 *   - Extension         → at least one `execution_success` metric event
 *                         in the last 30 days with execution_mode='browser'
 *                         for that platform. Absence → 'unverified'.
 *   - Publish adapter   → static capability: certain platforms have
 *                         publish adapters even without a REST connector
 *                         (WhatsApp, TikTok). Detected by name list.
 *   - Polling ingest    → static capability: platforms whose comment
 *                         fetcher is implemented in engagementIngestionService.
 *   - Webhook ingest    → only WhatsApp today. Static list.
 *
 * No writes. No long queries. Three parallel SELECTs + one per platform.
 */

export type EgressMechanism = 'api' | 'rpa' | 'extension' | 'publish_adapter';
export type IngressMechanism = 'polling' | 'webhook' | 'extension_events';

export type EgressStatus = 'ok' | 'unsupported' | 'no_session' | 'unverified' | 'none';
export type IngressStatus = 'active' | 'none';

export type ActionKey = 'reply' | 'like' | 'dm' | 'post';

export type PerActionEgress = Record<EgressMechanism, EgressStatus>;

export type PlatformHealth = {
  platform: string;
  /** True when an admin has explicitly enabled this platform for the
   *  company (profile link, external_api_sources, global config). */
  admin_configured: boolean;
  /** True when at least one mechanism (API token, RPA session, or a
   *  recent verified extension success) is currently usable. */
  has_live_connection: boolean;
  connected_via: EgressMechanism[];
  egress: Record<ActionKey, PerActionEgress>;
  ingress: Record<IngressMechanism, IngressStatus>;
  overall: 'green' | 'orange' | 'red';
  observed_at: string;
};

// Platforms that have an API connector for engagement actions.
const API_CONNECTOR_PLATFORMS = new Set<string>([
  'linkedin', 'facebook', 'instagram', 'twitter', 'youtube', 'reddit',
]);

// Platforms whose publish adapter is present (outbound posting path).
// Some platforms (WhatsApp, TikTok) have ONLY the publish adapter, not
// a connector — so this list is used for the per-action 'post' column.
const PUBLISH_ADAPTER_PLATFORMS = new Set<string>([
  'linkedin', 'facebook', 'instagram', 'twitter', 'youtube', 'tiktok', 'whatsapp', 'pinterest', 'reddit',
]);

// Platforms with a comment ingestion path in engagementIngestionService.
const POLLING_INGEST_PLATFORMS = new Set<string>([
  'linkedin', 'facebook', 'instagram', 'twitter',
]);

// Platforms with a server-side webhook receiver. WhatsApp is the only
// one today (pages/api/whatsapp/webhook/index.ts).
const WEBHOOK_INGEST_PLATFORMS = new Set<string>(['whatsapp']);

// Browser-capable inbox platforms — those with at least one mode='browser'
// entry in the engagement capability matrix. Used by the heartbeat
// liveness check: an alive extension session marks ALL of these as
// 'connected', so the badge flips to 'ok' as soon as the extension is
// polling, not only after a successful end-to-end action.
const BROWSER_CAPABLE_INBOX_PLATFORMS = ['linkedin', 'facebook', 'instagram'] as const;

// Which (platform, action) pairs have a real RPA script. Derived from
// the presence of a script in rpaPlatformScripts.ts.
const RPA_SUPPORT: Record<string, Set<ActionKey>> = {
  linkedin:  new Set(['reply', 'like']),
  facebook:  new Set(['reply', 'like']),
  instagram: new Set(['reply', 'like']),
  twitter:   new Set(['reply', 'like']),
  reddit:    new Set(['reply', 'like']),
};

function normalize(p: string): string {
  const v = (p || '').toString().trim().toLowerCase();
  return v === 'x' ? 'twitter' : v;
}

/**
 * Fetch RPA session presence + freshness per platform for this org.
 * Returns set of normalized platforms with a session that isn't expired.
 */
async function loadRpaSessionPlatforms(organizationId: string): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const nowIso = new Date().toISOString();
    const { data } = await supabase
      .from('rpa_sessions')
      .select('platform, expires_at')
      .eq('organization_id', organizationId);
    for (const row of (data || []) as Array<{ platform?: string; expires_at?: string | null }>) {
      if (!row.platform) continue;
      if (row.expires_at && row.expires_at < nowIso) continue;
      out.add(normalize(row.platform));
    }
  } catch {
    /* treat as absent */
  }
  return out;
}

/**
 * Platforms where the extension is detectably alive — three signals,
 * checked in order of strength:
 *
 *   1. Recent (30d) `execution_success` with execution_mode='browser'
 *      → 'verified': we've seen the extension perform an action.
 *   2. Any (7d) browser-mode metric event (started / failed / ack) →
 *      'connected': the extension is loaded and at least attempted
 *      something for this platform.
 *   3. Otherwise → 'unverified': we cannot prove activity. Note: this
 *      is NOT the same as "not installed". The user may have just
 *      reloaded the extension; it'll flip to verified after one real
 *      browser-mode action.
 *
 * Returns two sets: { verified, connected } — verified is a strict
 * subset of connected.
 */
async function loadExtensionLivenessPlatforms(
  organizationId: string,
): Promise<{ verified: Set<string>; connected: Set<string> }> {
  const verified = new Set<string>();
  const connected = new Set<string>();
  try {
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: successRows } = await supabase
      .from('community_ai_execution_metric_events')
      .select('platform')
      .eq('organization_id', organizationId)
      .eq('execution_mode', 'browser')
      .eq('event_type', 'execution_success')
      .gte('created_at', since30)
      .limit(200);
    for (const row of (successRows || []) as Array<{ platform?: string }>) {
      if (row.platform) {
        verified.add(normalize(row.platform));
        connected.add(normalize(row.platform));
      }
    }

    // Liveness: any browser-mode event in the last 7 days. Captures
    // started + failed + ack_received in addition to success.
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: anyRows } = await supabase
      .from('community_ai_execution_metric_events')
      .select('platform')
      .eq('organization_id', organizationId)
      .eq('execution_mode', 'browser')
      .gte('created_at', since7)
      .limit(500);
    for (const row of (anyRows || []) as Array<{ platform?: string }>) {
      if (row.platform) connected.add(normalize(row.platform));
    }

    // Heartbeat liveness: if the extension session is alive (last_seen
    // within ~10 minutes), treat every browser-mode platform as
    // 'connected'. This bridges the cold-start gap — when the extension
    // is freshly loaded but hasn't been called on to perform an action
    // yet, the badge should still reflect "extension is alive and ready"
    // rather than the stricter "we've never seen it act for this
    // platform yet". The extension_sessions row's last_seen is bumped
    // on every successful /api/extension/commands poll.
    const sinceHeartbeat = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: aliveSessions } = await supabase
      .from('extension_sessions')
      .select('id, last_seen')
      .eq('org_id', organizationId)
      .gte('last_seen', sinceHeartbeat)
      .limit(1);
    if ((aliveSessions ?? []).length > 0) {
      // Mark every browser-capable inbox platform connected. We don't
      // know which surfaces the extension has actually loaded into, but
      // an alive heartbeat is a strong-enough signal for the badge.
      for (const platform of BROWSER_CAPABLE_INBOX_PLATFORMS) {
        connected.add(platform);
      }
    }
  } catch {
    /* treat as unverified */
  }
  return { verified, connected };
}

/**
 * Capability gate — ask the engagement capability matrix whether a
 * given (platform, action) pair is considered API-verified. Drives the
 * 'api' column of the egress map for each action.
 */
function apiStatusFor(platform: string, action: ActionKey): EgressStatus {
  const capAction = action === 'post' ? 'post_create' : action; // matrix uses post_create
  try {
    const cap = resolveEngagementCapability(platform, capAction as any);
    if (!cap) return 'none';
    if (cap.status === 'api_verified' && cap.mode === 'api') return 'ok';
    if (cap.status === 'unsupported') return 'unsupported';
    // api_verified with mode=browser means the capability is real but
    // routes through the extension, not the API — from the 'api' column's
    // perspective that's 'none'. The 'extension' column picks it up.
    return 'none';
  } catch {
    return 'none';
  }
}

function rpaStatusFor(
  platform: string,
  action: ActionKey,
  hasSession: boolean,
): EgressStatus {
  const scripts = RPA_SUPPORT[platform];
  if (!scripts || !scripts.has(action)) return 'none';
  return hasSession ? 'ok' : 'no_session';
}

function extensionStatusFor(
  platform: string,
  action: ActionKey,
  verified: boolean,
  connected: boolean,
): EgressStatus {
  try {
    const capAction = action === 'post' ? 'post_create' : action;
    const cap = resolveEngagementCapability(platform, capAction as any);
    if (!cap || cap.status !== 'api_verified') return 'none';
    // The extension path is indicated by mode='browser' in the matrix
    // (e.g. LinkedIn DM). For mode='api' pairs, the extension COULD
    // still do it (fallback path) but the capability map doesn't route
    // there by default, so we mark it 'none' to avoid false optimism.
    if (cap.mode !== 'browser') return 'none';
    // 'verified' = we've seen a successful browser-mode execution for
    // this platform. 'connected' = the extension is at least alive
    // (any browser-mode event in the recent window). Both surface as
    // 'ok' to the operator — the strip distinguishes them in summaries.
    if (verified) return 'ok';
    if (connected) return 'ok';
    return 'unverified';
  } catch {
    return 'none';
  }
}

function publishAdapterStatusFor(platform: string, action: ActionKey): EgressStatus {
  if (action !== 'post') return 'none';
  return PUBLISH_ADAPTER_PLATFORMS.has(platform) ? 'ok' : 'none';
}

function scoreOverall(
  egress: Record<ActionKey, PerActionEgress>,
  ingress: Record<IngressMechanism, IngressStatus>,
): 'green' | 'orange' | 'red' {
  // Count CAPABLE cells — those a platform can actually use. 'none' and
  // 'unsupported' mean the mechanism isn't applicable for this platform
  // (e.g. RPA/dm, Publish/reply) and aren't counted for or against.
  //
  //   green  = every capable cell is ok.
  //   orange = mixed — at least one cell is ok and at least one capable
  //            cell is not (RPA no_session, Ext unverified, etc.). This
  //            is the honest state when the platform has multiple
  //            mechanisms and some aren't configured yet.
  //   red    = no cell is ok. Platform is admin-configured but nothing
  //            in this row currently executes.
  let capable = 0;
  let healthy = 0;
  for (const row of Object.values(egress)) {
    for (const v of Object.values(row)) {
      if (v === 'none' || v === 'unsupported') continue;
      capable += 1;
      if (v === 'ok') healthy += 1;
    }
  }
  for (const v of Object.values(ingress)) {
    if (v === 'none') continue;
    capable += 1;
    if (v === 'active') healthy += 1;
  }

  if (healthy === 0) return 'red';
  if (healthy < capable) return 'orange';
  return 'green';
}

/**
 * Main resolver. Returns health snapshots for platforms the **company
 * admin has configured** for this org — per getCompanyConfiguredPlatformsForConnectors.
 *
 * Previously this merged "anyone has an OAuth token somewhere" with the
 * admin list, which over-reported. The admin list is the authoritative
 * "is this platform enabled for this company at all" signal:
 *   - global OAuth .env config
 *   - company profile social links
 *   - external_api_sources entries (Social Platforms admin page)
 *   - platform-scoped admin configs
 *
 * A platform appears here iff the admin has configured it. The per-
 * mechanism health columns tell the operator WHICH mechanism will
 * fire for each action — including "admin configured but no token"
 * which renders as api=none + overall=red, a useful nudge.
 */
export async function getPlatformHealth(organizationId: string): Promise<PlatformHealth[]> {
  const [configured, connectedApi, rpaSessions, extLiveness] = await Promise.all([
    getCompanyConfiguredPlatformsForConnectors(organizationId).catch(
      () => [] as Array<{ platform: string; displayName: string }>,
    ),
    getPlatformsWithTokensForOrg(organizationId).catch(() => [] as string[]),
    loadRpaSessionPlatforms(organizationId),
    loadExtensionLivenessPlatforms(organizationId),
  ]);
  const extVerified = extLiveness.verified;
  const extConnected = extLiveness.connected;

  // Source of truth: company admin has configured this platform. If the
  // admin list is empty for any reason, fall back to the union of
  // detected connection sources so the screen isn't empty on legacy
  // tenants that never wrote an external_api_sources row.
  const configuredSet = new Set<string>(configured.map((c) => normalize(c.platform)));
  const connectedPlatforms = new Set<string>();
  if (configuredSet.size > 0) {
    for (const p of configuredSet) connectedPlatforms.add(p);
  } else {
    for (const p of connectedApi) connectedPlatforms.add(normalize(p));
    for (const p of rpaSessions) connectedPlatforms.add(p);
    for (const p of extVerified) connectedPlatforms.add(p);
  }

  const out: PlatformHealth[] = [];
  for (const platform of Array.from(connectedPlatforms).sort()) {
    const apiConnected = connectedApi.map(normalize).includes(platform);
    const rpaOk = rpaSessions.has(platform);
    const extVerifiedFlag = extVerified.has(platform);
    const extConnectedFlag = extConnected.has(platform);
    const extOk = extVerifiedFlag || extConnectedFlag;

    const connectedVia: EgressMechanism[] = [];
    if (apiConnected && API_CONNECTOR_PLATFORMS.has(platform)) connectedVia.push('api');
    if (rpaOk) connectedVia.push('rpa');
    if (extOk) connectedVia.push('extension');
    if (PUBLISH_ADAPTER_PLATFORMS.has(platform)) connectedVia.push('publish_adapter');

    const perAction = (action: ActionKey): PerActionEgress => ({
      api:              apiConnected && API_CONNECTOR_PLATFORMS.has(platform)
                         ? apiStatusFor(platform, action)
                         : 'none',
      rpa:              rpaStatusFor(platform, action, rpaOk),
      extension:        extensionStatusFor(platform, action, extVerifiedFlag, extConnectedFlag),
      publish_adapter:  publishAdapterStatusFor(platform, action),
    });

    const egress: Record<ActionKey, PerActionEgress> = {
      reply: perAction('reply'),
      like:  perAction('like'),
      dm:    perAction('dm'),
      post:  perAction('post'),
    };

    const ingress: Record<IngressMechanism, IngressStatus> = {
      polling:          POLLING_INGEST_PLATFORMS.has(platform) ? 'active' : 'none',
      webhook:          WEBHOOK_INGEST_PLATFORMS.has(platform) ? 'active' : 'none',
      extension_events: extOk ? 'active' : 'none',
    };

    const adminConfigured = configuredSet.has(platform);
    const hasLiveConnection = apiConnected || rpaOk || extOk;

    out.push({
      platform,
      admin_configured: adminConfigured,
      has_live_connection: hasLiveConnection,
      connected_via: connectedVia,
      egress,
      ingress,
      overall: scoreOverall(egress, ingress),
      observed_at: new Date().toISOString(),
    });
  }

  return out;
}

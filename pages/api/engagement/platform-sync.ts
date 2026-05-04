import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';
import { randomUUID } from 'crypto';

import { createServiceRoleMigrationProxy } from '@/backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { enforceCompanyAccess } from '@/backend/services/userContextService';

const SYNC_COMMAND_PLATFORMS = new Set(['linkedin']);
const IDEMPOTENCY_BUCKET_MS = 5 * 60 * 1000;

type SyncCommandRow = {
  id: string;
  platform: string;
  status: string | null;
  created_at?: string | null;
};

function normalizePlatform(platform: unknown): string {
  const value = String(platform ?? '').trim().toLowerCase();
  if (value === 'x') return 'twitter';
  return value;
}

function parsePlatforms(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  return Array.from(new Set(raw.map(normalizePlatform).filter(Boolean)));
}

function parseActionIds(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  return Array.from(new Set(raw.map((item) => String(item ?? '').trim()).filter(Boolean)));
}

function parseSince(value: unknown): string {
  const parsed = Date.parse(String(value ?? ''));
  if (!Number.isFinite(parsed)) return new Date(Date.now() - 60 * 1000).toISOString();
  return new Date(parsed).toISOString();
}

async function enqueuePlatformSync(organizationId: string, platform: string, requestedAt: string): Promise<SyncCommandRow> {
  const bucket = Math.floor(Date.parse(requestedAt) / IDEMPOTENCY_BUCKET_MS);
  const idempotencyKey = `platform-sync:${organizationId}:${platform}:${bucket}`;
  const actionId = randomUUID();
  const correlationId = randomUUID();
  const row = {
    id: actionId,
    tenant_id: organizationId,
    organization_id: organizationId,
    platform,
    action_type: 'dm',
    target_id: `sync-dm-inbox:${platform}`,
    suggested_text: null,
    risk_level: 'low',
    requires_human_approval: false,
    requires_approval: false,
    execution_mode: 'browser',
    status: 'pending',
    execution_correlation_id: correlationId,
    idempotency_key: idempotencyKey,
    command_chain: [
      {
        action_type: 'sync_dm_inbox',
        payload: { navigate: true },
      },
    ],
    command_chain_index: 0,
    approved_at: requestedAt,
    created_at: requestedAt,
    updated_at: requestedAt,
  };

  const { data, error } = await supabase
    .from('community_ai_actions')
    .insert(row)
    .select('id, platform, status, created_at')
    .single();

  if (!error && data) return data as SyncCommandRow;

  if ((error as { code?: string } | null)?.code === '23505') {
    const { data: existing, error: existingError } = await supabase
      .from('community_ai_actions')
      .select('id, platform, status, created_at')
      .eq('organization_id', organizationId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (!existingError && existing) return existing as SyncCommandRow;
  }

  throw new Error(error?.message || `Unable to queue ${platform} inbox sync`);
}

async function loadFreshness(organizationId: string, platforms: string[], since: string, actionIds: string[]) {
  const sinceWithSlack = new Date(Math.max(0, Date.parse(since) - 5000)).toISOString();
  const actionsById = new Map<
    string,
    {
      status?: string | null;
      platform?: string | null;
      updated_at?: string | null;
      execution_result?: Record<string, unknown> | null;
    }
  >();

  if (actionIds.length > 0) {
    const { data } = await supabase
      .from('community_ai_actions')
      .select('id, platform, status, updated_at, execution_result')
      .eq('organization_id', organizationId)
      .in('id', actionIds);
    for (const row of data ?? []) {
      const action = row as {
        id: string;
        status?: string | null;
        platform?: string | null;
        updated_at?: string | null;
        execution_result?: Record<string, unknown> | null;
      };
      actionsById.set(action.id, action);
    }
  }

  const result: Record<string, {
    fresh: boolean;
    latest_thread_update: string | null;
    terminal_action: boolean;
    failed_action: boolean;
    failure_reason: string | null;
  }> = {};

  for (const platform of platforms) {
    const { data: latestThread } = await supabase
      .from('engagement_threads')
      .select('updated_at')
      .eq('organization_id', organizationId)
      .eq('platform', platform)
      .gte('updated_at', sinceWithSlack)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const platformActions = Array.from(actionsById.values()).filter((action) => normalizePlatform(action.platform) === platform);
    const terminalAction = platformActions.some((action) =>
      ['executed', 'sent_unverified', 'skipped'].includes(String(action.status ?? '').toLowerCase())
    );
    const failedAction = platformActions.some((action) => String(action.status ?? '').toLowerCase() === 'failed');
    const failedActionRow = platformActions.find((action) => String(action.status ?? '').toLowerCase() === 'failed');
    const failedResult = failedActionRow?.execution_result ?? null;
    const failedResponse =
      failedResult && typeof failedResult.response === 'object' && failedResult.response !== null
        ? failedResult.response as Record<string, unknown>
        : null;
    const failureReason =
      typeof failedResult?.error === 'string'
        ? failedResult.error
        : typeof failedResponse?.error_code === 'string'
          ? failedResponse.error_code
          : typeof failedResponse?.error_message === 'string'
            ? failedResponse.error_message
            : null;

    result[platform] = {
      // A command-specific failure must not be masked by a thread row merely
      // being touched during the same refresh window. That is how the inbox
      // ended up saying "all caught up" while LinkedIn returned
      // ACTION_NOT_SUPPORTED/capabilities_not_loaded.
      fresh: !failedAction && Boolean(latestThread?.updated_at || terminalAction),
      latest_thread_update: latestThread?.updated_at ?? null,
      terminal_action: terminalAction,
      failed_action: failedAction,
      failure_reason: failureReason,
    };
  }

  return result;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const organizationId = String(
    req.method === 'GET'
      ? req.query.organization_id ?? req.query.organizationId ?? ''
      : req.body?.organization_id ?? req.body?.organizationId ?? ''
  ).trim();

  if (!organizationId) {
    return res.status(400).json({ success: false, error: 'organization_id required' });
  }

  try {
    const access = await enforceCompanyAccess({ req, res, companyId: organizationId, requireCampaignId: false });
    if (!access) return;

    if (req.method === 'POST') {
      const requestedAt = new Date().toISOString();
      const platforms = parsePlatforms(req.body?.platforms).filter((platform) => SYNC_COMMAND_PLATFORMS.has(platform));
      const unsupported = parsePlatforms(req.body?.platforms).filter((platform) => !SYNC_COMMAND_PLATFORMS.has(platform));
      const commands: SyncCommandRow[] = [];

      for (const platform of platforms) {
        commands.push(await enqueuePlatformSync(organizationId, platform, requestedAt));
      }

      return res.status(200).json({
        success: true,
        data: {
          requested_at: requestedAt,
          commands,
          unsupported_platforms: unsupported,
        },
      });
    }

    if (req.method === 'GET') {
      const platforms = parsePlatforms(req.query.platforms).filter((platform) => SYNC_COMMAND_PLATFORMS.has(platform));
      const actionIds = parseActionIds(req.query.action_ids);
      const since = parseSince(req.query.since);
      const status = await loadFreshness(organizationId, platforms, since, actionIds);
      return res.status(200).json({ success: true, data: { since, platforms: status } });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('[engagement/platform-sync]', error);
    return res.status(500).json({ success: false, error: (error as Error)?.message || 'platform sync failed' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
})(handler);


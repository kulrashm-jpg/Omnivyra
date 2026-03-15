/**
 * Engagement Work Queue Service
 * Daily work queue: actionable threads per platform.
 * Actionable = ignored=false, latest message from external, no org reply after.
 */

import { supabase } from '../db/supabaseClient';

const PLATFORMS = ['linkedin', 'twitter', 'instagram', 'facebook', 'youtube', 'reddit'];

export type PlatformWorkItem = {
  platform: string;
  actionable_threads: number;
  high_priority_threads: number;
  unread_messages: number;
};

export type DailyWorkQueue = {
  platforms: PlatformWorkItem[];
  total_actionable_threads: number;
};

/**
 * Get org author IDs (platform_user_id from social_accounts linked to company users).
 * Returns Set of engagement_author IDs that belong to the org.
 */
async function getOrgAuthorIds(organizationId: string): Promise<Set<string>> {
  const { data: roleUsers } = await supabase
    .from('user_company_roles')
    .select('user_id')
    .eq('company_id', organizationId)
    .eq('status', 'active');

  const userIds = (roleUsers ?? []).map((r: { user_id: string }) => r.user_id);
  if (userIds.length === 0) return new Set();

  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('platform, platform_user_id')
    .in('user_id', userIds)
    .eq('is_active', true);

  if (!accounts?.length) return new Set();

  const platformUserPairs = new Set(
    (accounts as { platform: string; platform_user_id: string }[]).map(
      (a) => `${(a.platform || '').toLowerCase()}:${a.platform_user_id || ''}`
    )
  );

  const { data: authors } = await supabase
    .from('engagement_authors')
    .select('id, platform, platform_user_id')
    .in(
      'platform',
      Array.from(new Set((accounts as { platform: string }[]).map((a) => (a.platform || '').toLowerCase())))
    );

  const orgAuthorIds = new Set<string>();
  (authors ?? []).forEach((a: { id: string; platform: string; platform_user_id: string }) => {
    const key = `${(a.platform || '').toLowerCase()}:${a.platform_user_id || ''}`;
    if (platformUserPairs.has(key)) orgAuthorIds.add(a.id);
  });
  return orgAuthorIds;
}

/**
 * Thread is actionable if: ignored=false, latest message from external, no org reply after.
 */
export async function getDailyWorkQueue(organizationId: string): Promise<DailyWorkQueue> {
  if (!organizationId) {
    return { platforms: [], total_actionable_threads: 0 };
  }

  const orgAuthorIds = await getOrgAuthorIds(organizationId);

  const { data: threads, error: threadErr } = await supabase
    .from('engagement_threads')
    .select('id, platform, priority_score, unread_count')
    .eq('organization_id', organizationId)
    .eq('ignored', false);

  if (threadErr || !threads?.length) {
    const result: PlatformWorkItem[] = PLATFORMS.map((p) => ({
      platform: p,
      actionable_threads: 0,
      high_priority_threads: 0,
      unread_messages: 0,
    }));
    return { platforms: result, total_actionable_threads: 0 };
  }

  const threadIds = threads.map((t: { id: string }) => t.id);

  const { data: classifications } = await supabase
    .from('engagement_thread_classification')
    .select('thread_id, triage_priority')
    .in('thread_id', threadIds)
    .eq('organization_id', organizationId);
  const triageByThread = new Map<string, number>();
  (classifications ?? []).forEach((c: { thread_id: string; triage_priority?: number }) => {
    triageByThread.set(c.thread_id, Number(c.triage_priority ?? 0));
  });

  const { data: messages } = await supabase
    .from('engagement_messages')
    .select('id, thread_id, author_id, platform_created_at')
    .in('thread_id', threadIds)
    .order('platform_created_at', { ascending: false });

  const latestByThread = new Map<string, { author_id: string | null }>();
  for (const m of messages ?? []) {
    const msg = m as { thread_id: string; author_id: string | null };
    if (!latestByThread.has(msg.thread_id)) {
      latestByThread.set(msg.thread_id, { author_id: msg.author_id });
    }
  }

  const actionableByPlatform = new Map<string, { actionable: number; highPri: number; unread: number }>();
  for (const p of PLATFORMS) {
    actionableByPlatform.set(p, { actionable: 0, highPri: 0, unread: 0 });
  }

  let totalActionable = 0;

  for (const t of threads) {
    const th = t as { id: string; platform: string; priority_score?: number; unread_count?: number };
    const platform = (th.platform || '').toLowerCase();
    if (!actionableByPlatform.has(platform)) actionableByPlatform.set(platform, { actionable: 0, highPri: 0, unread: 0 });

    const latest = latestByThread.get(th.id);
    const latestAuthorExternal = !latest?.author_id || !orgAuthorIds.has(latest.author_id);
    const unread = Number(th.unread_count ?? 0) || 0;
    const actionable = latestAuthorExternal || unread > 0;
    const score = Number(th.priority_score ?? 0) ?? 0;
    const triagePri = triageByThread.get(th.id) ?? 0;
    const highPri = triagePri >= 7 || score >= 50;

    const cur = actionableByPlatform.get(platform)!;
    cur.unread += unread;
    if (highPri) cur.highPri += 1;
    if (actionable) {
      cur.actionable += 1;
      totalActionable += 1;
    }
  }

  const platforms: PlatformWorkItem[] = PLATFORMS.map((p) => {
    const c = actionableByPlatform.get(p) ?? { actionable: 0, highPri: 0, unread: 0 };
    return {
      platform: p,
      actionable_threads: c.actionable,
      high_priority_threads: c.highPri,
      unread_messages: c.unread,
    };
  });

  return {
    platforms,
    total_actionable_threads: totalActionable,
  };
}

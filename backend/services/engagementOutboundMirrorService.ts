import { supabase } from '../db/supabaseClient';

type ThreadCandidate = {
  id: string;
  platform_thread_id: string | null;
  raw_payload: Record<string, unknown> | null;
  updated_at?: string | null;
};

function normalizeIso(value: string | null | undefined): string {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function normalizeTarget(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
}

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function threadTargetValues(thread: ThreadCandidate): string[] {
  const rawPayload = thread.raw_payload && typeof thread.raw_payload === 'object'
    ? thread.raw_payload
    : {};
  const candidates = [
    thread.platform_thread_id,
    rawPayload.participant_profile_url,
    rawPayload.participant_username,
    rawPayload.participant_name,
    rawPayload.sender_profile_url,
    rawPayload.sender_name,
  ];
  return Array.from(
    new Set(
      candidates
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
    )
  );
}

function isLinkedInVisibleThread(platformThreadId: string | null | undefined): boolean {
  return /^li_visible_thread:/i.test(platformThreadId ?? '');
}

function pickBestThread(candidates: ThreadCandidate[], targetId: string): ThreadCandidate | null {
  if (candidates.length === 0) return null;
  const target = normalizeTarget(targetId);
  const exact = candidates.find((candidate) => normalizeTarget(candidate.platform_thread_id) === target);
  if (exact) return exact;

  const stable = candidates.find((candidate) => !isLinkedInVisibleThread(candidate.platform_thread_id));
  if (stable) return stable;

  return [...candidates].sort((a, b) =>
    String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''))
  )[0] ?? null;
}

async function loadThreadsByFilter(input: {
  organizationId: string;
  platform: string;
  column: string;
  value: string;
}): Promise<ThreadCandidate[]> {
  const { data, error } = await supabase
    .from('engagement_threads')
    .select('id, platform_thread_id, raw_payload, updated_at')
    .eq('organization_id', input.organizationId)
    .eq('platform', input.platform)
    .eq(input.column, input.value)
    .limit(20);

  if (error) {
    console.warn('[engagement/outbound-mirror] thread lookup failed:', error.message);
    return [];
  }
  return (data ?? []) as ThreadCandidate[];
}

async function findThreadForOutboundDm(input: {
  organizationId: string;
  platform: string;
  targetId: string;
}): Promise<ThreadCandidate | null> {
  const target = normalizeTarget(input.targetId);
  if (!target) return null;

  const targetVariants = Array.from(new Set([input.targetId.trim(), target]));
  const candidatesById = new Map<string, ThreadCandidate>();
  const addCandidates = (rows: ThreadCandidate[]) => {
    for (const row of rows) candidatesById.set(row.id, row);
  };

  for (const value of targetVariants) {
    addCandidates(await loadThreadsByFilter({
      organizationId: input.organizationId,
      platform: input.platform,
      column: 'platform_thread_id',
      value,
    }));
    addCandidates(await loadThreadsByFilter({
      organizationId: input.organizationId,
      platform: input.platform,
      column: 'raw_payload->>participant_profile_url',
      value,
    }));
    addCandidates(await loadThreadsByFilter({
      organizationId: input.organizationId,
      platform: input.platform,
      column: 'raw_payload->>participant_username',
      value,
    }));
    addCandidates(await loadThreadsByFilter({
      organizationId: input.organizationId,
      platform: input.platform,
      column: 'raw_payload->>participant_name',
      value,
    }));
  }

  return pickBestThread(Array.from(candidatesById.values()), target);
}

type MirrorResult = {
  mirrored: boolean;
  thread_id?: string;
  message_id?: string;
  sent_at?: string;
  error?: string;
};

async function writeOutboundDmToThread(input: {
  thread: ThreadCandidate;
  organizationId: string;
  platform: string;
  platformMessageId: string;
  text: string;
  sentAt?: string | null;
  rawPayload: Record<string, unknown>;
}): Promise<MirrorResult> {
  const sentAt = normalizeIso(input.sentAt);
  const rawPayload = input.thread.raw_payload && typeof input.thread.raw_payload === 'object'
    ? input.thread.raw_payload
    : {};

  const messageRow = {
    thread_id: input.thread.id,
    source_id: null,
    platform: input.platform,
    platform_message_id: input.platformMessageId,
    message_type: 'direct_message',
    content: input.text,
    direction: 'outgoing',
    author_id: null,
    parent_message_id: null,
    platform_created_at: sentAt,
    normalized_time: sentAt,
    raw_time: sentAt,
    raw_payload: {
      author_self: true,
      sender_self: true,
      sender_name: 'You',
      ...input.rawPayload,
    },
  };

  const { error: upsertError } = await supabase
    .from('engagement_messages')
    .upsert(messageRow, { onConflict: 'thread_id,platform_message_id' });
  if (upsertError) {
    return { mirrored: false, thread_id: input.thread.id, error: upsertError.message };
  }

  const nextRawPayload = {
    ...rawPayload,
    last_message_preview: `You: ${previewText(input.text)}`,
    last_message_at: sentAt,
    last_message_self: true,
    unread_count: 0,
  };
  const { error: threadError } = await supabase
    .from('engagement_threads')
    .update({
      raw_payload: nextRawPayload,
      unread_count: 0,
      updated_at: sentAt,
    })
    .eq('id', input.thread.id);

  if (threadError) {
    return {
      mirrored: true,
      thread_id: input.thread.id,
      message_id: input.platformMessageId,
      sent_at: sentAt,
      error: threadError.message,
    };
  }

  const staleTargets = threadTargetValues(input.thread);
  if (staleTargets.length > 0) {
    const { error: supersedeError } = await supabase
      .from('community_ai_actions')
      .update({
        status: 'failed',
        execution_result: {
          source: 'engagement_direct_browser_send',
          reason: 'superseded_by_confirmed_outbound_dm',
          thread_id: input.thread.id,
          platform_message_id: input.platformMessageId,
        },
        dispatch_lease_id: null,
        dispatch_lease_holder_id: null,
        dispatch_lease_expires_at: null,
        dispatch_acknowledged_at: null,
        updated_at: sentAt,
      })
      .eq('organization_id', input.organizationId)
      .eq('platform', input.platform)
      .eq('action_type', 'dm')
      .eq('status', 'pending')
      .in('target_id', staleTargets);
    if (supersedeError) {
      console.warn('[engagement/outbound-mirror] pending DM supersede failed:', supersedeError.message);
    }
  }

  return {
    mirrored: true,
    thread_id: input.thread.id,
    message_id: input.platformMessageId,
    sent_at: sentAt,
  };
}

export async function mirrorOutboundDmAction(input: {
  organizationId: string;
  actionId: string;
  platform: string | null | undefined;
  targetId: string | null | undefined;
  text: string | null | undefined;
  sentAt?: string | null;
  platformId?: string | null;
  confirmed?: boolean;
}): Promise<MirrorResult> {
  const platform = (input.platform ?? '').trim().toLowerCase();
  const targetId = (input.targetId ?? '').trim();
  const text = (input.text ?? '').trim();
  if (!input.organizationId || !platform || !targetId || !text) {
    return { mirrored: false };
  }

  const thread = await findThreadForOutboundDm({
    organizationId: input.organizationId,
    platform,
    targetId,
  });
  if (!thread) {
    return { mirrored: false, error: 'THREAD_NOT_FOUND' };
  }

  const platformMessageId = (input.platformId ?? '').trim() || `local:dm:${input.actionId}`;
  return writeOutboundDmToThread({
    thread,
    organizationId: input.organizationId,
    platform,
    platformMessageId,
    text,
    sentAt: input.sentAt,
    rawPayload: {
      ingested_via: 'self_dm_action_result',
      action_id: input.actionId,
      target_id: targetId,
      confirmed: input.confirmed === true,
      platform_id: input.platformId ?? null,
    },
  });
}

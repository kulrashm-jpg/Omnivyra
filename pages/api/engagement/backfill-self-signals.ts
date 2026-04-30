/**
 * POST /api/engagement/backfill-self-signals
 *
 * Identity-anchored backfill. Treats the caller's LinkedIn profile URL
 * (passed in body OR already stored on social_accounts) as the canonical
 * "self" identifier and re-classifies every existing message in the
 * organization's threads against it.
 *
 * Behaviour:
 *   1. If `self_profile_url` (or `self_profile_slug`) is provided in the
 *      request body, persist it on social_accounts for (org's user, linkedin)
 *      so all future logic — inbox.ts, getOrgAuthorIds, engagement_authors
 *      matching — has a stable anchor.
 *
 *   2. For every engagement_message in the org's threads, check if the
 *      sender matches the stored self profile URL via:
 *        raw_payload.sender_profile_url (canonical, set by new scraper)
 *        raw_payload.sender_username    (slug, set by new scraper)
 *      If yes → flip direction='outgoing' and stamp author_self=true on
 *      raw_payload. Display-name comparison is intentionally NOT used
 *      because two LinkedIn members can share a display name.
 *
 *   3. For each thread, recompute the latest message (NULL-safe ordering)
 *      and stamp engagement_threads.raw_payload.last_message_self based
 *      on the corrected message rows.
 *
 * Note on legacy rows that have neither sender_profile_url nor
 * sender_username in raw_payload: there is no reliable identity anchor
 * for them, so they are left untouched. They become correctly classified
 * once the new scraper re-syncs that thread (the upsert key is
 * (thread_id, platform_message_id) so existing rows update in place).
 *
 * Tenant-scoped. Idempotent. `force: true` re-stamps thread-level
 * last_message_self even when previously written.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';

function normalizeLinkedInProfileUrl(input: string | null | undefined): { url: string; slug: string } | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  const slugMatch = trimmed.match(/\/in\/([^/?#]+)/i);
  if (slugMatch && slugMatch[1]) {
    const slug = slugMatch[1].toLowerCase();
    return {
      url: `https://www.linkedin.com/in/${slug}/`,
      slug,
    };
  }
  // Bare slug (no URL parts).
  if (/^[a-z0-9-]{2,100}$/i.test(trimmed)) {
    const slug = trimmed.toLowerCase();
    return {
      url: `https://www.linkedin.com/in/${slug}/`,
      slug,
    };
  }
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body ?? {}) as {
    organization_id?: string;
    force?: boolean;
    self_profile_url?: string;
    self_profile_slug?: string;
  };
  const organizationId = (body.organization_id ?? '').trim();
  const force = body.force === true;
  if (!organizationId) return res.status(400).json({ error: 'organization_id required' });

  const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
  if (!access) return;

  // ── Identity resolution ─────────────────────────────────────────────────
  // Stable per-person LinkedIn identity. Display name is intentionally NOT
  // accepted because it collides when two real people share a name (the
  // exact bug this backfill was added to fix). We only accept a profile
  // URL or slug; everything downstream keys off the canonical
  // https://www.linkedin.com/in/<slug>/ form.
  const provided = normalizeLinkedInProfileUrl(body.self_profile_url ?? body.self_profile_slug ?? null);

  // Resolve the caller's user_id so we can read/write the matching
  // social_accounts row. resolveUserContext is the same identity source
  // /api/engagement/inbox uses, so behaviour is consistent.
  const userCtx = await resolveUserContext(req);
  const callerUserId = userCtx?.userId ?? null;

  // If the caller passed a profile URL, persist it on social_accounts so
  // every future call (inbox, scraper sync, etc.) reads the same anchor.
  if (provided && callerUserId) {
    const { data: existingAccount } = await supabase
      .from('social_accounts')
      .select('id, platform_user_id')
      .eq('user_id', callerUserId)
      .eq('platform', 'linkedin')
      .maybeSingle();
    if (existingAccount?.id) {
      // Only update if the stored value differs — keeps updated_at noise low.
      if ((existingAccount as { platform_user_id: string }).platform_user_id !== provided.url) {
        await supabase
          .from('social_accounts')
          .update({ platform_user_id: provided.url, is_active: true })
          .eq('id', (existingAccount as { id: string }).id);
      }
    } else {
      await supabase.from('social_accounts').insert({
        user_id: callerUserId,
        platform: 'linkedin',
        platform_user_id: provided.url,
        is_active: true,
      });
    }
  }

  // Determine the self profile (URL + slug). Prefer the just-provided value,
  // fall back to whatever's already on social_accounts.
  let selfUrl: string | null = provided?.url ?? null;
  let selfSlug: string | null = provided?.slug ?? null;
  if (!selfUrl && callerUserId) {
    const { data: storedAccount } = await supabase
      .from('social_accounts')
      .select('platform_user_id')
      .eq('user_id', callerUserId)
      .eq('platform', 'linkedin')
      .maybeSingle();
    const storedNorm = normalizeLinkedInProfileUrl((storedAccount as { platform_user_id?: string } | null)?.platform_user_id ?? null);
    selfUrl = storedNorm?.url ?? null;
    selfSlug = storedNorm?.slug ?? null;
  }

  // ── Identity-driven message reclassification ───────────────────────────
  // For every message in the org's threads, if the sender's profile URL
  // or username (slug) matches selfUrl/selfSlug, mark it outgoing+self.
  // Without an identity anchor we can't safely re-classify any rows, so
  // return early and tell the caller to provide one.
  if (!selfUrl) {
    return res.status(400).json({
      error: 'NO_SELF_IDENTITY',
      message: 'No LinkedIn profile URL on social_accounts for this user. Provide self_profile_url in the body, e.g. "https://www.linkedin.com/in/<your-slug>/".',
    });
  }

  // Pull every DM thread for the org.
  const { data: threadRows, error: threadErr } = await supabase
    .from('engagement_threads')
    .select('id, raw_payload')
    .eq('organization_id', organizationId);
  if (threadErr) {
    console.error('[backfill-self-signals] thread fetch failed:', threadErr.message);
    return res.status(500).json({ error: threadErr.message });
  }

  const threads = (threadRows ?? []) as Array<{ id: string; raw_payload: Record<string, unknown> | null }>;
  const threadIds = threads.map((t) => t.id);
  if (threadIds.length === 0) {
    return res.status(200).json({
      self_profile_url: selfUrl,
      threads_seen: 0,
      messages_reclassified: 0,
      threads_updated: 0,
      message: 'No threads in organization',
    });
  }

  // Pull all messages for the org's threads in chunks; identity match in
  // JS. (PostgREST .or() over jsonb -> text with URLs has URL-escaping
  // pitfalls — easier and just as fast to do the match here.)
  let messagesReclassified = 0;
  const CHUNK = 200;
  for (let i = 0; i < threadIds.length; i += CHUNK) {
    const ids = threadIds.slice(i, i + CHUNK);
    const { data: msgRows, error: msgFetchErr } = await supabase
      .from('engagement_messages')
      .select('id, thread_id, direction, raw_payload')
      .in('thread_id', ids);
    if (msgFetchErr) {
      console.error('[backfill-self-signals] message fetch failed:', msgFetchErr.message);
      return res.status(500).json({ error: msgFetchErr.message });
    }
    for (const row of (msgRows ?? []) as Array<{
      id: string;
      thread_id: string;
      direction: string | null;
      raw_payload: Record<string, unknown> | null;
    }>) {
      const rp = row.raw_payload ?? {};
      const senderProfileUrl = typeof rp.sender_profile_url === 'string' ? rp.sender_profile_url : null;
      const senderUsername = typeof rp.sender_username === 'string' ? rp.sender_username : null;
      const matchUrl = senderProfileUrl !== null && senderProfileUrl === selfUrl;
      const matchSlug = senderUsername !== null && senderUsername.toLowerCase() === selfSlug;
      if (!matchUrl && !matchSlug) continue;

      const alreadyOutgoing = row.direction === 'outgoing' && rp.author_self === true && rp.sender_self === true;
      if (alreadyOutgoing && !force) continue;

      const newPayload = { ...rp, author_self: true, sender_self: true, identity_corrected_at: new Date().toISOString() };
      const { error: updErr } = await supabase
        .from('engagement_messages')
        .update({ direction: 'outgoing', raw_payload: newPayload })
        .eq('id', row.id);
      if (updErr) {
        console.warn('[backfill-self-signals] message reclassify failed', row.id, updErr.message);
        continue;
      }
      messagesReclassified += 1;
    }
  }

  // ── Recompute thread-level last_message_self ───────────────────────────
  const threadsNeedingBackfill = force
    ? threads
    : threads.filter((t) => {
        const rp = t.raw_payload ?? {};
        return rp.last_message_self === undefined || rp.last_message_self === null;
      });

  if (threadsNeedingBackfill.length === 0) {
    return res.status(200).json({
      threads_seen: threads.length,
      threads_updated: 0,
      message: 'All threads already have last_message_self stamped',
    });
  }

  // Pull the latest message per thread we need to backfill. Supabase has
  // no DISTINCT ON, so we fetch in chunks and pick the freshest per thread
  // in JS. Reuses the CHUNK constant declared above.
  const latestByThread = new Map<string, {
    direction: string | null;
    content: string | null;
    raw_payload: Record<string, unknown> | null;
    platform_created_at: string | null;
  }>();
  for (let i = 0; i < threadsNeedingBackfill.length; i += CHUNK) {
    const ids = threadsNeedingBackfill.slice(i, i + CHUNK).map((t) => t.id);
    const { data: msgRows, error: msgErr } = await supabase
      .from('engagement_messages')
      .select('thread_id, direction, content, raw_payload, platform_created_at, created_at')
      .in('thread_id', ids)
      // platform_created_at DESC NULLS LAST, fall back to created_at DESC
      // for rows where the scraper never stamped a platform timestamp.
      // Without nullsFirst:false, NULL-platform rows surface as the
      // "latest" and the self-signal inference picks the wrong message.
      .order('platform_created_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false, nullsFirst: false });
    if (msgErr) {
      console.error('[backfill-self-signals] message fetch failed:', msgErr.message);
      return res.status(500).json({ error: msgErr.message });
    }
    for (const m of (msgRows ?? []) as Array<{
      thread_id: string;
      direction: string | null;
      content: string | null;
      raw_payload: Record<string, unknown> | null;
      platform_created_at: string | null;
    }>) {
      // First seen wins — query is ordered DESC, so first row per
      // thread_id is the latest.
      if (!latestByThread.has(m.thread_id)) {
        latestByThread.set(m.thread_id, {
          direction: m.direction,
          content: m.content,
          raw_payload: m.raw_payload,
          platform_created_at: m.platform_created_at,
        });
      }
    }
  }

  // Decide self-status per thread, then stamp raw_payload.last_message_self.
  // Same rule the scraper uses on fresh data: direction OR sender_self OR
  // author_self OR "You:" content prefix.
  let updated = 0;
  let inferredSelf = 0;
  let inferredOther = 0;
  let noLatestMessage = 0;

  for (const t of threadsNeedingBackfill) {
    const latest = latestByThread.get(t.id);
    if (!latest) {
      noLatestMessage += 1;
      continue;
    }
    const rp = latest.raw_payload ?? {};
    const isSelf =
      latest.direction === 'outgoing'
      || rp.sender_self === true
      || rp.author_self === true
      || /^you\s*:/i.test((latest.content ?? '').trim());

    const newRawPayload = { ...(t.raw_payload ?? {}), last_message_self: isSelf };
    const { error: updErr } = await supabase
      .from('engagement_threads')
      .update({ raw_payload: newRawPayload })
      .eq('id', t.id);
    if (updErr) {
      console.warn('[backfill-self-signals] thread update failed', t.id, updErr.message);
      continue;
    }
    updated += 1;
    if (isSelf) inferredSelf += 1;
    else inferredOther += 1;
  }

  // Diagnostic: count engagement_authors and how many DM messages have
  // author_id set so the caller can tell whether re-scraping is still
  // needed for collision-free same-name dedup.
  const { count: authorCount } = await supabase
    .from('engagement_authors')
    .select('id', { count: 'exact', head: true })
    .eq('platform', 'linkedin');
  const { count: dmMessages } = await supabase
    .from('engagement_messages')
    .select('id', { count: 'exact', head: true })
    .eq('platform', 'linkedin')
    .eq('message_type', 'direct_message')
    .in('thread_id', threadIds);
  const { count: dmMessagesWithAuthor } = await supabase
    .from('engagement_messages')
    .select('id', { count: 'exact', head: true })
    .eq('platform', 'linkedin')
    .eq('message_type', 'direct_message')
    .not('author_id', 'is', null)
    .in('thread_id', threadIds);

  return res.status(200).json({
    self_profile_url: selfUrl,
    self_profile_slug: selfSlug,
    messages_reclassified: messagesReclassified,
    threads_seen: threads.length,
    threads_already_stamped: threads.length - threadsNeedingBackfill.length,
    threads_updated: updated,
    threads_skipped_no_messages: noLatestMessage,
    inferred_self_count: inferredSelf,
    inferred_other_count: inferredOther,
    diagnostic: {
      linkedin_authors: authorCount ?? 0,
      linkedin_dm_messages: dmMessages ?? 0,
      linkedin_dm_messages_with_author_id: dmMessagesWithAuthor ?? 0,
      reScrapeRecommended: (authorCount ?? 0) === 0 || (dmMessagesWithAuthor ?? 0) < (dmMessages ?? 0),
    },
  });
}

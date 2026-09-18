import { supabase } from '../db/supabaseClient';
import { encryptTokenColumns, setToken, type TokenObject } from '../auth/tokenStore';
import { ownedDbTable } from '../db/writeOwner';

type MetaInstagramAccount = {
  id: string;
  username?: string | null;
  name?: string | null;
  profile_picture_url?: string | null;
};

type MetaThreadsAccount = {
  id: string;
};

type MetaPage = {
  id: string;
  name?: string | null;
  access_token?: string | null;
  instagram_business_account?: MetaInstagramAccount | null;
};

type DerivedAccountInput = {
  userId: string;
  companyId: string | null;
  pageId: string | null;
  pageName: string | null;
  pageAccessToken: string;
  expiresAt: string;
  permissions: string[];
  instagram: MetaInstagramAccount;
};

type UpsertDerivedAccountsInput = {
  userId: string;
  companyId?: string | null;
  accessToken: string;
  expiresAt: string;
  permissions?: string[];
};

function missingColumn(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? '');
  return /column .* does not exist|Could not find .* column|schema cache/i.test(message);
}

async function fetchThreadsAccount(
  instagramUserId: string,
  accessToken: string,
): Promise<MetaThreadsAccount | null> {
  const params = new URLSearchParams({
    fields: 'threads_account',
    access_token: accessToken,
  });
  const response = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(instagramUserId)}?${params}`);
  const body = await response.json().catch(() => null);
  // SEC91-B6: shape-only — the raw Graph body (account ids, profile fields, echoed
  // request details on error) is not logged.
  console.log('THREADS_ACCOUNT_RESPONSE', {
    ok: response.ok,
    status: response.status,
    has_threads_account: Boolean(body && body.threads_account),
    error_type: body?.error?.type ?? null,
  });

  if (!response.ok) {
    throw new Error(body?.error?.message ?? 'THREADS_FETCH_FAILED');
  }

  if (!body || body.threads_account === undefined) {
    throw new Error('THREADS_FETCH_FAILED');
  }

  if (body.threads_account === null) {
    return null;
  }

  const threadsId = body.threads_account?.id;
  if (typeof threadsId !== 'string' || !threadsId.trim()) {
    throw new Error('THREADS_FETCH_FAILED');
  }

  return typeof threadsId === 'string' && threadsId.trim()
    ? { id: threadsId.trim() }
    : null;
}

async function deactivateLegacyThreadsRows(input: {
  userId: string;
  companyId: string | null;
  instagramUserId: string;
}) {
  const payload = {
    is_active: false,
    status: 'disconnected',
    access_token: null,
    refresh_token: null,
    updated_at: new Date().toISOString(),
  };
  let query = ownedDbTable('social_accounts')
    .update(payload)
    .eq('user_id', input.userId)
    .eq('platform', 'threads')
    .eq('platform_user_id', input.instagramUserId);
  query = input.companyId ? query.eq('company_id', input.companyId) : query.is('company_id', null);

  const { error } = await query;
  if (error && missingColumn(error)) {
    let fallback = ownedDbTable('social_accounts')
      .update({
        is_active: false,
        access_token: null,
        refresh_token: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', input.userId)
      .eq('platform', 'threads')
      .eq('platform_user_id', input.instagramUserId);
    fallback = input.companyId ? fallback.eq('company_id', input.companyId) : fallback.is('company_id', null);
    const { error: fallbackError } = await fallback;
    if (fallbackError) throw fallbackError;
  } else if (error) {
    throw error;
  }
}

async function upsertSocialAccount(input: {
  userId: string;
  companyId: string | null;
  platform: 'instagram' | 'threads';
  platformUserId: string;
  accountName: string;
  username: string | null;
  token: TokenObject;
  status?: string;
  extraColumns: Record<string, unknown>;
  fallbackMetrics: Record<string, unknown>;
}) {
  // Strict find by platform_user_id.
  const baseQuery = ownedDbTable('social_accounts')
    .select('id')
    .eq('user_id', input.userId)
    .eq('platform', input.platform)
    .eq('platform_user_id', input.platformUserId);

  if (input.companyId) baseQuery.eq('company_id', input.companyId);
  else baseQuery.is('company_id', null);

  let existing: { id: string } | null = null;
  {
    const { data } = await baseQuery.maybeSingle();
    existing = data ? { id: data.id } : null;
  }

  // Relaxed fallback when strict miss: re-use the existing (user, company,
  // platform) row regardless of platform_user_id drift. Meta sometimes
  // returns a different Instagram Business id across reconnects (Page
  // re-binding, business-portfolio change, IG account re-link), and we
  // want one canonical IG row per tenant — not two stale rows where the
  // older one is permanently is_active=false and shows "Not connected".
  if (!existing) {
    const relaxedQ = ownedDbTable('social_accounts')
      .select('id')
      .eq('user_id', input.userId)
      .eq('platform', input.platform)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (input.companyId) relaxedQ.eq('company_id', input.companyId);
    else relaxedQ.is('company_id', null);
    const { data: relaxed } = await relaxedQ.maybeSingle();
    if (relaxed?.id) existing = { id: relaxed.id };
  }
  const encrypted = encryptTokenColumns(input.token);
  const common = {
    user_id: input.userId,
    company_id: input.companyId,
    platform: input.platform,
    platform_user_id: input.platformUserId,
    account_name: input.accountName,
    username: input.username,
    is_active: true,
    // `permissions` removed — column not on social_accounts (schema drift).
    token_expires_at: input.token.expires_at ?? null,
    last_sync_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    access_token: encrypted.access_token,
    refresh_token: encrypted.refresh_token,
  };

  const withExtra = {
    ...common,
    status: input.status ?? 'connected',
    ...input.extraColumns,
    account_metrics: {
      ...input.fallbackMetrics,
      ...(input.extraColumns.account_metrics as Record<string, unknown> | undefined),
    },
  };

  let accountId = existing?.id as string | undefined;

  if (accountId) {
    const { error } = await ownedDbTable('social_accounts')
      .update(withExtra)
      .eq('id', accountId);

    if (error && missingColumn(error)) {
      const { error: fallbackError } = await ownedDbTable('social_accounts')
        .update({
          ...common,
          account_metrics: input.fallbackMetrics,
        })
        .eq('id', accountId);
      if (fallbackError) throw fallbackError;
    } else if (error) {
      throw error;
    }
  } else {
    const { data, error } = await ownedDbTable('social_accounts')
      .insert({ ...withExtra, created_at: new Date().toISOString() })
      .select('id')
      .single();

    if (error && missingColumn(error)) {
      const { data: fallbackData, error: fallbackError } = await ownedDbTable('social_accounts')
        .insert({
          ...common,
          account_metrics: input.fallbackMetrics,
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (fallbackError) throw fallbackError;
      accountId = fallbackData?.id;
    } else if (error) {
      throw error;
    } else {
      accountId = data?.id;
    }
  }

  if (accountId) await setToken(accountId, input.token);
  return accountId ?? null;
}

async function upsertInstagramAndThreads(input: DerivedAccountInput): Promise<{
  instagramId: string;
  threadsId: string | null;
}> {
  const accountName = input.instagram.username
    ? `@${input.instagram.username}`
    : input.instagram.name || 'Instagram Account';
  const token: TokenObject = {
    access_token: input.pageAccessToken,
    expires_at: input.expiresAt,
    token_type: 'Bearer',
    scope: input.permissions.join(','),
  };
  const meta = {
    provider: 'instagram',
    auth_source: 'meta',
    facebook_page_id: input.pageId,
    facebook_page_name: input.pageName,
    instagram_id: input.instagram.id,
  };

  await upsertSocialAccount({
    userId: input.userId,
    companyId: input.companyId,
    platform: 'instagram',
    platformUserId: input.instagram.id,
    accountName,
    username: input.instagram.username ?? null,
    token,
    extraColumns: {
      provider: 'instagram',
      auth_source: 'meta',
      instagram_id: input.instagram.id,
    },
    fallbackMetrics: meta,
  });

  const threadsAccount = await fetchThreadsAccount(input.instagram.id, input.pageAccessToken);
  if (!threadsAccount?.id) {
    return { instagramId: input.instagram.id, threadsId: null };
  }

  await deactivateLegacyThreadsRows({
    userId: input.userId,
    companyId: input.companyId,
    instagramUserId: input.instagram.id,
  });

  const threadsRowId = await upsertSocialAccount({
    userId: input.userId,
    companyId: input.companyId,
    platform: 'threads',
    platformUserId: threadsAccount.id,
    accountName: `Threads via ${accountName}`,
    username: input.instagram.username ?? null,
    token,
    status: 'active',
    extraColumns: {
      provider: 'threads',
      auth_source: 'meta_instagram',
      instagram_id: input.instagram.id,
      threads_user_id: threadsAccount.id,
    },
    fallbackMetrics: {
      ...meta,
      provider: 'threads',
      auth_source: 'meta_instagram',
      derived_from: 'instagram',
      threads_user_id: threadsAccount.id,
    },
  });

  let verificationQuery = ownedDbTable('social_accounts')
    .select('*')
    .eq('platform', 'threads')
    .eq('platform_user_id', threadsAccount.id)
    .eq('user_id', input.userId);
  verificationQuery = input.companyId ? verificationQuery.eq('company_id', input.companyId) : verificationQuery.is('company_id', null);
  const { data: verifiedThreadsRow, error: verifyError } = await verificationQuery.maybeSingle();
  if (verifyError || !verifiedThreadsRow || (threadsRowId && verifiedThreadsRow.id !== threadsRowId)) {
    throw new Error('THREADS_INSERT_VERIFY_FAILED');
  }

  return { instagramId: input.instagram.id, threadsId: threadsAccount.id };
}

export async function syncInstagramAndThreadsFromMeta(input: UpsertDerivedAccountsInput): Promise<{
  instagramAccounts: Array<{ id: string; username?: string | null; name?: string | null }>;
  threadsAccounts: Array<{ id: string; instagram_id: string }>;
}> {
  const params = new URLSearchParams({
    fields: 'id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}',
    access_token: input.accessToken,
  });
  const response = await fetch(`https://graph.facebook.com/v22.0/me/accounts?${params}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? `Failed to fetch Meta pages (${response.status})`);
  }

  const body = await response.json().catch(() => ({}));
  const pages = Array.isArray(body?.data) ? (body.data as MetaPage[]) : [];
  const instagramAccounts = pages
    .map((page) => ({ page, instagram: page.instagram_business_account }))
    .filter((item): item is { page: MetaPage; instagram: MetaInstagramAccount } => Boolean(item.instagram?.id));

  const derivedAccounts = await Promise.all(
    instagramAccounts.map(async ({ page, instagram }) => {
      const result = await upsertInstagramAndThreads({
        userId: input.userId,
        companyId: input.companyId ?? null,
        pageId: page.id,
        pageName: page.name ?? null,
        pageAccessToken: page.access_token || input.accessToken,
        expiresAt: input.expiresAt,
        permissions: input.permissions ?? [],
        instagram,
      });
      return result.threadsId
        ? { id: result.threadsId, instagram_id: result.instagramId }
        : null;
    })
  );
  const threadsAccounts = derivedAccounts
    .filter((row): row is { id: string; instagram_id: string } => Boolean(row));

  return {
    instagramAccounts: instagramAccounts.map(({ instagram }) => ({
      id: instagram.id,
      username: instagram.username,
      name: instagram.name,
    })),
    threadsAccounts,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Facebook Page target resolution
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A Page this login can actually publish to: an id AND that Page's own token.
 * Both are required — a Page id without its Page token is not a publishable
 * target, it is just a number.
 */
export type FacebookPageCandidate = {
  id: string;
  name: string | null;
  accessToken: string;
};

export type FacebookPageTargetResolution =
  | { status: 'resolved'; page: FacebookPageCandidate; candidates: FacebookPageCandidate[] }
  | { status: 'no_pages'; candidates: FacebookPageCandidate[] }
  | { status: 'selection_required'; candidates: FacebookPageCandidate[] }
  | { status: 'lookup_failed'; reason: string; candidates: FacebookPageCandidate[] };

/**
 * Resolve the Facebook Page a connection should publish to.
 *
 * WHY
 * ---
 * The Facebook OAuth callback stores `profile.id` from `GET /me` — the Facebook
 * USER id — as `social_accounts.platform_user_id`, together with the USER
 * token. Graph only accepts feed publishing at a PAGE node using that Page's
 * own access token, so a connection that knows nothing but the user has no
 * publishable target at all.
 *
 * The Pages, and their per-Page tokens, come from the SAME call this module
 * already issues for the Instagram/Threads derivation —
 * `GET /v22.0/me/accounts?fields=id,name,access_token` (see
 * syncInstagramAndThreadsFromMeta above, and the identical shape in
 * backend/adapters/facebookAdapter.ts). No new endpoint, parameter or field is
 * introduced here.
 *
 * NEVER CONFLATE USER AND PAGE IDENTITY
 * -------------------------------------
 * `facebookUserId` is required and every candidate whose id equals it is
 * discarded. A user id can therefore never leave this function as a Page id,
 * whatever Graph returns.
 *
 * NO SILENT AUTO-PICK
 * -------------------
 * With more than one manageable Page and no Page already bound to the
 * connection, this returns `selection_required` and NOTHING is chosen.
 * Publishing to a destination nobody selected is the failure mode this exists
 * to prevent. `currentPageId` is honoured when it is still in the list — that
 * is re-binding a target the connection already had, not choosing a new one.
 */
export async function resolveFacebookPageTarget(input: {
  accessToken: string;
  facebookUserId: string;
  currentPageId?: string | null;
}): Promise<FacebookPageTargetResolution> {
  const facebookUserId = String(input.facebookUserId ?? '').trim();
  if (!facebookUserId) {
    // Without the user id the conflation guard below cannot run, and a guard
    // that silently does nothing is worse than no guard.
    return { status: 'lookup_failed', reason: 'facebook user id missing', candidates: [] };
  }

  const params = new URLSearchParams({
    fields: 'id,name,access_token',
    access_token: input.accessToken,
  });

  let body: unknown;
  try {
    const response = await fetch(`https://graph.facebook.com/v22.0/me/accounts?${params}`);
    const parsed = await response.json().catch(() => null);
    if (!response.ok) {
      const message = (parsed as { error?: { message?: string } } | null)?.error?.message;
      return {
        status: 'lookup_failed',
        reason: message ? String(message).slice(0, 200) : `me/accounts returned HTTP ${response.status}`,
        candidates: [],
      };
    }
    body = parsed;
  } catch (error) {
    return {
      status: 'lookup_failed',
      reason: String((error as { message?: string })?.message ?? error).slice(0, 200),
      candidates: [],
    };
  }

  const raw = Array.isArray((body as { data?: unknown } | null)?.data)
    ? ((body as { data: MetaPage[] }).data)
    : [];

  const seen = new Set<string>();
  const candidates: FacebookPageCandidate[] = [];
  for (const page of raw) {
    const id = String((page as MetaPage)?.id ?? '').trim();
    const token = typeof (page as MetaPage)?.access_token === 'string'
      ? String((page as MetaPage).access_token).trim()
      : '';
    // A Page with no Page token cannot be published to, and the Facebook USER
    // node is not a Page however Graph lists it.
    if (!id || !token || id === facebookUserId || seen.has(id)) continue;
    seen.add(id);
    candidates.push({
      id,
      name: typeof (page as MetaPage)?.name === 'string' ? String((page as MetaPage).name) : null,
      accessToken: token,
    });
  }

  if (candidates.length === 0) return { status: 'no_pages', candidates };

  const currentPageId = String(input.currentPageId ?? '').trim();
  if (currentPageId && currentPageId !== facebookUserId) {
    const bound = candidates.find((page) => page.id === currentPageId);
    // Re-bind the Page this connection is already pointed at, refreshing its
    // token. This is not a choice — the choice was made previously.
    if (bound) return { status: 'resolved', page: bound, candidates };
  }

  if (candidates.length === 1) return { status: 'resolved', page: candidates[0], candidates };

  return { status: 'selection_required', candidates };
}

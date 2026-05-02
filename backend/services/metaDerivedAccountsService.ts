import { supabase } from '../db/supabaseClient';
import { encryptTokenColumns, setToken, type TokenObject } from '../auth/tokenStore';

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
  console.log('THREADS_ACCOUNT_RESPONSE', body);

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
  let query = supabase
    .from('social_accounts')
    .update(payload)
    .eq('user_id', input.userId)
    .eq('platform', 'threads')
    .eq('platform_user_id', input.instagramUserId);
  query = input.companyId ? query.eq('company_id', input.companyId) : query.is('company_id', null);

  const { error } = await query;
  if (error && missingColumn(error)) {
    let fallback = supabase
      .from('social_accounts')
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
  const baseQuery = supabase
    .from('social_accounts')
    .select('id')
    .eq('user_id', input.userId)
    .eq('platform', input.platform)
    .eq('platform_user_id', input.platformUserId);

  if (input.companyId) baseQuery.eq('company_id', input.companyId);
  else baseQuery.is('company_id', null);

  const { data: existing } = await baseQuery.maybeSingle();
  const encrypted = encryptTokenColumns(input.token);
  const common = {
    user_id: input.userId,
    company_id: input.companyId,
    platform: input.platform,
    platform_user_id: input.platformUserId,
    account_name: input.accountName,
    username: input.username,
    is_active: true,
    permissions: input.token.scope?.split(',').filter(Boolean) ?? [],
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
    const { error } = await supabase
      .from('social_accounts')
      .update(withExtra)
      .eq('id', accountId);

    if (error && missingColumn(error)) {
      const { error: fallbackError } = await supabase
        .from('social_accounts')
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
    const { data, error } = await supabase
      .from('social_accounts')
      .insert({ ...withExtra, created_at: new Date().toISOString() })
      .select('id')
      .single();

    if (error && missingColumn(error)) {
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('social_accounts')
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

  let verificationQuery = supabase
    .from('social_accounts')
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

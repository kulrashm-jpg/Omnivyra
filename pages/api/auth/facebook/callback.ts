// AUTH EXEMPT: auth route handles token exchange/pre-auth flows separately
import crypto from 'crypto';
import { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { encryptTokenColumns } from '../../../../backend/auth/tokenStore';
import { getOAuthCredentialsForPlatform } from '../../../../backend/auth/oauthCredentialResolver';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getBaseUrl } from '../../../../backend/auth/getBaseUrl';
import { decodeOAuthState } from '../../../../backend/auth/oauthState';
import { checkAndGrantSetupCredits } from '../../../../backend/services/earnCreditsService';
import { META_GRAPH_VERSION } from '../../../../backend/auth/metaAuthService';
import { saveToken as saveConnectorMetadata } from '../../../../backend/services/platformTokenService';

const META_GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

type MetaPage = {
  id: string;
  name?: string | null;
  access_token?: string | null;
  instagram_business_account?: { id?: string; username?: string | null; name?: string | null } | null;
};

type DebugTokenData = {
  data?: {
    is_valid?: boolean;
    scopes?: string[];
    expires_at?: number;
    user_id?: string;
  };
};

type RpcPagePayload = {
  page_id: string;
  page_name: string | null;
  page_access_token: string;
  username: string | null;
};

type RpcInstagramPayload = {
  ig_business_id: string;
  username: string | null;
  name: string | null;
  ig_user_token: string;
  linked_page_id: string;
};

type RpcThreadsPayload = {
  threads_user_id: string;
  account_name: string;
  username: string | null;
  threads_token: string;
  linked_page_id: string;
  linked_ig_business_id: string;
};

function redirectError(res: NextApiResponse, dest: string, msg: string) {
  return res.redirect(`${dest}?error=${encodeURIComponent(msg)}`);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(err ?? `Meta request failed (${res.status})`);
  }
  return body as T;
}

async function fetchPagesAndDerive(userToken: string): Promise<MetaPage[]> {
  const url =
    `${META_GRAPH}/me/accounts?` +
    new URLSearchParams({
      fields: 'id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}',
      access_token: userToken,
      limit: '100',
    });
  const body = await fetchJson<{ data?: MetaPage[] }>(url);
  return Array.isArray(body?.data) ? body.data : [];
}

async function fetchThreadsAccountId(igUserId: string, pageToken: string): Promise<string | null> {
  const url =
    `${META_GRAPH}/${encodeURIComponent(igUserId)}?` +
    new URLSearchParams({ fields: 'threads_account', access_token: pageToken });
  const res = await fetch(url);
  const body = (await res.json().catch(() => null)) as
    | { threads_account?: { id?: string } | null; error?: { message?: string } }
    | null;
  if (!res.ok || !body) return null;
  const id = body?.threads_account?.id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error } = req.query;
  const decodedState = decodeOAuthState(state as string);
  const errDest =
    decodedState.returnTo && decodedState.returnTo.startsWith('/')
      ? decodedState.returnTo
      : '/social-platforms';

  if (error) return redirectError(res, errDest, String(error));
  if (!code || typeof code !== 'string') {
    return redirectError(res, errDest, 'No authorization code received');
  }
  if (!decodedState.valid) {
    return redirectError(res, errDest, 'Invalid OAuth state');
  }

  try {
    const { companyId, userId: stateUserId, returnTo } = decodedState;

    const oauthCredentials = await getOAuthCredentialsForPlatform('facebook');
    if (!oauthCredentials?.client_id || !oauthCredentials?.client_secret) {
      return redirectError(res, errDest, 'Facebook OAuth not configured â€” ask your Super Admin to add credentials.');
    }

    const { user } = await getSupabaseUserFromRequest(req);
    const userId = user?.id || stateUserId || process.env.DEFAULT_USER_ID || '';
    if (!userId) {
      return redirectError(res, errDest, 'Login session required â€” please log in and try again');
    }
    if (!companyId) {
      return redirectError(res, errDest, 'Company context required â€” please reconnect from a workspace.');
    }

    const idempotencyKey = crypto
      .createHash('sha256')
      .update(`${state}|${code}`)
      .digest('hex');

    // â”€â”€ 1. Token exchange (short-lived) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const shortRes = await fetch(`${META_GRAPH}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: oauthCredentials.client_id,
        client_secret: oauthCredentials.client_secret,
        redirect_uri: `${getBaseUrl(req)}/api/auth/facebook/callback`,
        code,
      }),
    });
    if (!shortRes.ok) {
      const body = await shortRes.json().catch(() => ({}));
      throw new Error((body as { error?: { message?: string } })?.error?.message ?? 'Token exchange failed');
    }
    const shortLived = (await shortRes.json()) as { access_token: string };

    // â”€â”€ 2. Long-lived exchange â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const longLived = await fetchJson<{ access_token?: string; expires_in?: number }>(
      `${META_GRAPH}/oauth/access_token?` +
        new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: oauthCredentials.client_id,
          client_secret: oauthCredentials.client_secret,
          fb_exchange_token: shortLived.access_token,
        })
    );
    const userAccessToken = longLived.access_token ?? shortLived.access_token;

    // â”€â”€ 3. /debug_token: real granted scopes + accurate expiry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const debug = await fetchJson<DebugTokenData>(
      `${META_GRAPH}/debug_token?` +
        new URLSearchParams({
          input_token: userAccessToken,
          access_token: `${oauthCredentials.client_id}|${oauthCredentials.client_secret}`,
        })
    );
    const grantedScopes: string[] = Array.isArray(debug?.data?.scopes) ? (debug.data!.scopes as string[]) : [];
    const debugExpiresAt = typeof debug?.data?.expires_at === 'number' ? debug!.data!.expires_at : 0;
    const fallbackExpiresIn = longLived.expires_in ?? 5184000;
    const tokenExpiresAtIso =
      debugExpiresAt > 0
        ? new Date(debugExpiresAt * 1000).toISOString()
        : new Date(Date.now() + fallbackExpiresIn * 1000).toISOString();

    // â”€â”€ 4. /me to capture fb_user_id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const me = await fetchJson<{ id: string; name?: string }>(
      `${META_GRAPH}/me?` + new URLSearchParams({ fields: 'id,name', access_token: userAccessToken })
    );
    const fbUserId = me.id;

    // â”€â”€ 5. /me/accounts: pages + IG business accounts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const pages = await fetchPagesAndDerive(userAccessToken);

    const pagesPayload: RpcPagePayload[] = pages
      .filter((p) => typeof p.id === 'string' && p.id && typeof p.access_token === 'string' && p.access_token)
      .map((p) => ({
        page_id: String(p.id),
        page_name: p.name ?? 'Facebook Page',
        page_access_token: encryptTokenColumns({ access_token: String(p.access_token) }).access_token,
        username: null,
      }));

    const instagramsPayload: RpcInstagramPayload[] = pages
      .filter((p) => p.instagram_business_account?.id && typeof p.access_token === 'string' && p.access_token)
      .map((p) => ({
        ig_business_id: String(p.instagram_business_account!.id),
        username: p.instagram_business_account?.username ?? null,
        name: p.instagram_business_account?.name ?? null,
        ig_user_token: encryptTokenColumns({ access_token: String(p.access_token) }).access_token,
        linked_page_id: String(p.id),
      }));

    // â”€â”€ 6. Threads derivation (per IG account that has linkage) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const threadsPayload: RpcThreadsPayload[] = [];
    for (const p of pages) {
      const igId = p.instagram_business_account?.id;
      const pageToken = p.access_token;
      if (!igId || !pageToken) continue;
      const threadsId = await fetchThreadsAccountId(igId, pageToken);
      if (!threadsId) continue;
      const igUsername = p.instagram_business_account?.username ?? null;
      threadsPayload.push({
        threads_user_id: threadsId,
        account_name: igUsername ? `Threads via @${igUsername}` : `Threads via ${p.name ?? 'Page'}`,
        username: igUsername,
        threads_token: encryptTokenColumns({ access_token: pageToken }).access_token,
        linked_page_id: String(p.id),
        linked_ig_business_id: String(igId),
      });
    }

    // â”€â”€ 7. Single-transaction RPC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const connectionPayload = {
      user_id: userId,
      company_id: companyId,
      fb_user_id: fbUserId,
      user_access_token: encryptTokenColumns({ access_token: userAccessToken }).access_token,
      token_expires_at: tokenExpiresAtIso,
      granted_scopes: grantedScopes,
      idempotency_key: idempotencyKey,
    };

    const { data: rpcData, error: rpcError } = await supabase.rpc('meta_oauth_apply', {
      p_connection: connectionPayload,
      p_pages: pagesPayload,
      p_instagrams: instagramsPayload,
      p_threads: threadsPayload,
    });

    if (rpcError) {
      console.error('meta_oauth_apply failed:', rpcError);
      throw new Error(rpcError.message || 'OAuth persistence failed');
    }

    if (companyId && userId) {
      checkAndGrantSetupCredits(companyId, userId).catch((e) =>
        console.warn('[facebook/callback] setup credits check failed:', e?.message)
      );

      await Promise.all([
        saveConnectorMetadata(companyId, companyId, 'facebook', {
          connected_by_user_id: userId,
          scopes: grantedScopes,
        }),
        saveConnectorMetadata(companyId, companyId, 'instagram', {
          connected_by_user_id: userId,
          scopes: grantedScopes,
        }),
        saveConnectorMetadata(companyId, companyId, 'whatsapp', {
          connected_by_user_id: userId,
          scopes: grantedScopes,
        }),
      ]).catch((e) =>
        console.warn('[facebook/callback] connector metadata save failed:', e?.message)
      );
    }

    const successDest = returnTo && returnTo.startsWith('/') ? returnTo : '/social-platforms';
    const sep = successDest.includes('?') ? '&' : '?';
    const params = new URLSearchParams({
      connected: 'facebook',
      pages: String(pagesPayload.length),
      instagrams: String(instagramsPayload.length),
      threads: threadsPayload.length > 0 ? 'enabled' : 'disabled',
      success: 'true',
      connection: String(rpcData ?? ''),
    });
    return res.redirect(`${successDest}${sep}${params.toString()}`);
  } catch (err: unknown) {
    const msg = (err as Error)?.message || 'Connection failed';
    console.error('Facebook OAuth callback error:', msg);
    return redirectError(res, errDest, msg);
  }
}


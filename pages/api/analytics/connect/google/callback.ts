import type { NextApiRequest, NextApiResponse } from 'next';
import { getBaseUrl } from '../../../../../backend/auth/getBaseUrl';
import { decodeOAuthState } from '../../../../../backend/auth/oauthState';
import { handleOAuthCallback } from '../../../../../backend/services/analyticsIntegrationService';
import { getSupabaseUserFromRequest } from '../../../../../backend/services/supabaseAuthService';

function buildRedirectUrl(returnTo: string | null, params: Record<string, string>): string {
  const base = returnTo && returnTo.startsWith('/') ? returnTo : '/integrations?focus=data';
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}${new URLSearchParams(params).toString()}`;
}

function resolveCallbackError(error: string): string {
  const normalized = error.toLowerCase();
  if (normalized.includes('access_denied') || normalized.includes('oauth')) return 'oauth_failed';
  if (normalized.includes('property')) return 'no_properties_found';
  if (normalized.includes('invalid_oauth_state')) return 'oauth_failed';
  return 'oauth_failed';
}

function buildSuccessParams(returnTo: string | null): Record<string, string> {
  if (returnTo?.startsWith('/super-admin')) {
    return {
      ga4: 'connected',
      analytics: 'ga',
    };
  }

  return {
    ga4: 'connected',
    success: 'true',
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log('[GA-OAUTH][callback] hit', { method: req.method, url: req.url });

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  const providerError = typeof req.query.error === 'string' ? req.query.error : '';
  const decodedState = decodeOAuthState(state);
  const hasSuperAdminSession = req.cookies?.super_admin_session === '1';
  const { user, error: authError } = await getSupabaseUserFromRequest(req);

  console.log('[GA-OAUTH][callback] params', {
    code_present: Boolean(code),
    code_length: code.length,
    state_present: Boolean(state),
    provider_error: providerError || null,
    state_valid: decodedState.valid,
    state_company_id: decodedState.companyId ?? null,
    state_user_id: decodedState.userId ?? null,
    state_return_to: decodedState.returnTo ?? null,
    has_super_admin_session: hasSuperAdminSession,
    auth_user_id: user?.id ?? null,
    auth_error: authError ?? null,
  });

  if (!hasSuperAdminSession && (authError || !user)) {
    console.warn('[GA-OAUTH][callback] failure_point=unauthorized');
    return res.redirect(buildRedirectUrl(decodedState.returnTo ?? null, { error: 'unauthorized' }));
  }

  const invalidState =
    decodedState.valid !== true ||
    (
      !hasSuperAdminSession &&
      (!decodedState.userId || decodedState.userId !== user?.id)
    );

  if (invalidState) {
    console.warn('[GA-OAUTH][callback] failure_point=invalid_oauth_state', {
      valid: decodedState.valid,
      state_user_id: decodedState.userId,
      auth_user_id: user?.id,
    });
    return res.redirect(buildRedirectUrl(decodedState.returnTo ?? null, { error: 'invalid_oauth_state' }));
  }

  if (providerError) {
    console.warn('[GA-OAUTH][callback] failure_point=provider_error', { providerError });
    return res.redirect(buildRedirectUrl(decodedState.returnTo ?? null, { error: resolveCallbackError(providerError) }));
  }

  if (!code) {
    console.warn('[GA-OAUTH][callback] failure_point=missing_code');
    return res.redirect(buildRedirectUrl(decodedState.returnTo ?? null, { error: 'missing_code' }));
  }

  try {
    console.log('[GA-OAUTH][callback] invoking handleOAuthCallback');
    const result = await handleOAuthCallback({
      code,
      state,
      requestBaseUrl: getBaseUrl(req),
    });

    console.log('[GA-OAUTH][callback] handleOAuthCallback ok', {
      company_id: result.companyId,
      integration_id: result.integration.id,
      integration_status: result.integration.status,
      properties_count: result.properties.length,
      return_to: result.returnTo,
    });

    if (result.properties.length === 0) {
      console.warn('[GA-OAUTH][callback] failure_point=no_properties_found');
      return res.redirect(buildRedirectUrl(result.returnTo, { error: 'no_properties_found' }));
    }

    return res.redirect(buildRedirectUrl(result.returnTo, buildSuccessParams(result.returnTo)));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ga4_callback_failed';
    const stack = error instanceof Error ? error.stack : undefined;
    const redirectError = /property/i.test(message) ? 'no_properties_found' : 'oauth_failed';
    console.error('[GA-OAUTH][callback] failure_point=exception', {
      message,
      redirectError,
      stack,
    });
    return res.redirect(buildRedirectUrl(decodedState.returnTo ?? null, { error: redirectError }));
  }
}

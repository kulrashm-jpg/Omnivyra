import type { NextApiRequest, NextApiResponse } from 'next';
import { getBaseUrl } from '../../../../../backend/auth/getBaseUrl';
import { decodeOAuthState } from '../../../../../backend/auth/oauthState';
import { handleGoogleOAuthCallback } from '../../../../../backend/services/analyticsIntegrationService';
import { getSupabaseUserFromRequest } from '../../../../../backend/services/supabaseAuthService';
import { logOAuthEvent, safeHost } from '../../../../../backend/auth/oauthTelemetry';

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

function buildSuccessParams(returnTo: string | null, flow: 'ga4' | 'gsc'): Record<string, string> {
  if (flow === 'gsc') {
    if (returnTo?.startsWith('/super-admin')) {
      return {
        gsc: 'connected',
        analytics: 'ga',
      };
    }

    return {
      gsc: 'connected',
      success: 'true',
    };
  }

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

  const providerLabel = decodedState.flow === 'gsc' ? 'google_search_console' : 'google_analytics';
  const callbackHost = safeHost(getBaseUrl(req));
  logOAuthEvent({
    event: 'oauth_callback_received',
    provider: providerLabel,
    callback_host: callbackHost,
    company_id: decodedState.companyId ?? null,
    user_id: user?.id ?? null,
    state_user_id: decodedState.userId ?? null,
    state_valid: decodedState.valid === true,
    state_flow: decodedState.flow ?? null,
    request_origin: (req.headers['x-forwarded-host'] as string | undefined) || (req.headers.host as string | undefined) || null,
  });

  if (!hasSuperAdminSession && (authError || !user)) {
    console.warn('[GA-OAUTH][callback] failure_point=unauthorized');
    logOAuthEvent({
      event: 'oauth_failure',
      provider: providerLabel,
      callback_host: callbackHost,
      company_id: decodedState.companyId ?? null,
      state_user_id: decodedState.userId ?? null,
      failure_point: 'unauthorized',
      failure_detail: authError ?? 'no user resolved from cookie/bearer',
    });
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
    logOAuthEvent({
      event: 'oauth_failure',
      provider: providerLabel,
      callback_host: callbackHost,
      company_id: decodedState.companyId ?? null,
      user_id: user?.id ?? null,
      state_user_id: decodedState.userId ?? null,
      state_valid: decodedState.valid === true,
      failure_point: 'invalid_oauth_state',
      failure_detail: decodedState.reason ?? 'state.userId mismatch with auth user',
    });
    return res.redirect(buildRedirectUrl(decodedState.returnTo ?? null, { error: 'invalid_oauth_state' }));
  }

  if (providerError) {
    console.warn('[GA-OAUTH][callback] failure_point=provider_error', { providerError });
    logOAuthEvent({
      event: 'oauth_failure',
      provider: providerLabel,
      callback_host: callbackHost,
      company_id: decodedState.companyId ?? null,
      user_id: user?.id ?? null,
      failure_point: 'provider_error',
      failure_detail: providerError,
    });
    return res.redirect(buildRedirectUrl(decodedState.returnTo ?? null, { error: resolveCallbackError(providerError) }));
  }

  if (!code) {
    console.warn('[GA-OAUTH][callback] failure_point=missing_code');
    logOAuthEvent({
      event: 'oauth_failure',
      provider: providerLabel,
      callback_host: callbackHost,
      company_id: decodedState.companyId ?? null,
      user_id: user?.id ?? null,
      failure_point: 'missing_code',
    });
    return res.redirect(buildRedirectUrl(decodedState.returnTo ?? null, { error: 'missing_code' }));
  }

  try {
    console.log('[GOOGLE-OAUTH][callback] invoking handleGoogleOAuthCallback');
    const result = await handleGoogleOAuthCallback({
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
      flow: result.flow,
    });

    if (result.properties.length === 0) {
      console.warn('[GA-OAUTH][callback] failure_point=no_properties_found');
      logOAuthEvent({
        event: 'oauth_failure',
        provider: providerLabel,
        callback_host: callbackHost,
        company_id: result.companyId ?? null,
        user_id: user?.id ?? null,
        failure_point: 'property_fetch_failed',
        failure_detail: 'no properties returned from provider',
      });
      return res.redirect(buildRedirectUrl(result.returnTo, {
        error: result.flow === 'gsc' ? 'no_search_console_properties_found' : 'no_properties_found',
      }));
    }

    logOAuthEvent({
      event: 'oauth_success',
      provider: providerLabel,
      callback_host: callbackHost,
      company_id: result.companyId ?? null,
      user_id: user?.id ?? null,
      state_flow: result.flow,
    });
    return res.redirect(buildRedirectUrl(result.returnTo, buildSuccessParams(result.returnTo, result.flow)));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ga4_callback_failed';
    const stack = error instanceof Error ? error.stack : undefined;
    const redirectError = /search console/i.test(message) || decodedState.flow === 'gsc'
      ? (/property|site/i.test(message) ? 'no_search_console_properties_found' : 'gsc_oauth_failed')
      : (/property/i.test(message) ? 'no_properties_found' : 'oauth_failed');
    console.error('[GA-OAUTH][callback] failure_point=exception', {
      message,
      redirectError,
      stack,
    });
    logOAuthEvent({
      event: 'oauth_failure',
      provider: providerLabel,
      callback_host: callbackHost,
      company_id: decodedState.companyId ?? null,
      user_id: user?.id ?? null,
      failure_point: 'callback_exception',
      failure_detail: message.slice(0, 200),
    });
    return res.redirect(buildRedirectUrl(decodedState.returnTo ?? null, { error: redirectError }));
  }
}

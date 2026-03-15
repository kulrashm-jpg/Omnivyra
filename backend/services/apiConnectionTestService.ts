/**
 * ApiConnectionTestService
 *
 * Lightweight connection test for External API configs.
 * Resolves credentials (including OAuth from DB), runs a minimal request,
 * returns structured result. Never returns decrypted secrets to frontend.
 */

import { supabase } from '../db/supabaseClient';
import {
  buildExternalApiRequest,
  type ExternalApiSource,
} from './externalApiService';
import { updateApiHealth } from './externalApiHealthService';
import { decryptCredential } from '../auth/credentialEncryption';

export type TestConnectionResult = {
  success: boolean;
  status: number;
  message: string;
  latency_ms: number;
};

const DEFAULT_TIMEOUT_MS = 8000;

/** OAuth token URLs for known providers (client_credentials grant) */
const OAUTH_TOKEN_URLS: Record<string, string> = {
  linkedin: 'https://www.linkedin.com/oauth/v2/accessToken',
  youtube: 'https://oauth2.googleapis.com/token',
  google: 'https://oauth2.googleapis.com/token',
  facebook: 'https://graph.facebook.com/oauth/access_token',
  instagram: 'https://graph.instagram.com/oauth/access_token',
};

/**
 * Resolve API source by id, optionally scoped by company/platform.
 */
async function resolveApiSource(
  apiId: string,
  companyId?: string | null,
  platformScope?: boolean
): Promise<ExternalApiSource | null> {
  let query = supabase.from('external_api_sources').select('*').eq('id', apiId);
  if (!platformScope && companyId) {
    query = query.or(`company_id.eq.${companyId},company_id.is.null`);
  }
  const { data, error } = await query.single();
  if (error || !data) return null;
  return data as ExternalApiSource;
}

/**
 * Run a lightweight test request and return structured result.
 */
export async function testApiConnection(input: {
  apiId: string;
  companyId?: string | null;
  platformScope?: boolean;
}): Promise<TestConnectionResult> {
  const start = Date.now();
  const source = await resolveApiSource(
    input.apiId,
    input.companyId,
    input.platformScope
  );
  if (!source) {
    return {
      success: false,
      status: 404,
      message: 'API source not found',
      latency_ms: Date.now() - start,
    };
  }

  const authType = (source.auth_type || 'none').toLowerCase();

  // OAuth: try client_credentials if we have encrypted credentials
  if (
    authType === 'oauth' &&
    source.oauth_client_id_encrypted &&
    source.oauth_client_secret_encrypted
  ) {
    const result = await testOAuthConnection(source, start);
    await persistTestResult(source.id, result);
    return result;
  }

  // api_key, bearer, header, query, none: use buildExternalApiRequest + fetch
  const { details, missingEnv } = buildExternalApiRequest(source, {
    queryParams: { geo: 'US', category: 'test' },
  });

  if (missingEnv.length > 0) {
    const result: TestConnectionResult = {
      success: false,
      status: 400,
      message: `Missing: ${missingEnv.join(', ')}`,
      latency_ms: Date.now() - start,
    };
    await persistTestResult(source.id, result);
    return result;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const response = await fetch(details.url, {
      method: details.method,
      headers: details.headers as Record<string, string>,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    let message: string;
    if (response.ok) {
      message = 'Connection successful';
    } else {
      const text = await response.text();
      let parsed: any;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = { message: text || response.statusText };
      }
      const errMsg =
        parsed?.error?.message ??
        parsed?.error_description ??
        parsed?.message ??
        parsed?.error ??
        response.statusText;
      message = typeof errMsg === 'string' ? errMsg : `HTTP ${response.status}`;
    }

    const result: TestConnectionResult = {
      success: response.ok,
      status: response.status,
      message,
      latency_ms: latencyMs,
    };
    await persistTestResult(source.id, result);
    return result;
  } catch (error: any) {
    const latencyMs = Date.now() - start;
    const msg =
      error?.name === 'AbortError'
        ? 'Request timed out'
        : error?.message ?? 'Request failed';
    const result: TestConnectionResult = {
      success: false,
      status: 0,
      message: msg,
      latency_ms: latencyMs,
    };
    await persistTestResult(source.id, result);
    return result;
  }
}

async function testOAuthConnection(
  source: ExternalApiSource,
  start: number
): Promise<TestConnectionResult> {
  try {
    const clientId = decryptCredential(source.oauth_client_id_encrypted!);
    const clientSecret = decryptCredential(source.oauth_client_secret_encrypted!);
    if (!clientId || !clientSecret) {
      return {
        success: false,
        status: 400,
        message: 'Invalid OAuth client credentials',
        latency_ms: Date.now() - start,
      };
    }

    const category = (source.category || source.name || '')
      .toLowerCase()
      .replace(/\s+/g, '');
    const tokenUrl =
      OAUTH_TOKEN_URLS[category] ??
      OAUTH_TOKEN_URLS['linkedin']; // fallback for social APIs

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    if (response.ok) {
      return {
        success: true,
        status: response.status,
        message: 'Connection successful',
        latency_ms: latencyMs,
      };
    }

    const text = await response.text();
    let parsed: any;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { error_description: text || response.statusText };
    }
    const errMsg =
      parsed?.error_description ??
      parsed?.error ??
      parsed?.message ??
      response.statusText;
    return {
      success: false,
      status: response.status,
      message: typeof errMsg === 'string' ? errMsg : `HTTP ${response.status}`,
      latency_ms: latencyMs,
    };
  } catch (error: any) {
    const msg =
      error?.name === 'AbortError'
        ? 'Request timed out'
        : error?.message ?? 'OAuth request failed';
    return {
      success: false,
      status: 0,
      message: msg,
      latency_ms: Date.now() - start,
    };
  }
}

async function persistTestResult(
  apiId: string,
  result: TestConnectionResult
): Promise<void> {
  try {
    await updateApiHealth({
      apiId,
      success: result.success,
      latencyMs: result.latency_ms,
      last_test_status: result.success ? 'SUCCESS' : 'FAILED',
      last_test_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[ApiConnectionTestService] Failed to persist test result', e);
  }
}

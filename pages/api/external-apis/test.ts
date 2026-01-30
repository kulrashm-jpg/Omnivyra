import { NextApiRequest, NextApiResponse } from 'next';
import { buildExternalApiRequest, validatePlatformConfig } from '../../../backend/services/externalApiService';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_CHARS = 2000;

const fetchWithTimeout = async (url: string, init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const normalizeError = (error: any) => {
  if (error?.name === 'AbortError') return 'Request timed out';
  return error?.message || 'Request failed';
};

const truncate = (value: string) =>
  value.length > MAX_RESPONSE_CHARS ? `${value.slice(0, MAX_RESPONSE_CHARS)}...` : value;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const input = req.body || {};
  const validation = validatePlatformConfig({
    name: input.name || 'Ad hoc',
    base_url: input.base_url,
    platform_type: input.platform_type || 'social',
    method: input.method,
    headers: input.headers,
    query_params: input.query_params,
    supported_content_types: input.supported_content_types,
    promotion_modes: input.promotion_modes,
    required_metadata: input.required_metadata,
    posting_constraints: input.posting_constraints,
  });
  if (!validation.ok) {
    return res.status(400).json({ error: validation.message || 'Invalid config' });
  }

  try {
    const source = {
      id: 'ad-hoc',
      name: input.name || 'Ad hoc',
      base_url: input.base_url,
      purpose: input.purpose || 'trends',
      category: input.category || null,
      is_active: true,
      method: input.method || 'GET',
      auth_type: input.auth_type || 'none',
      api_key_name: input.api_key_name || null,
      api_key_env_name: input.api_key_env_name || null,
      headers: input.headers || {},
      query_params: input.query_params || {},
      created_at: new Date().toISOString(),
    };

    const request = buildExternalApiRequest(source);
    if (request.missingEnv.length > 0) {
      return res.status(400).json({
        error: 'Missing environment variables',
        missing: request.missingEnv,
        request: {
          method: request.details.method,
          url: request.details.maskedUrl,
          headers: request.details.maskedHeaders,
          queryParams: request.details.queryParams,
        },
      });
    }

    const response = await fetchWithTimeout(request.details.url, {
      method: request.details.method,
      headers: request.details.headers,
    });
    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();
    const truncated = truncate(rawText);
    let parsed: any = truncated;
    if (contentType.includes('application/json')) {
      try {
        parsed = JSON.parse(truncated);
      } catch (error) {
        parsed = truncated;
      }
    }

    return res.status(200).json({
      request: {
        method: request.details.method,
        url: request.details.maskedUrl,
        headers: request.details.maskedHeaders,
        queryParams: request.details.queryParams,
      },
      response: {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        body: parsed,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ error: normalizeError(error) });
  }
}

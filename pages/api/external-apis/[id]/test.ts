import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { buildExternalApiRequest } from '../../../../backend/services/externalApiService';

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
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'API ID is required' });
  }

  try {
    const { data, error } = await supabase
      .from('external_api_sources')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) {
      return res.status(404).json({ error: 'API source not found' });
    }

    const request = buildExternalApiRequest(data);
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

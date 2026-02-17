/**
 * Normalized Next.js API request mock.
 * Ensures headers, query, body always exist to avoid undefined access in auth/RBAC paths.
 *
 * Use for ALL handler tests. No custom inline req mocks.
 */

import type { NextApiRequest } from 'next';

export interface ApiRequestMockOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  query?: Record<string, string | string[]>;
  body?: Record<string, any>;
  /** Set in query and/or body for withRBAC/enforceRole */
  companyId?: string;
  /** Route param (e.g. id for /api/recommendations/[id]) */
  id?: string;
}

export function createApiRequestMock(
  options: ApiRequestMockOptions = {}
): NextApiRequest {
  const {
    method = 'GET',
    headers = {},
    query = {},
    body = {},
    companyId,
    id,
  } = options;

  const mergedQuery = { ...query };
  if (companyId !== undefined) mergedQuery.companyId = companyId;
  if (id !== undefined) mergedQuery.id = id;

  const mergedBody = { ...body };
  if (companyId !== undefined && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    mergedBody.companyId = mergedBody.companyId ?? companyId;
  }

  return {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-token',
      ...headers,
    },
    query: mergedQuery,
    body: mergedBody,
    cookies: {},
    dynamicRoutes: {},
    previewData: undefined,
    preview: false,
    statusMessage: '',
  } as unknown as NextApiRequest;
}

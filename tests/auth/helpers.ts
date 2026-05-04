import type { NextApiRequest, NextApiResponse } from 'next';
import type { AuthContext } from '../../backend/auth/authContext';

type ResponseShape = NextApiResponse & {
  statusCodeValue?: number;
  jsonBody?: unknown;
  ended?: boolean;
};

export function mockRequest(
  headers: Record<string, string | string[]> = {},
  body: Record<string, unknown> | string = {},
  query: Record<string, string | string[]> = {},
): NextApiRequest {
  return {
    headers,
    body,
    query,
    method: 'GET',
  } as unknown as NextApiRequest;
}

export function mockResponse(): ResponseShape {
  const res: Partial<ResponseShape> = {};
  res.status = jest.fn((code: number) => {
    res.statusCodeValue = code;
    return res as ResponseShape;
  }) as any;
  res.json = jest.fn((body: unknown) => {
    res.jsonBody = body;
    return res as ResponseShape;
  }) as any;
  res.end = jest.fn(() => {
    res.ended = true;
    return res as ResponseShape;
  }) as any;
  res.setHeader = jest.fn() as any;
  return res as ResponseShape;
}

export function mockSupabaseSession(state: 'valid' | 'invalid' = 'valid') {
  if (state === 'invalid') {
    return null;
  }
  return {
    id: 'supabase-user-1',
    email: 'user@example.com',
  };
}

export function mockInternalUser(state: 'active' | 'deleted' | 'missing' = 'active') {
  if (state === 'missing') return null;
  return {
    id: 'internal-user-1',
    email: 'user@example.com',
    status: state === 'active' ? 'active' : 'deleted',
  };
}

export function mockMembership(orgId = 'org-1', role = 'MEMBER', status = 'active') {
  return { orgId, role, status };
}

export function mockAuthContext(input: {
  activeOrgId?: string | null;
  memberships?: AuthContext['memberships'];
  roles?: string[];
  isSuperAdmin?: boolean;
  internalUserStatus?: string;
} = {}): AuthContext {
  return {
    user: {
      id: 'supabase-user-1',
      email: 'user@example.com',
    },
    internalUser: {
      id: 'internal-user-1',
      email: 'user@example.com',
      status: input.internalUserStatus ?? 'active',
    },
    memberships: input.memberships ?? [],
    activeOrgId: input.activeOrgId ?? null,
    roles: input.roles ?? [],
    isSuperAdmin: input.isSuperAdmin ?? false,
  };
}

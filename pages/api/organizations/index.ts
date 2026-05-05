import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import { runWithServiceRole } from '@/backend/db/supabaseClient';
import type { NextApiRequest, NextApiResponse } from 'next';
import { normalizeDomain, resolveDomainOrganization } from '../../../lib/domainService';

type DomainVerificationProof = {
  method: 'dns' | 'email';
  verified: boolean;
  token?: string;
};

const parseProof = (value: unknown): DomainVerificationProof | null => {
  if (!value || typeof value !== 'object') return null;
  const proof = value as Partial<DomainVerificationProof>;
  if ((proof.method === 'dns' || proof.method === 'email') && proof.verified === true) {
    return proof as DomainVerificationProof;
  }
  return null;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const auth = (req as any).auth;
    const organizations = (auth?.memberships || []).map((membership: any) => ({
      organization_id: membership.organization_id || membership.orgId,
      role: membership.role,
      status: membership.status,
    }));

    return res.status(200).json({ organizations });
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const name = String(body?.name || '').trim();
    const domain = normalizeDomain(String(body?.domain || body?.website || ''));
    const proof = parseProof(body?.verification_proof);

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!domain) return res.status(400).json({ error: 'domain is required' });

    const domainResolution = await resolveDomainOrganization(domain);
    if (domainResolution.action === 'blocked') {
      return res.status(409).json({
        error: domainResolution.reason,
        organization_id: domainResolution.organization_id,
      });
    }
    if (domainResolution.action === 'attach') {
      return res.status(409).json({
        error: 'DOMAIN_ALREADY_REGISTERED',
        organization_id: domainResolution.organization_id,
      });
    }

    if (!proof) {
      return res.status(202).json({
        domain_verification: {
          required: true,
          domain,
          methods: ['dns', 'email'],
        },
      });
    }

    const { data: organization, error: orgError } = await runWithServiceRole(
      'Create verified organization with domain transaction lock',
      (client) => client.rpc('create_verified_organization_with_domain', {
        p_name: name,
        p_domain: domain,
        p_method: proof.method,
        p_token: proof.token || null,
      }),
    );

    if (orgError || !organization) {
      if (orgError?.message === 'DOMAIN_ALREADY_REGISTERED') {
        return res.status(409).json({ error: 'DOMAIN_ALREADY_REGISTERED' });
      }
      return res.status(500).json({ error: orgError?.message || 'FAILED_TO_CREATE_ORGANIZATION' });
    }

    const organization_id = String((organization as any).organization_id);
    return res.status(201).json({
      organization: {
        organization_id,
        name: (organization as any).name,
        domain: (organization as any).domain || domain,
      },
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default applyAuthGuard({
  requiresAuth: true,
  allowSuperAdminOverride: true,
})(handler);

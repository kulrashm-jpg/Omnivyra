import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

/**
 * POST /api/access-request
 *
 * Public endpoint â€” no auth required. Allows users with public email domains
 * (Gmail, Yahoo, etc.) to request access to the platform.
 *
 * These users cannot self-serve because their email domain is not eligible
 * for free credits. A super admin reviews and approves/rejects the request.
 *
 * Body:
 *   email       â€” required
 *   name        â€” required (person or brand name)
 *   website_url â€” optional
 *   job_title   â€” optional
 *
 * Idempotent: returns the existing request if one is already pending or approved.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { email, name, website_url, job_title } = body as {
    email:        string;
    name:         string;
    website_url?: string;
    job_title?:   string;
  };

  if (!email?.trim() || !name?.trim()) {
    return res.status(400).json({ error: 'email and name are required' });
  }

  const emailLower = email.toLowerCase().trim();
  const domain     = emailLower.split('@')[1] ?? '';

  if (!domain) return res.status(400).json({ error: 'Invalid email address' });


  // â”€â”€ Idempotent: return existing pending or approved request â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: existing } = await supabase
    .from('access_requests')
    .select('id, status')
    .eq('email', emailLower)
    .in('status', ['pending', 'approved'])
    .maybeSingle();

  if (existing) {
    return res.status(200).json({ requestId: existing.id, status: existing.status });
  }

  // â”€â”€ Insert new request â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: inserted, error } = await supabase
    .from('access_requests')
    .insert({
      email:         emailLower,
      name:          name.trim(),
      website_url:   website_url?.trim() ?? null,
      job_title:     job_title?.trim() ?? null,
      domain,
      domain_status: 'public_provider',
      status:        'pending',
      created_at:    new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    console.error('[access-request] insert failed:', error.message);
    return res.status(500).json({ error: 'Failed to submit access request' });
  }

  return res.status(201).json({ requestId: inserted.id, status: 'pending' });
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);



/**
 * /api/super-admin/credit-packages
 *
 * GET    â€” list all credit packages (active + inactive)
 * POST   â€” create a new package
 * PATCH  â€” update an existing package (body must include id)
 * DELETE â€” soft-delete (set is_active = false) by id (?id=<uuid>)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import { isContentArchitectSession } from '../../../../backend/services/contentArchitectService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isContentArchitectSession(req)) {
    const ctx = await requireAdminScope(req, res, 'credits:view');
    if (!ctx) return;
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[ADMIN_SCOPE]', '/api/super-admin/credit-packages', 'credits:view');
    }
  }

  // â”€â”€ GET: list all packages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('credit_packages')
      .select('*')
      .order('price', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ packages: data });
  }

  // â”€â”€ POST: create package â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { name, credits, price } = body as { name: string; credits: number; price: number };

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!credits || credits <= 0) return res.status(400).json({ error: 'credits must be a positive integer' });
    if (price == null || price < 0) return res.status(400).json({ error: 'price must be >= 0' });

    const { data, error } = await supabase
      .from('credit_packages')
      .insert({ name, credits, price, is_active: true, created_at: new Date().toISOString() })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, package: data });
  }

  // â”€â”€ PATCH: update package â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'PATCH') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { id, name, credits, price, is_active } = body as {
      id: string; name?: string; credits?: number; price?: number; is_active?: boolean;
    };

    if (!id) return res.status(400).json({ error: 'id is required' });

    const updates: Record<string, any> = {};
    if (name      !== undefined) updates.name      = name;
    if (credits   !== undefined) updates.credits   = credits;
    if (price     !== undefined) updates.price     = price;
    if (is_active !== undefined) updates.is_active = is_active;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data, error } = await supabase
      .from('credit_packages')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, package: data });
  }

  // â”€â”€ DELETE: deactivate package (soft delete) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'DELETE') {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: 'id query param is required' });

    const { error } = await supabase
      .from('credit_packages')
      .update({ is_active: false })
      .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);

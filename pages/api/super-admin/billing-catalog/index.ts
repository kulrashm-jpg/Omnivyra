/**
 * /api/super-admin/billing-catalog — HIDDEN super-admin pricing governance.
 *
 *   GET   — list all hidden_billing_catalog entries (operator view).
 *   POST  — create a pricing entry.
 *   PATCH — update / enable-disable a pricing entry (by reference_key).
 *
 * STRICTLY internal: super-admin only (BILLING_PLATFORM_MANAGE — SUPER_ADMIN-
 * only, platform-level). NOT a public API, NOT a pricing page, NOT a public
 * catalog. Pricing is visible ONLY to the authenticated operator here — every
 * public surface (billing shell, provider discovery, checkout response)
 * remains pricing-blind.
 *
 * The catalog is read by billingAmountResolver for backend-authoritative
 * checkout amount resolution. This endpoint does NOT touch the ledger, HOLD
 * semantics, settlement, or provider governance.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { BILLING_PLATFORM_MANAGE } from '../../../../shared/contracts/security/SecurityCapabilities';
import { logger } from '../../../../backend/services/logger';

type AuditOperation = 'create' | 'update' | 'enable' | 'disable';

/**
 * Append-only audit write for a hidden_billing_catalog mutation. Best-effort:
 * a missing audit table (migration 20260718 unapplied) does not fail the
 * catalog mutation. before_snapshot is null on create.
 */
async function writeCatalogAudit(input: {
  referenceKey: string;
  operationType: AuditOperation;
  before: unknown | null;
  after: unknown;
  changedByUserId: string;
}): Promise<void> {
  try {
    const { error } = await supabase.from('hidden_billing_catalog_audit').insert({
      reference_key: input.referenceKey,
      operation_type: input.operationType,
      before_snapshot: input.before ?? null,
      after_snapshot: input.after,
      changed_by_user_id: input.changedByUserId,
    } as Record<string, unknown>);
    if (error && !String(error.message ?? '').toLowerCase().includes('does not exist')) {
      logger.warn('hidden_billing_catalog_audit_write_failed', { message: error.message });
    }
  } catch (err) {
    logger.warn('hidden_billing_catalog_audit_write_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

// Mirrors billingAmountResolver's reference shape — lowercase id, 3-64 chars.
const REFERENCE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
const ISO_CURRENCY = /^[A-Za-z]{3}$/;
const VALID_KINDS = ['subscription', 'topup'] as const;

interface ValidationError { error: string; detail?: string }

/** Validate a create payload. Returns null when valid. */
function validateCreate(b: Record<string, unknown>): ValidationError | null {
  const ref = typeof b.reference_key === 'string' ? b.reference_key.trim() : '';
  if (!REFERENCE_PATTERN.test(ref)) {
    return { error: 'invalid_reference_key', detail: 'lowercase identifier, 3-64 chars' };
  }
  if (!VALID_KINDS.includes(b.kind as (typeof VALID_KINDS)[number])) {
    return { error: 'invalid_kind', detail: 'subscription | topup' };
  }
  if (typeof b.amount_minor !== 'number' || !Number.isInteger(b.amount_minor) || b.amount_minor < 0) {
    return { error: 'invalid_amount_minor', detail: 'non-negative integer (smallest currency unit)' };
  }
  if (typeof b.currency !== 'string' || !ISO_CURRENCY.test(b.currency)) {
    return { error: 'invalid_currency', detail: 'ISO-4217 alpha-3' };
  }
  if (b.internal_label != null && typeof b.internal_label !== 'string') {
    return { error: 'invalid_internal_label' };
  }
  if (b.enabled != null && typeof b.enabled !== 'boolean') {
    return { error: 'invalid_enabled' };
  }
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const guard = await requireCapability(req, res, {
    capability: BILLING_PLATFORM_MANAGE,
    reason: `super-admin ${req.method === 'GET' ? 'lists' : 'updates'} hidden billing catalog`,
    resourceId: null,
  });
  if (guard.ok !== true) return;

  // ── GET — operator listing ────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('hidden_billing_catalog')
      .select('id, reference_key, kind, amount_minor, currency, enabled, internal_label, created_at, updated_at')
      .order('reference_key', { ascending: true });
    if (error) {
      return res.status(500).json({ error: 'catalog_list_failed', message: error.message });
    }
    return res.status(200).json({ entries: data ?? [] });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});

  // ── POST — create ─────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const invalid = validateCreate(body);
    if (invalid) return res.status(400).json(invalid);

    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('hidden_billing_catalog')
      .insert({
        reference_key: String(body.reference_key).trim(),
        kind: body.kind,
        amount_minor: body.amount_minor,
        currency: String(body.currency).toUpperCase(),
        enabled: body.enabled == null ? true : body.enabled,
        internal_label: body.internal_label ?? null,
        updated_at: nowIso,
      })
      .select('id, reference_key, kind, amount_minor, currency, enabled, internal_label')
      .maybeSingle();

    if (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') {
        return res.status(409).json({ error: 'duplicate_reference_key', reference_key: body.reference_key });
      }
      if (String(error.message ?? '').toLowerCase().includes('does not exist')) {
        return res.status(409).json({ error: 'hidden_billing_catalog_unavailable', detail: 'apply migration 20260717' });
      }
      return res.status(500).json({ error: 'catalog_create_failed', message: error.message });
    }
    // Append-only audit: create → before is null.
    await writeCatalogAudit({
      referenceKey: String(body.reference_key).trim(),
      operationType: 'create',
      before: null,
      after: data,
      changedByUserId: guard.principal.userId,
    });
    return res.status(201).json({ created: data });
  }

  // ── PATCH — update / enable-disable (by reference_key) ───────────────────
  const referenceKey = typeof body.reference_key === 'string' ? body.reference_key.trim() : '';
  if (!REFERENCE_PATTERN.test(referenceKey)) {
    return res.status(400).json({ error: 'invalid_reference_key' });
  }

  const patch: Record<string, unknown> = {};
  if (body.amount_minor != null) {
    if (typeof body.amount_minor !== 'number' || !Number.isInteger(body.amount_minor) || body.amount_minor < 0) {
      return res.status(400).json({ error: 'invalid_amount_minor' });
    }
    patch.amount_minor = body.amount_minor;
  }
  if (body.currency != null) {
    if (typeof body.currency !== 'string' || !ISO_CURRENCY.test(body.currency)) {
      return res.status(400).json({ error: 'invalid_currency' });
    }
    patch.currency = body.currency.toUpperCase();
  }
  if (body.internal_label != null) {
    if (typeof body.internal_label !== 'string') return res.status(400).json({ error: 'invalid_internal_label' });
    patch.internal_label = body.internal_label;
  }
  if (body.enabled != null) {
    if (typeof body.enabled !== 'boolean') return res.status(400).json({ error: 'invalid_enabled' });
    patch.enabled = body.enabled;
  }
  // kind / reference_key are immutable — a new identity is a new entry.
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'no_updatable_fields', allowed: ['amount_minor', 'currency', 'internal_label', 'enabled'] });
  }

  // Pre-read the row so the audit captures an accurate before_snapshot.
  const { data: beforeRow } = await supabase
    .from('hidden_billing_catalog')
    .select('id, reference_key, kind, amount_minor, currency, enabled, internal_label')
    .eq('reference_key', referenceKey)
    .maybeSingle();

  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('hidden_billing_catalog')
    .update(patch)
    .eq('reference_key', referenceKey)
    .select('id, reference_key, kind, amount_minor, currency, enabled, internal_label')
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: 'catalog_update_failed', message: error.message });
  }
  if (!data) {
    return res.status(404).json({ error: 'reference_key_not_found', reference_key: referenceKey });
  }

  // Append-only audit. An enabled-only patch is recorded as enable/disable;
  // any other field change is recorded as a generic update.
  const changedKeys = Object.keys(patch).filter((k) => k !== 'updated_at');
  const operationType: AuditOperation =
    (changedKeys.length === 1 && changedKeys[0] === 'enabled')
      ? (patch.enabled === true ? 'enable' : 'disable')
      : 'update';
  await writeCatalogAudit({
    referenceKey,
    operationType,
    before: beforeRow ?? null,
    after: data,
    changedByUserId: guard.principal.userId,
  });

  return res.status(200).json({ updated: data });
}

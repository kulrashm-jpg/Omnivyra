// Manual override system.
//
// Analysts can override specific report inputs (benchmark, vertical, company
// classification, provider exclusion, evidence suppression, recommendation
// dismissal) and attach a free-text note. Every override is tenant-scoped,
// audit-logged, fully reversible, and visibly marked in the UI so a reader
// always knows whether they're looking at measured intelligence or analyst
// override.

import { randomUUID } from 'crypto';
import type { TenantContext, TenantId } from './tenantGovernance';
import { logAuditEvent } from './auditLog';
import type { CanonicalDimensionKey, PillarKey } from '../canonicalReport/canonicalReportTypes';

export type OverrideKind =
  | 'benchmark_band'
  | 'vertical_classification'
  | 'company_size_band'
  | 'provider_exclusion'
  | 'evidence_suppression'
  | 'recommendation_dismissal'
  | 'analyst_note';

export type OverrideRecord = {
  id: string;
  tenant_id: TenantId;
  company_id: string;
  kind: OverrideKind;
  // The override target is kind-specific.
  target:
    | { kind: 'benchmark_band'; vertical: string; size_band: string }
    | { kind: 'vertical_classification'; vertical: string }
    | { kind: 'company_size_band'; size_band: 'small' | 'mid' | 'enterprise' }
    | { kind: 'provider_exclusion'; provider_id: string }
    | { kind: 'evidence_suppression'; dimension_key: CanonicalDimensionKey }
    | { kind: 'recommendation_dismissal'; action_id: string }
    | { kind: 'analyst_note'; pillar: PillarKey | null; note: string };
  reason: string;
  created_at: string;
  created_by: TenantContext['actor'];
  // null means active. When set, the override is reversed and timestamped.
  reversed_at: string | null;
  reversed_by: TenantContext['actor'] | null;
};

export interface OverrideStore {
  list(tenantId: TenantId, companyId: string): Promise<OverrideRecord[]>;
  upsert(record: OverrideRecord): Promise<void>;
}

class InMemoryOverrideStore implements OverrideStore {
  private rows: OverrideRecord[] = [];
  async list(tenant_id: TenantId, company_id: string): Promise<OverrideRecord[]> {
    return this.rows.filter((r) => r.tenant_id === tenant_id && r.company_id === company_id);
  }
  async upsert(record: OverrideRecord): Promise<void> {
    const idx = this.rows.findIndex((r) => r.id === record.id);
    if (idx >= 0) this.rows[idx] = record;
    else this.rows.push(record);
  }
  /** Test helper. */
  _reset(): void {
    this.rows = [];
  }
}

let activeOverrideStore: OverrideStore = new InMemoryOverrideStore();

export function registerOverrideStore(store: OverrideStore): void {
  activeOverrideStore = store;
}

export function getOverrideStore(): OverrideStore {
  return activeOverrideStore;
}

// ── Public API for analysts ───────────────────────────────────────────────────

export async function createOverride(params: {
  tenantContext: TenantContext;
  companyId: string;
  kind: OverrideKind;
  target: OverrideRecord['target'];
  reason: string;
}): Promise<OverrideRecord> {
  const record: OverrideRecord = {
    id: randomUUID(),
    tenant_id: params.tenantContext.tenant_id,
    company_id: params.companyId,
    kind: params.kind,
    target: params.target,
    reason: params.reason,
    created_at: new Date().toISOString(),
    created_by: params.tenantContext.actor,
    reversed_at: null,
    reversed_by: null,
  };
  await activeOverrideStore.upsert(record);
  await logAuditEvent({
    tenantContext: params.tenantContext,
    kind: 'manual_override',
    payload: { action: 'create', override_id: record.id, kind: record.kind, target: record.target, reason: record.reason },
  });
  return record;
}

export async function reverseOverride(params: {
  tenantContext: TenantContext;
  companyId: string;
  overrideId: string;
}): Promise<OverrideRecord | null> {
  const all = await activeOverrideStore.list(params.tenantContext.tenant_id, params.companyId);
  const target = all.find((r) => r.id === params.overrideId);
  if (!target) return null;
  if (target.reversed_at != null) return target;
  const reversed: OverrideRecord = {
    ...target,
    reversed_at: new Date().toISOString(),
    reversed_by: params.tenantContext.actor,
  };
  await activeOverrideStore.upsert(reversed);
  await logAuditEvent({
    tenantContext: params.tenantContext,
    kind: 'manual_override',
    payload: { action: 'reverse', override_id: target.id, kind: target.kind },
  });
  return reversed;
}

// ── Active overrides (filter out reversed) ────────────────────────────────────

export async function loadActiveOverrides(
  tenantContext: TenantContext,
  companyId: string,
): Promise<OverrideRecord[]> {
  const all = await activeOverrideStore.list(tenantContext.tenant_id, companyId);
  return all.filter((r) => r.reversed_at == null);
}

// ── Override application helpers ──────────────────────────────────────────────
//
// The canonical report builder consumes these helpers AFTER its measurement
// step. They overlay measured data with the analyst override and tag the
// affected fields so the UI can render an "Analyst override" badge.

export type AppliedOverrideMarker = {
  kind: OverrideKind;
  reason: string;
  created_at: string;
  created_by: TenantContext['actor'];
  override_id: string;
};

export function indexActiveOverridesByDimension(
  overrides: OverrideRecord[],
): Record<string, AppliedOverrideMarker> {
  const out: Record<string, AppliedOverrideMarker> = {};
  for (const o of overrides) {
    if (o.kind === 'evidence_suppression' && o.target.kind === 'evidence_suppression') {
      out[o.target.dimension_key] = {
        kind: o.kind,
        reason: o.reason,
        created_at: o.created_at,
        created_by: o.created_by,
        override_id: o.id,
      };
    }
  }
  return out;
}

export function indexActiveOverridesByActionId(
  overrides: OverrideRecord[],
): Record<string, AppliedOverrideMarker> {
  const out: Record<string, AppliedOverrideMarker> = {};
  for (const o of overrides) {
    if (o.kind === 'recommendation_dismissal' && o.target.kind === 'recommendation_dismissal') {
      out[o.target.action_id] = {
        kind: o.kind,
        reason: o.reason,
        created_at: o.created_at,
        created_by: o.created_by,
        override_id: o.id,
      };
    }
  }
  return out;
}

export function pickProviderExclusions(overrides: OverrideRecord[]): Set<string> {
  const set = new Set<string>();
  for (const o of overrides) {
    if (o.kind === 'provider_exclusion' && o.target.kind === 'provider_exclusion') {
      set.add(o.target.provider_id);
    }
  }
  return set;
}

export function pickAnalystNotes(overrides: OverrideRecord[]): Array<{ pillar: PillarKey | null; note: string; created_at: string; created_by: TenantContext['actor'] }> {
  const notes: Array<{ pillar: PillarKey | null; note: string; created_at: string; created_by: TenantContext['actor'] }> = [];
  for (const o of overrides) {
    if (o.kind === 'analyst_note' && o.target.kind === 'analyst_note') {
      notes.push({
        pillar: o.target.pillar,
        note: o.target.note,
        created_at: o.created_at,
        created_by: o.created_by,
      });
    }
  }
  return notes;
}

/** Test helper. */
export function _resetOverrideStore(): void {
  activeOverrideStore = new InMemoryOverrideStore();
}

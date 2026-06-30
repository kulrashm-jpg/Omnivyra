/**
 * Legacy lead-signal compatibility projection (GET /api/leads/signals).
 *
 * Reconstructs the exact `CanonicalLeadSignal` row shape the signals endpoint
 * returns — the per-row normalization that previously lived inline in the
 * endpoint. Field-preserving: source_type, thread_id, contact_key, the four
 * component scores + total_score, confidence, timestamps, metadata, and the
 * nested `contact` object. No field loss, no renaming, no nullability change.
 *
 * Operates on the raw `lead_signals` row (optionally joined to `contacts`); it
 * does NOT route through CanonicalLeadView, which cannot losslessly carry the
 * signal shape (per Phase 6C Regression Protection).
 */

export type LegacySignalSourceType = 'engagement' | 'listening';

export interface LegacyLeadSignal {
  id: string;
  organization_id: string;
  source_type: LegacySignalSourceType;
  source_id: string;
  thread_id: string | null;
  platform: string | null;
  platform_user_id: string | null;
  content_text: string;
  intent_score: number | null;
  urgency_score: number | null;
  icp_score: number | null;
  confidence_score: number | null;
  total_score: number | null;
  detected_at: string | null;
  contact_key: string | null;
  contact_id: string | null;
  metadata: Record<string, unknown>;
  contact?: {
    contact_id: string | null;
    platform: string | null;
    platform_user_id: string | null;
    display_name: string | null;
  } | null;
}

export function normalizeSignalNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toLegacyLeadSignal(row: Record<string, unknown>): LegacyLeadSignal {
  const contact = row.contact as Record<string, unknown> | null | undefined;
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    source_type: String(row.source_type) as LegacySignalSourceType,
    source_id: String(row.source_id),
    thread_id: typeof row.thread_id === 'string' ? row.thread_id : null,
    platform: typeof row.platform === 'string' ? row.platform : null,
    platform_user_id: typeof row.platform_user_id === 'string' ? row.platform_user_id : null,
    content_text: typeof row.content_text === 'string' ? row.content_text : '',
    intent_score: normalizeSignalNumber(row.intent_score),
    urgency_score: normalizeSignalNumber(row.urgency_score),
    icp_score: normalizeSignalNumber(row.icp_score),
    confidence_score: normalizeSignalNumber(row.confidence_score),
    total_score: normalizeSignalNumber(row.total_score),
    detected_at: typeof row.detected_at === 'string' ? row.detected_at : null,
    contact_key: typeof row.contact_key === 'string' ? row.contact_key : null,
    contact_id: typeof row.contact_id === 'string' ? row.contact_id : null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    contact: contact
      ? {
          contact_id: typeof contact.id === 'string' ? contact.id : null,
          platform: typeof contact.platform === 'string' ? contact.platform : null,
          platform_user_id: typeof contact.platform_user_id === 'string' ? contact.platform_user_id : null,
          display_name: typeof contact.display_name === 'string' ? contact.display_name : null,
        }
      : null,
  };
}

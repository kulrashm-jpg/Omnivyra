/**
 * Form abandonment diagnostics — DETERMINISTIC join over tracking_events.
 *
 * A session is counted as "abandoned" for a given form when it has a
 * `form_start` event but no `form_submit` event for the same (form_id,
 * visitor_session_id) within the window.
 *
 * No new ingestion; no replay infra. Reuses tracking_events written by
 * `/api/website-events/track`.
 */
import { ownedDbTable } from '../db/writeOwner';

export interface FormAbandonmentRow {
  formId: string;
  websiteId: string | null;
  starts: number;
  submits: number;
  abandoned: number;
  abandonmentRate: number; // 0..1
  topAbandonedField: string | null;
  pages: Array<{ pageUrl: string; abandoned: number }>;
}

export interface FormAbandonmentReport {
  companyId: string;
  generatedAt: string;
  windowDays: number;
  totalForms: number;
  forms: FormAbandonmentRow[];
}

const WINDOW_DAYS = 30;

interface EventRow {
  event_name: string;
  visitor_session_id: string | null;
  website_id: string | null;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
  current_page: string | null;
}

export async function buildFormAbandonmentReport(companyId: string, websiteId?: string | null): Promise<FormAbandonmentReport> {
  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  let rows: EventRow[] = [];
  try {
    let q = ownedDbTable('tracking_events')
      .select('event_name, visitor_session_id, website_id, occurred_at, metadata, current_page')
      .eq('company_id', companyId)
      .gte('occurred_at', sinceIso)
      .in('event_name', ['form_start', 'form_field_focus', 'form_field_complete', 'form_submit'])
      .limit(50_000);
    if (websiteId) q = q.eq('website_id', websiteId);
    const { data } = await q;
    rows = (data ?? []) as EventRow[];
  } catch { rows = []; }

  // Index by (formId × sessionId).
  type Acc = { starts: number; submits: number; lastField: string | null; pageCounts: Map<string, number> };
  const perForm = new Map<string, { websiteId: string | null; sessions: Map<string, Acc>; lastFieldCounts: Map<string, number> }>();

  for (const e of rows) {
    const formId = String((e.metadata as Record<string, unknown> | null)?.form_id ?? (e.metadata as Record<string, unknown> | null)?.formId ?? '');
    if (!formId) continue;
    const sessionId = e.visitor_session_id ?? '';
    if (!sessionId) continue;
    if (!perForm.has(formId)) perForm.set(formId, { websiteId: e.website_id ?? null, sessions: new Map(), lastFieldCounts: new Map() });
    const form = perForm.get(formId)!;
    if (!form.sessions.has(sessionId)) form.sessions.set(sessionId, { starts: 0, submits: 0, lastField: null, pageCounts: new Map() });
    const acc = form.sessions.get(sessionId)!;
    if (e.event_name === 'form_start') acc.starts += 1;
    else if (e.event_name === 'form_submit') acc.submits += 1;
    else if (e.event_name === 'form_field_focus' || e.event_name === 'form_field_complete') {
      const fk = String((e.metadata as Record<string, unknown> | null)?.field_key ?? (e.metadata as Record<string, unknown> | null)?.field ?? '');
      if (fk) acc.lastField = fk;
    }
    if (e.current_page) acc.pageCounts.set(e.current_page, (acc.pageCounts.get(e.current_page) ?? 0) + 1);
  }

  const forms: FormAbandonmentRow[] = [];
  for (const [formId, form] of perForm) {
    let starts = 0, submits = 0, abandoned = 0;
    const fieldDropCounts = new Map<string, number>();
    const pageDropCounts = new Map<string, number>();
    for (const [, acc] of form.sessions) {
      if (acc.starts > 0) starts += 1;
      if (acc.submits > 0) submits += 1;
      if (acc.starts > 0 && acc.submits === 0) {
        abandoned += 1;
        if (acc.lastField) fieldDropCounts.set(acc.lastField, (fieldDropCounts.get(acc.lastField) ?? 0) + 1);
        for (const [page, count] of acc.pageCounts) pageDropCounts.set(page, (pageDropCounts.get(page) ?? 0) + count);
      }
    }
    const rate = starts > 0 ? abandoned / starts : 0;
    const topAbandonedField = [...fieldDropCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const pages = [...pageDropCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([pageUrl, abandonedCount]) => ({ pageUrl, abandoned: abandonedCount }));
    forms.push({
      formId,
      websiteId: form.websiteId,
      starts,
      submits,
      abandoned,
      abandonmentRate: Number(rate.toFixed(3)),
      topAbandonedField,
      pages,
    });
  }
  forms.sort((a, b) => b.abandoned - a.abandoned);

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    totalForms: forms.length,
    forms,
  };
}

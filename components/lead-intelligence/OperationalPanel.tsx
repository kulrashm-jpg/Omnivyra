import React, { useCallback, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { DEFAULT_STATE_MODEL } from '@/lib/operations/operationalStateModel';
import {
  fetchOperationalOverlay,
  operationsAction,
  operationalOverlayKey,
  invalidateLeadIntelligenceReads,
  type OperationalOverlay,
} from './leadIntelligenceClient';

/**
 * W2b — Operational console for a single lead. Backend-neutral: it consumes the ONE
 * Operations API (read overlay + `action` mutations) that W2 already delivered — no
 * new endpoints, tables, business logic, auth, or workflow engine. Surfaces lifecycle
 * status, assignment, notes and tasks; every mutation flows through the single API.
 */
export default function OperationalPanel({ companyId, entityId }: { companyId: string; entityId: string }) {
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const { mutate: globalMutate } = useSWRConfig();

  // OPT-005 Phase 2C: the overlay is an SWR entry keyed on the exact request
  // URL (company + entity). No key without both ids — parity with the old
  // early return.
  const overlayKey = companyId && entityId ? operationalOverlayKey(companyId, entityId) : null;
  const { data, error: fetchError } = useSWR<OperationalOverlay>(
    overlayKey,
    () => fetchOperationalOverlay(companyId, entityId)
  );
  const overlay: OperationalOverlay | null = data ?? null;
  const error = opError ?? (fetchError ? (fetchError instanceof Error ? fetchError.message : 'Failed to load operational state') : null);

  const run = useCallback(async (action: string, payload: Record<string, unknown>) => {
    setBusy(true); setOpError(null);
    try {
      await operationsAction(companyId, action, { entity_id: entityId, ...payload });
      // Centralized invalidation: revalidate stats + leads + overlay for this
      // company. Revalidate-only (no optimistic write); not awaited so `busy`
      // releases as soon as the operation lands — same timing as the old
      // fire-and-forget load().
      void invalidateLeadIntelligenceReads(globalMutate, companyId);
    }
    catch (e) { setOpError(e instanceof Error ? e.message : 'Operation failed'); }
    finally { setBusy(false); }
  }, [companyId, entityId, globalMutate]);

  const input = 'rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none';

  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-900">Lead Operations</h3>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Status */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Status</p>
          <select
            className={`${input} mt-1 w-full`}
            value={overlay?.status ?? ''}
            disabled={busy}
            onChange={(e) => run('set_status', { status: e.target.value })}
          >
            <option value="" disabled>{overlay?.status ?? 'Set status…'}</option>
            {DEFAULT_STATE_MODEL.states.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </div>

        {/* Assignment */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Owner</p>
          <form className="mt-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = (new FormData(e.currentTarget).get('assignee') as string)?.trim(); if (v) run('assign', { assignee_id: v }); }}>
            <input name="assignee" className={`${input} flex-1`} placeholder={overlay?.assignee ?? 'Assign to user id…'} disabled={busy} />
            <button className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={busy}>Assign</button>
            {overlay?.assignee && <button type="button" onClick={() => run('unassign', {})} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600" disabled={busy}>Unassign</button>}
          </form>
        </div>
      </div>

      {/* Notes */}
      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</p>
        <form className="mt-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) { run('add_note', { body: note.trim() }); setNote(''); } }}>
          <input className={`${input} flex-1`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" disabled={busy} />
          <button className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={busy}>Add</button>
        </form>
        <ul className="mt-2 space-y-1">
          {(overlay?.notes ?? []).map((n) => (
            <li key={n.id} className="rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm text-gray-700">
              {n.pinned && <span className="mr-1 text-amber-500">📌</span>}{n.body}
              <span className="ml-2 text-xs text-gray-400">{new Date(n.created_at).toLocaleDateString()}</span>
            </li>
          ))}
          {overlay && overlay.notes.length === 0 && <li className="text-xs text-gray-400">No notes yet.</li>}
        </ul>
      </div>

      {/* Tasks */}
      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Tasks</p>
        <form className="mt-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (taskTitle.trim()) { run('create_task', { title: taskTitle.trim(), task_type: 'follow_up', priority: 'medium' }); setTaskTitle(''); } }}>
          <input className={`${input} flex-1`} value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Add a task…" disabled={busy} />
          <button className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={busy}>Add</button>
        </form>
        <ul className="mt-2 space-y-1">
          {(overlay?.tasks ?? []).map((t) => (
            <li key={t.id} className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm">
              <span className={t.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-700'}>{t.title} <span className="text-xs text-gray-400">· {t.task_type} · {t.priority}</span></span>
              {t.status !== 'done' && <button onClick={() => run('update_task', { task_id: t.id, status: 'done' })} className="text-xs font-medium text-emerald-600" disabled={busy}>Done</button>}
            </li>
          ))}
          {overlay && overlay.tasks.length === 0 && <li className="text-xs text-gray-400">No tasks yet.</li>}
        </ul>
      </div>
    </section>
  );
}

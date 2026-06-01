/**
 * ThreadCollaborationPanel — multi-user collaboration controls for a thread.
 *
 * Renders (a) the current assignee + an assign/unassign control populated from
 * the org's members, and (b) a chronological activity timeline (assigned /
 * replied / resolved / dropped, attributed to the acting user).
 *
 * Self-contained data fetching; mounted by ConversationView under the header.
 * Pure additive UI — no impact on the single-operator reply/like/resolve flow.
 */

import React from 'react';
import {
  assignEngagementThread,
  fetchCompanyMembers,
  fetchThreadEvents,
  type CompanyMember,
  type ThreadEvent,
} from '@/features/engagement/data/engagement.api';

export interface ThreadCollaborationPanelProps {
  organizationId: string;
  threadId: string;
  actingUserId?: string;
  assignedTo?: string | null;
  assigneeName?: string | null;
  /** Called after a successful (un)assignment so the parent can refresh the inbox. */
  onAssignmentChange?: () => void;
}

const EVENT_VERB: Record<string, string> = {
  assigned: 'assigned this thread',
  unassigned: 'unassigned this thread',
  replied: 'replied',
  resolved: 'marked resolved',
  ignored: 'dropped',
  unignored: 'restored',
};

function memberLabel(m: CompanyMember): string {
  return (m.name && m.name.trim()) || m.email || m.user_id;
}

function formatWhen(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '';
  }
}

export const ThreadCollaborationPanel = React.memo(function ThreadCollaborationPanel({
  organizationId,
  threadId,
  actingUserId,
  assignedTo,
  assigneeName,
  onAssignmentChange,
}: ThreadCollaborationPanelProps) {
  const [members, setMembers] = React.useState<CompanyMember[]>([]);
  const [events, setEvents] = React.useState<ThreadEvent[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    if (!organizationId) return;
    fetchCompanyMembers(organizationId)
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const loadEvents = React.useCallback(() => {
    if (!organizationId || !threadId) return;
    fetchThreadEvents({ organizationId, threadId })
      .then((list) => setEvents(list))
      .catch(() => {});
  }, [organizationId, threadId]);

  React.useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const applyAssignment = React.useCallback(
    async (assigneeUserId: string | null) => {
      if (!organizationId || !threadId) return;
      setBusy(true);
      setError(null);
      try {
        const res = await assignEngagementThread({ organizationId, threadId, assigneeUserId });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || 'Failed to update assignment');
        }
        onAssignmentChange?.();
        loadEvents();
      } catch (err) {
        setError((err as Error)?.message || 'Failed to update assignment');
      } finally {
        setBusy(false);
      }
    },
    [organizationId, threadId, onAssignmentChange, loadEvents]
  );

  const assignedToMe = !!actingUserId && assignedTo === actingUserId;

  return (
    <div className="border-b border-slate-200 bg-slate-50/60 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Assignee
        </span>
        <span className="text-sm font-medium text-slate-800">
          {assignedTo ? assigneeName || 'Assigned' : 'Unassigned'}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {actingUserId && !assignedToMe && (
            <button
              type="button"
              disabled={busy}
              onClick={() => applyAssignment(actingUserId)}
              className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
            >
              Assign to me
            </button>
          )}
          <select
            aria-label="Assign thread to teammate"
            disabled={busy}
            value={assignedTo || ''}
            onChange={(e) => applyAssignment(e.target.value ? e.target.value : null)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {memberLabel(m)}
                {actingUserId && m.user_id === actingUserId ? ' (me)' : ''}
              </option>
            ))}
          </select>
          {assignedTo && (
            <button
              type="button"
              disabled={busy}
              onClick={() => applyAssignment(null)}
              className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              Unassign
            </button>
          )}
        </div>
      </div>

      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}

      {events.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Activity ({events.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {events.map((ev) => {
              const verb = EVENT_VERB[ev.event_type] || ev.event_type;
              const who = ev.actor_name || 'Someone';
              const suffix =
                ev.event_type === 'assigned' && ev.assignee_name ? ` to ${ev.assignee_name}` : '';
              return (
                <li key={ev.id} className="flex items-baseline gap-2 text-xs text-slate-600">
                  <span className="font-medium text-slate-800">{who}</span>
                  <span>
                    {verb}
                    {suffix}
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-slate-400">
                    {formatWhen(ev.created_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
});

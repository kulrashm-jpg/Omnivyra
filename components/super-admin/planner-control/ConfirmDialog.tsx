/**
 * Modal confirmation dialog for destructive operator actions.
 *
 * Forces the operator to TYPE the literal `confirmPhrase` (e.g. the mode
 * being forced) before the confirm button is enabled. Prevents fat-finger
 * accidents on emergency controls.
 *
 * Reason capture: every confirmation collects a free-text reason that is
 * forwarded as `reason` to the API call. Required (min 4 chars).
 */

import React, { useEffect, useRef, useState } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Body paragraph describing what will happen. */
  description: React.ReactNode;
  /** Operator must type this exactly. Defaults to the empty string (no typing required). */
  confirmPhrase?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When non-null, the confirm button is disabled and the row shows the pending action. */
  pendingActionLabel?: string | null;
  /** Visual tone of the confirm button. */
  destructive?: boolean;
  /** Called with the operator-entered reason on confirm. */
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export default function ConfirmDialog(props: ConfirmDialogProps) {
  const {
    open, title, description, confirmPhrase,
    confirmLabel = 'Confirm', cancelLabel = 'Cancel',
    pendingActionLabel, destructive, onConfirm, onCancel,
  } = props;

  const [phrase, setPhrase] = useState('');
  const [reason, setReason] = useState('');
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setPhrase('');
      setReason('');
      // Focus the reason field after a tick.
      setTimeout(() => reasonRef.current?.focus(), 30);
    }
  }, [open]);

  if (!open) return null;

  const phraseOk = !confirmPhrase || phrase.trim() === confirmPhrase;
  const reasonOk = reason.trim().length >= 4;
  const canConfirm = phraseOk && reasonOk && !pendingActionLabel;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        </div>
        <div className="px-4 py-3 space-y-3">
          <div className="text-xs text-slate-700 whitespace-pre-wrap">{description}</div>
          {confirmPhrase && (
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-slate-500 font-medium mb-1">
                Type <code className="px-1 bg-slate-100 rounded">{confirmPhrase}</code> to confirm
              </label>
              <input
                type="text"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-slate-500 font-medium mb-1">
              Reason (recorded in audit trail) <span className="text-rose-500">*</span>
            </label>
            <textarea
              ref={reasonRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              placeholder="e.g. INC-1234 / pre-promotion soak"
            />
          </div>
        </div>
        <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
            disabled={!!pendingActionLabel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={!canConfirm}
            className={`px-3 py-1.5 rounded text-xs font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed ${
              destructive ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {pendingActionLabel ?? confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

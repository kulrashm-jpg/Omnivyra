/**
 * ReplyComposer — compose and send replies.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { recordEngagementEvent } from '@/lib/engagementTelemetry';

export interface ReplyComposerProps {
  threadId: string;
  messageId: string;
  platform: string;
  organizationId: string;
  value?: string;
  onChange?: (value: string) => void;
  onReplySent?: () => void;
  onRequestSuggestions?: () => void;
  disabled?: boolean;
  className?: string;
}

export const ReplyComposer = React.memo(function ReplyComposer({
  threadId,
  messageId,
  platform,
  organizationId,
  value: controlledValue,
  onChange,
  onReplySent,
  onRequestSuggestions,
  disabled = false,
  className = '',
}: ReplyComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [internalValue, setInternalValue] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = () => textareaRef.current?.focus();
    window.addEventListener('engagement:focus-reply', handler);
    return () => window.removeEventListener('engagement:focus-reply', handler);
  }, []);

  const isControlled = controlledValue !== undefined;
  const text = isControlled ? controlledValue : internalValue;
  const setText = isControlled ? (onChange ?? (() => {})) : setInternalValue;

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || disabled) return;

    setSending(true);
    setError(null);

    try {
      const res = await fetch('/api/engagement/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          organization_id: organizationId,
          thread_id: threadId,
          message_id: messageId,
          reply_text: trimmed,
          platform,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);

      setText('');
      if (!isControlled) setInternalValue('');
      void recordEngagementEvent('reply_sent', {
        organization_id: organizationId,
        thread_id: threadId,
        metadata: { platform },
      });
      onReplySent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reply');
    } finally {
      setSending(false);
    }
  }, [text, sending, disabled, organizationId, threadId, messageId, platform, onReplySent, isControlled, setText]);

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a reply..."
          rows={3}
          disabled={disabled}
          className="flex-1 rounded border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:cursor-not-allowed"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div>
          <button
            type="button"
            onClick={onRequestSuggestions}
            disabled={disabled}
            className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            AI suggestions
          </button>
        </div>
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || !text.trim() || sending}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});

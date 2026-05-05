import { Send } from 'lucide-react';
import type { IntelligenceState } from '../types';

export interface ReplyComposerProps {
  replyText: string;
  replying: boolean;
  replyError: string | null;
  replySuccess: boolean;
  intelligence: IntelligenceState;
  onChange: (text: string) => void;
  onSend: () => void;
}

export default function ReplyComposer({
  replyText,
  replying,
  replyError,
  replySuccess,
  intelligence,
  onChange,
  onSend,
}: ReplyComposerProps) {
  return (
    <div className="pt-2 space-y-2">
      <label className="block text-xs font-medium text-gray-700">Reply</label>
      <textarea
        rows={3}
        value={replyText}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type your reply..."
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {replyError && (
        <p className="text-xs text-red-600">{replyError}</p>
      )}
      {replySuccess && (
        <p className="text-xs text-green-600">Reply sent successfully.</p>
      )}
      {/*
        Hints block. Max 2, rendered as a tight bulleted list
        immediately below the reply input so they sit at the
        user's decision point. Hidden when no hints returned.
      */}
      {intelligence && intelligence.hints && intelligence.hints.length > 0 && (
        <ul className="text-xs text-gray-600 space-y-0.5 pt-1">
          {intelligence.hints.slice(0, 2).map((hint, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="text-gray-400 mt-0.5">•</span>
              <span>{hint}</span>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        disabled={!replyText.trim() || replying}
        onClick={onSend}
        className="w-full px-3 py-2 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
      >
        <Send className="h-4 w-4" />
        {replying ? 'Sending...' : 'Send Reply'}
      </button>
    </div>
  );
}

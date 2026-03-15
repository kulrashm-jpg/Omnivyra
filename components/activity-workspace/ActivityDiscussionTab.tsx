/**
 * Activity Discussion Tab — uses activity_messages API.
 * Displays thread: User name, Message, Time. Allows replies.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';

type Message = {
  id: string;
  message_text: string;
  created_by: string;
  created_by_name?: string;
  created_at: string;
  parent_message_id?: string | null;
};

export interface ActivityDiscussionTabProps {
  campaignId: string;
  activityId: string;
  currentUserId: string;
  fetchWithAuth: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function ActivityDiscussionTab({
  campaignId,
  activityId,
  currentUserId,
  fetchWithAuth,
}: ActivityDiscussionTabProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!activityId || !campaignId) return;
    setLoading(true);
    try {
      const r = await fetchWithAuth(
        `/api/activity/messages?activityId=${encodeURIComponent(activityId)}&campaignId=${encodeURIComponent(campaignId)}`
      );
      const data = r.ok ? await r.json() : [];
      setMessages(Array.isArray(data) ? data : []);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [activityId, campaignId, fetchWithAuth]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const r = await fetchWithAuth('/api/activity/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId, campaignId, message_text: text }),
      });
      if (r.ok) {
        const msg = await r.json();
        setMessages((prev) => [...prev, msg]);
        setInput('');
      }
    } finally {
      setSending(false);
    }
  };

  const rootMessages = messages.filter((m) => !m.parent_message_id);
  const repliesByParent: Record<string, Message[]> = {};
  messages.forEach((m) => {
    if (m.parent_message_id) {
      if (!repliesByParent[m.parent_message_id]) repliesByParent[m.parent_message_id] = [];
      repliesByParent[m.parent_message_id].push(m);
    }
  });

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center text-gray-500">
        Loading discussion...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <p className="text-sm text-gray-500">No messages yet. Start the conversation!</p>
        ) : (
          rootMessages.map((msg) => (
            <div key={msg.id} className="space-y-1">
              <div className={`flex ${msg.created_by === currentUserId ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 ${
                    msg.created_by === currentUserId ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-900'
                  }`}
                >
                  <div className="text-xs font-medium opacity-90">
                    {msg.created_by_name || 'User'} · {formatTime(msg.created_at)}
                  </div>
                  <div className="text-sm mt-0.5">{msg.message_text}</div>
                </div>
              </div>
              {(repliesByParent[msg.id] || []).map((reply) => (
                <div key={reply.id} className={`flex ${reply.created_by === currentUserId ? 'justify-end' : 'justify-start'} ml-4`}>
                  <div
                    className={`max-w-[75%] rounded-lg px-3 py-2 ${
                      reply.created_by === currentUserId ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-900'
                    }`}
                  >
                    <div className="text-xs font-medium opacity-90">
                      {reply.created_by_name || 'User'} · {formatTime(reply.created_at)}
                    </div>
                    <div className="text-sm mt-0.5">{reply.message_text}</div>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
        <div ref={scrollRef} />
      </div>
      <div className="p-4 border-t border-gray-200 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
          placeholder="Write message..."
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          disabled={sending}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="p-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          aria-label="Send"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

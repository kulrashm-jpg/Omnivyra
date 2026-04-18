/**
 * WhatsApp Conversations Inbox — /whatsapp/inbox
 * Shows inbound customer messages from WhatsApp (via engagement_threads).
 * Company admin & users can read messages and reply within the 24h window.
 *
 * APIs:
 *   GET /api/engagement/threads?platform=whatsapp&organization_id=
 *   GET /api/engagement/messages?thread_id=&organization_id=
 *   POST /api/engagement/reply  { organization_id, message_id, reply_text, platform }
 */

import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useCompanyContext } from '@/components/CompanyContext';
import {
  ArrowLeft,
  RefreshCw,
  Send,
  MessageSquare,
  Clock,
  CheckCircle,
} from 'lucide-react';

type Thread = {
  id: string;
  platform: string;
  platform_thread_id: string;
  created_at: string;
  updated_at: string;
  window_open?: boolean;
  window_expires_at?: string | null;
};

type Message = {
  id: string;
  thread_id: string;
  platform_message_id: string;
  direction: 'inbound' | 'outbound';
  content?: string | null;
  status?: string | null;
  created_at: string;
};

function windowTimeLeft(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

export default function WhatsAppInboxPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId || '';

  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySuccess, setReplySuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchThreads = useCallback(async () => {
    if (!companyId) return;
    setLoadingThreads(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        organization_id: companyId,
        platform: 'whatsapp',
        limit: '50',
      });
      const res = await fetch(`/api/engagement/threads?${params}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load conversations');
      setThreads(data.threads ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingThreads(false);
    }
  }, [companyId]);

  const fetchMessages = useCallback(async (threadId: string) => {
    if (!companyId) return;
    setLoadingMessages(true);
    try {
      const params = new URLSearchParams({
        organization_id: companyId,
        thread_id: threadId,
        limit: '100',
      });
      const res = await fetch(`/api/engagement/messages?${params}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load messages');
      setMessages(data.messages ?? []);
    } catch {
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, [companyId]);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  const selectThread = (thread: Thread) => {
    setSelectedThread(thread);
    setReplyText('');
    setReplyError(null);
    setReplySuccess(false);
    fetchMessages(thread.id);
  };

  const sendReply = async () => {
    if (!selectedThread || !replyText.trim() || !companyId) return;

    // Find the latest inbound message to reply to
    const lastInbound = [...messages].reverse().find((m) => m.direction === 'inbound');
    if (!lastInbound) {
      setReplyError('No inbound message found to reply to');
      return;
    }

    setReplying(true);
    setReplyError(null);
    setReplySuccess(false);
    try {
      const res = await fetch('/api/engagement/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          organization_id: companyId,
          thread_id: selectedThread.id,
          message_id: lastInbound.id,
          reply_text: replyText.trim(),
          platform: 'whatsapp',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Reply failed');
      setReplyText('');
      setReplySuccess(true);
      // Reload messages to show the outbound reply
      await fetchMessages(selectedThread.id);
    } catch (err: any) {
      setReplyError(err.message);
    } finally {
      setReplying(false);
    }
  };

  if (!companyId) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Select a company to view conversations
      </div>
    );
  }

  const windowLeft = selectedThread ? windowTimeLeft(selectedThread.window_expires_at) : null;
  const canReply = selectedThread?.window_open !== false && windowLeft !== 'Expired';

  return (
    <>
      <Head>
        <title>WhatsApp Inbox</title>
      </Head>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Link href="/whatsapp" className="text-gray-400 hover:text-gray-600">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Conversations Inbox</h1>
              <p className="text-xs text-gray-500">Reply to customer messages within the 24h window</p>
            </div>
          </div>
          <button
            onClick={fetchThreads}
            className="p-2 rounded border border-gray-300 hover:bg-gray-50"
          >
            <RefreshCw className={`h-4 w-4 text-gray-600 ${loadingThreads ? 'animate-spin' : ''}`} />
          </button>
        </header>

        {error && (
          <div className="mx-6 mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
            {error}
          </div>
        )}

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Thread list */}
          <aside className="w-72 bg-white border-r border-gray-200 flex flex-col shrink-0">
            <div className="p-3 border-b border-gray-100 text-sm text-gray-500">
              {loadingThreads ? 'Loading...' : `${threads.length} conversation${threads.length !== 1 ? 's' : ''}`}
            </div>
            <div className="flex-1 overflow-y-auto">
              {loadingThreads ? (
                <div className="p-8 text-center text-gray-500 text-sm">Loading conversations...</div>
              ) : threads.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">
                  <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  No conversations yet
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {threads.map((thread) => {
                    const timeLeft = windowTimeLeft(thread.window_expires_at);
                    const isSelected = selectedThread?.id === thread.id;
                    return (
                      <li
                        key={thread.id}
                        onClick={() => selectThread(thread)}
                        className={`p-3 cursor-pointer hover:bg-gray-50 ${isSelected ? 'bg-indigo-50' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-900 truncate">
                              {thread.platform_thread_id || thread.id.slice(0, 8)}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">
                              {new Date(thread.updated_at).toLocaleString()}
                            </div>
                          </div>
                          {timeLeft && (
                            <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                              timeLeft === 'Expired'
                                ? 'bg-gray-100 text-gray-500'
                                : 'bg-green-100 text-green-700'
                            }`}>
                              {timeLeft}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          {/* Message view */}
          {selectedThread ? (
            <main className="flex-1 flex flex-col min-w-0 bg-white">
              {/* Thread header */}
              <div className="px-4 py-3 border-b border-gray-200 shrink-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">
                    {selectedThread.platform_thread_id || selectedThread.id}
                  </span>
                  {windowLeft && (
                    <div className={`flex items-center gap-1 text-xs ${
                      windowLeft === 'Expired' ? 'text-gray-400' : 'text-green-600'
                    }`}>
                      <Clock className="h-3 w-3" />
                      {windowLeft === 'Expired' ? 'Reply window closed' : `Reply window: ${windowLeft}`}
                    </div>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {loadingMessages ? (
                  <div className="text-center text-gray-500 text-sm py-8">Loading messages...</div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-gray-400 text-sm py-8">No messages in this conversation</div>
                ) : (
                  messages.map((msg) => {
                    const isOutbound = msg.direction === 'outbound';
                    return (
                      <div key={msg.id} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-xs lg:max-w-md rounded-lg px-3 py-2 ${
                          isOutbound
                            ? 'bg-green-600 text-white'
                            : 'bg-gray-100 text-gray-900'
                        }`}>
                          <p className="text-sm whitespace-pre-wrap">{msg.content || '—'}</p>
                          <div className={`flex items-center gap-1 mt-1 text-xs ${
                            isOutbound ? 'text-green-200 justify-end' : 'text-gray-400'
                          }`}>
                            <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            {isOutbound && msg.status === 'read' && <CheckCircle className="h-3 w-3" />}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Reply input */}
              <div className="border-t border-gray-200 p-3 shrink-0">
                {!canReply ? (
                  <div className="text-sm text-gray-400 text-center py-2">
                    24-hour reply window has closed. You can only reply within 24h of the last inbound message.
                  </div>
                ) : (
                  <>
                    {replyError && (
                      <p className="text-xs text-red-600 mb-2">{replyError}</p>
                    )}
                    {replySuccess && (
                      <p className="text-xs text-green-600 mb-2">Reply sent.</p>
                    )}
                    <div className="flex items-end gap-2">
                      <textarea
                        rows={2}
                        value={replyText}
                        onChange={(e) => { setReplyText(e.target.value); setReplyError(null); setReplySuccess(false); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (replyText.trim()) sendReply();
                          }
                        }}
                        placeholder="Type a reply... (Enter to send, Shift+Enter for new line)"
                        className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                      <button
                        onClick={sendReply}
                        disabled={!replyText.trim() || replying}
                        className="p-2.5 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 shrink-0"
                        title="Send reply"
                      >
                        {replying
                          ? <RefreshCw className="h-4 w-4 animate-spin" />
                          : <Send className="h-4 w-4" />
                        }
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Replies are sent via WhatsApp Business API through the platform adapter
                    </p>
                  </>
                )}
              </div>
            </main>
          ) : (
            <main className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Select a conversation to view messages</p>
              </div>
            </main>
          )}
        </div>
      </div>
    </>
  );
}

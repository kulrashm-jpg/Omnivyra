/**
 * Floating Chat Panel — Campaign Collaboration Layer.
 * Draggable, resizable, closeable. Default: bottom-right.
 * Current user: blue bubble; teammate: gray bubble.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Send } from 'lucide-react';
import ContentRenderer from '../ContentRenderer';

export type CollaborationMessage = {
  id: string;
  message_text: string;
  created_by: string;
  created_by_name?: string;
  created_at: string;
  parent_message_id?: string | null;
};

export type FloatingChatPanelProps = {
  title: string;
  messages: CollaborationMessage[];
  loading?: boolean;
  currentUserId: string;
  onSend: (text: string, parentMessageId?: string | null) => Promise<void>;
  onClose: () => void;
  inputPlaceholder?: string;
  /** Optional: max height for resize; default 480 */
  maxHeight?: number;
  /** Optional: default width; default 360 */
  defaultWidth?: number;
  /** Optional: default height; default 400 */
  defaultHeight?: number;
};

const MIN_WIDTH = 280;
const MIN_HEIGHT = 200;
const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 400;
const MAX_HEIGHT = 560;

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

export default function FloatingChatPanel({
  title,
  messages,
  loading = false,
  currentUserId,
  onSend,
  onClose,
  inputPlaceholder = 'Write message...',
  maxHeight = MAX_HEIGHT,
  defaultWidth = DEFAULT_WIDTH,
  defaultHeight = DEFAULT_HEIGHT,
}: FloatingChatPanelProps) {
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window === 'undefined') return { x: 0, y: 0 };
    const margin = 24;
    return {
      x: Math.max(0, window.innerWidth - defaultWidth - margin),
      y: Math.max(0, window.innerHeight - defaultHeight - margin),
    };
  });
  const [size, setSize] = useState({ w: defaultWidth, h: defaultHeight });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ x: 0, y: 0, left: 0, top: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);


  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea')) return;
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, left: pos.x, top: pos.y };
  }, [pos]);

  const handleResizeDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
  }, [size]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setPos({
        x: Math.max(0, dragStart.current.left + dx),
        y: Math.max(0, dragStart.current.top + dy),
      });
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - resizeStart.current.x;
      const dy = e.clientY - resizeStart.current.y;
      setSize({
        w: Math.max(MIN_WIDTH, resizeStart.current.w + dx),
        h: Math.max(MIN_HEIGHT, Math.min(maxHeight, resizeStart.current.h + dy)),
      });
    };
    const onUp = () => setIsResizing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isResizing, maxHeight]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await onSend(text);
      setInput('');
    } finally {
      setSending(false);
    }
  }, [input, sending, onSend]);

  // Group messages by thread (root messages first, replies nested)
  const rootMessages = messages.filter((m) => !m.parent_message_id);
  const repliesByParent: Record<string, CollaborationMessage[]> = {};
  messages.forEach((m) => {
    if (m.parent_message_id) {
      if (!repliesByParent[m.parent_message_id]) repliesByParent[m.parent_message_id] = [];
      repliesByParent[m.parent_message_id].push(m);
    }
  });

  return (
    <div
      ref={panelRef}
      className="fixed z-[9999] flex flex-col rounded-xl border border-gray-200 bg-white shadow-2xl overflow-hidden"
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        pointerEvents: 'auto',
      }}
    >
      {/* Header — draggable */}
      <div
        className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200 cursor-move select-none"
        onMouseDown={handleMouseDown}
      >
        <span className="text-sm font-semibold text-gray-900 truncate">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-200 text-gray-600 hover:text-gray-900"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50/50 flex flex-col">
        {loading ? (
          <div className="text-sm text-gray-500 py-4">Loading messages...</div>
        ) : messages.length === 0 ? (
          <div className="text-sm text-gray-500 py-4">No messages yet. Start the conversation!</div>
        ) : (
          rootMessages.map((msg) => (
            <div key={msg.id} className="space-y-1">
              <div className={`flex ${msg.created_by === currentUserId ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 ${
                    msg.created_by === currentUserId
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 text-gray-900'
                  }`}
                >
                  <div className="text-xs font-medium opacity-90">
                    {msg.created_by_name || 'User'} · {formatTime(msg.created_at)}
                  </div>
                  <ContentRenderer content={msg.message_text} renderMode="comment" className="mt-0.5" textCls={msg.created_by === currentUserId ? '' : 'text-gray-900'} />
                </div>
              </div>
              {(repliesByParent[msg.id] || []).map((reply) => (
                <div key={reply.id} className={`flex ${reply.created_by === currentUserId ? 'justify-end' : 'justify-start'} ml-4`}>
                  <div
                    className={`max-w-[80%] rounded-xl px-3 py-2 ${
                      reply.created_by === currentUserId ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-900'
                    }`}
                  >
                    <div className="text-xs font-medium opacity-90">
                      {reply.created_by_name || 'User'} · {formatTime(reply.created_at)}
                    </div>
                    <ContentRenderer content={reply.message_text} renderMode="comment" className="mt-0.5" textCls={reply.created_by === currentUserId ? '' : 'text-gray-900'} />
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-200 bg-white flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
          placeholder={inputPlaceholder}
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          disabled={sending}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="p-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Send"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        style={{ marginBottom: 52 }}
        onMouseDown={handleResizeDown}
        aria-hidden
      >
        <div className="absolute right-1 bottom-1 w-2 h-2 border-r-2 border-b-2 border-gray-400 rounded-sm" />
      </div>
    </div>
  );
}

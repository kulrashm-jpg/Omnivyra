import React, { useMemo, useState } from 'react';
import type { ChatMessage } from './types';

type ChatPanelProps = {
  context: Record<string, unknown>;
  title?: string;
};

export default function ChatPanel({ context, title = 'Chat' }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');

  const contextPayload = useMemo(() => JSON.stringify(context), [context]);

  const sendMessage = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const message: ChatMessage = {
      id: `${Date.now()}`,
      role: 'user',
      message: trimmed,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, message]);
    setInput('');
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 h-full flex flex-col">
      <div className="text-sm font-semibold text-gray-900 mb-2">{title}</div>
      <div className="flex-1 overflow-y-auto border rounded-lg p-3 text-sm text-gray-700">
        {messages.length === 0 ? (
          <div className="text-sm text-gray-400">No chat history yet.</div>
        ) : (
          messages.map((entry) => (
            <div key={entry.id} className="mb-3">
              <div className="text-xs text-gray-500">
                {entry.role} • {new Date(entry.timestamp).toLocaleString()}
              </div>
              <div className="text-sm text-gray-800">{entry.message}</div>
            </div>
          ))
        )}
      </div>
      <div className="mt-3 space-y-2">
        <textarea
          className="border rounded-lg px-3 py-2 w-full h-24 text-sm"
          placeholder="Type a message..."
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <button
          onClick={sendMessage}
          className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm"
        >
          Send
        </button>
        <textarea className="hidden" readOnly value={contextPayload} aria-hidden="true" />
      </div>
    </div>
  );
}


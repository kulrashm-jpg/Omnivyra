import React from 'react';
import ChatVoiceButton from '../components/ChatVoiceButton';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

interface CompanyProfileChatPanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  messages: ChatMessage[];
  loading: boolean;
  input: string;
  onInputChange: (v: string) => void;
  onSubmit: () => void;
  /** Tailwind color prefix e.g. 'indigo', 'amber', 'emerald' */
  accentColor?: string;
  renderAssistantMessage?: (content: string) => React.ReactNode;
  extraActions?: React.ReactNode;
  disableBackdropClose?: boolean;
}

export function CompanyProfileChatPanel({
  open,
  onClose,
  title,
  messages,
  loading,
  input,
  onInputChange,
  onSubmit,
  accentColor = 'indigo',
  renderAssistantMessage,
  extraActions,
  disableBackdropClose = false,
}: CompanyProfileChatPanelProps) {
  if (!open) return null;

  const userBg = `ml-8 bg-${accentColor}-100 text-${accentColor}-900`;
  const btnCls = `px-4 py-2 bg-${accentColor}-600 text-white rounded-lg text-sm font-medium disabled:opacity-50`;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={() => !disableBackdropClose && onClose()}
        aria-hidden
      />
      <div className="relative ml-auto w-full max-w-md bg-white shadow-xl flex flex-col h-full">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 rounded"
            aria-label="Close"
            disabled={disableBackdropClose && loading}
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`rounded-lg p-3 text-sm ${
                msg.role === 'user' ? userBg : 'mr-8 bg-gray-100 text-gray-900'
              }`}
            >
              {msg.role === 'assistant' && renderAssistantMessage
                ? renderAssistantMessage(msg.content)
                : msg.content}
            </div>
          ))}
          {loading && (
            <div className="mr-8 rounded-lg p-3 text-sm bg-gray-100 text-gray-600">Thinking...</div>
          )}
        </div>
        <div className="p-4 border-t">
          <form
            onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
            className="flex gap-2 items-center"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder="Type your answer..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              disabled={loading}
            />
            <ChatVoiceButton
              onTranscription={(text) => onInputChange(text)}
              disabled={loading}
              context="company-profile"
              title={undefined}
            />
            <button type="submit" disabled={loading} className={btnCls}>
              Send
            </button>
            {extraActions}
          </form>
        </div>
      </div>
    </div>
  );
}

interface ProblemTransformationPanelProps {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  questions: string[];
  answers: string[];
  onAnswerChange: (index: number, value: string) => void;
  onSave: () => void;
}

export function ProblemTransformationPanel({
  open,
  onClose,
  loading,
  questions,
  answers,
  onAnswerChange,
  onSave,
}: ProblemTransformationPanelProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={() => !loading && onClose()}
        aria-hidden
      />
      <div className="relative ml-auto w-full max-w-lg bg-white shadow-xl flex flex-col h-full">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">Fill Problem &amp; Transformation with AI</h3>
          <button
            type="button"
            onClick={() => !loading && onClose()}
            className="p-2 text-gray-500 hover:text-gray-700 rounded"
            aria-label="Close"
            disabled={loading}
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && questions.length === 0 ? (
            <div className="text-sm text-gray-500">Loading questions...</div>
          ) : (
            questions.map((q, i) => (
              <div key={i} className="space-y-1">
                <label className="text-sm font-medium text-gray-700">{q}</label>
                <textarea
                  value={answers[i] ?? ''}
                  onChange={(e) => onAnswerChange(i, e.target.value)}
                  placeholder="Your answer..."
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  disabled={loading}
                />
              </div>
            ))
          )}
        </div>
        <div className="p-4 border-t">
          <button
            type="button"
            onClick={onSave}
            disabled={loading || questions.length === 0}
            className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save (AI will filter & structure)'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface CreateCompanyModalProps {
  open: boolean;
  onClose: () => void;
  form: { name: string; website: string; industry: string };
  onFormChange: (updates: Partial<{ name: string; website: string; industry: string }>) => void;
  onSubmit: () => void;
  loading: boolean;
  error: string | null;
}

export function CreateCompanyModal({
  open,
  onClose,
  form,
  onFormChange,
  onSubmit,
  loading,
  error,
}: CreateCompanyModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Create new company</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => onFormChange({ name: e.target.value })}
              placeholder="Acme Inc."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
            <input
              type="text"
              value={form.website}
              onChange={(e) => onFormChange({ website: e.target.value })}
              placeholder="acme.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Industry (optional)</label>
            <input
              type="text"
              value={form.industry}
              onChange={(e) => onFormChange({ industry: e.target.value })}
              placeholder="SaaS"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={loading}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Creating…' : 'Create company'}
          </button>
        </div>
      </div>
    </div>
  );
}

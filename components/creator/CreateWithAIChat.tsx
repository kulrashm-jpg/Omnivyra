import React from 'react';
import { Sparkles, Send, X, Check } from 'lucide-react';
import { color, radius, shadow, space, fontSize, fontWeight } from '../../lib/platform/ui';

/**
 * "Create with AI" — a conversational brief builder. The user chats to work out
 * their brief; each turn the assistant replies and returns a running structured
 * draft, which the user can push into the same fields "Suggest with AI" fills.
 *
 * Self-contained: it owns the chat state + API calls and hands the finished
 * brief back via onApply(patch). The host only opens/closes it and merges the
 * patch into its brief — so it stays decoupled from the surrounding workspace.
 */

export interface CreateWithAIBrief {
  freeText: string;
  audience: string;
  tone: string;
  cta: string;
  offer: string;
}

interface ChatMessage { role: 'user' | 'assistant'; content: string }

interface Props {
  assetFamily: string;
  assetLabel: string;
  goal?: string;
  companyId?: string;
  initialBrief?: Partial<CreateWithAIBrief>;
  onApply: (brief: CreateWithAIBrief) => void;
  onClose: () => void;
}

const EMPTY: CreateWithAIBrief = { freeText: '', audience: '', tone: '', cta: '', offer: '' };

const FIELD_LABELS: [keyof CreateWithAIBrief, string][] = [
  ['freeText', 'Brief'],
  ['audience', 'Audience'],
  ['tone', 'Tone'],
  ['cta', 'Call to action'],
  ['offer', 'Offer / product'],
];

export default function CreateWithAIChat({
  assetFamily, assetLabel, goal, companyId, initialBrief, onApply, onClose,
}: Props) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: `Let’s build your ${assetLabel} brief together. Tell me what you want to promote${goal ? ` — building on “${goal}”` : ''}, and I’ll shape the audience, tone, CTA, and offer with you.`,
    },
  ]);
  const [draft, setDraft] = React.useState<CreateWithAIBrief>({ ...EMPTY, ...(initialBrief ?? {}) });
  const [input, setInput] = React.useState(String(initialBrief?.freeText ?? ''));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const hasDraft = Object.values(draft).some((v) => v.trim());

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch('/api/creator-templates/chat-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_family: assetFamily,
          goal: goal ?? '',
          company_id: companyId,
          current_brief: draft,
          // Only the actual turns (the greeting is UI-only).
          messages: nextMessages.filter((_, i) => i > 0).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error(d?.error || `Assistant failed (${resp.status})`);
      }
      const data = await resp.json();
      const reply = typeof data?.reply === 'string' ? data.reply : 'Updated your draft.';
      if (data?.brief && typeof data.brief === 'object') {
        setDraft((prev) => ({
          freeText: String(data.brief.freeText || prev.freeText),
          audience: String(data.brief.audience || prev.audience),
          tone: String(data.brief.tone || prev.tone),
          cta: String(data.brief.cta || prev.cta),
          offer: String(data.brief.offer || prev.offer),
        }));
      }
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assistant failed');
    } finally {
      setBusy(false);
    }
  };

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1300,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: space.lg,
  };
  const panel: React.CSSProperties = {
    width: 'min(720px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column',
    background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.lg, boxShadow: shadow.lg,
  };
  const head: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: `${space.md}px ${space.lg}px`, borderBottom: `1px solid ${color.border}`,
  };
  const bubble = (role: 'user' | 'assistant'): React.CSSProperties => ({
    alignSelf: role === 'user' ? 'flex-end' : 'flex-start',
    maxWidth: '80%', padding: `${space.sm}px ${space.md}px`, borderRadius: radius.md, fontSize: fontSize.sm,
    background: role === 'user' ? color.primary[600] : color.surface2,
    color: role === 'user' ? color.onPrimary : color.text,
    border: role === 'user' ? 'none' : `1px solid ${color.border}`, whiteSpace: 'pre-wrap',
  });

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={head}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: space.xs, fontWeight: fontWeight.bold }}>
            <Sparkles size={16} /> Create with AI · {assetLabel} brief
          </span>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: color.textSubtle }}>
            <X size={18} />
          </button>
        </div>

        {/* Conversation */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: space.lg, display: 'flex', flexDirection: 'column', gap: space.sm }}>
          {messages.map((m, i) => <div key={i} style={bubble(m.role)}>{m.content}</div>)}
          {busy ? <div style={{ ...bubble('assistant'), opacity: 0.6 }}>Thinking…</div> : null}
          {error ? <div style={{ fontSize: fontSize.xs, color: color.danger }}>{error}</div> : null}
        </div>

        {/* Running draft */}
        {hasDraft ? (
          <div style={{ borderTop: `1px solid ${color.border}`, padding: `${space.sm}px ${space.lg}px`, background: color.surface2 }}>
            <div style={{ fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: color.textSubtle, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
              Draft brief so far
            </div>
            <div style={{ display: 'grid', gap: 4 }}>
              {FIELD_LABELS.map(([k, lbl]) => draft[k].trim() ? (
                <div key={k} style={{ fontSize: fontSize.sm, lineHeight: 1.4 }}>
                  <span style={{ color: color.textSubtle, fontWeight: fontWeight.semibold }}>{lbl}: </span>
                  <span>{draft[k]}</span>
                </div>
              ) : null)}
            </div>
          </div>
        ) : null}

        {/* Composer */}
        <div style={{ borderTop: `1px solid ${color.border}`, padding: space.md, display: 'flex', gap: space.sm, alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={2}
            placeholder="Describe your idea or answer the question… (Enter to send)"
            style={{ flex: 1, resize: 'vertical', borderRadius: radius.md, border: `1px solid ${color.border}`, padding: `${space.sm}px ${space.md}px`, fontSize: fontSize.sm, color: color.text }}
          />
          <button type="button" onClick={send} disabled={busy || !input.trim()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: space.xs, background: color.surface, color: color.primary[600], border: `1px solid ${color.primary[600]}`, borderRadius: radius.md, padding: `${space.sm}px ${space.md}px`, cursor: busy || !input.trim() ? 'default' : 'pointer', fontWeight: fontWeight.semibold, fontSize: fontSize.sm, opacity: busy || !input.trim() ? 0.6 : 1 }}>
            <Send size={14} /> Send
          </button>
        </div>

        {/* Apply */}
        <div style={{ borderTop: `1px solid ${color.border}`, padding: space.md, display: 'flex', justifyContent: 'flex-end', gap: space.sm }}>
          <button type="button" onClick={onClose}
            style={{ background: 'transparent', border: `1px solid ${color.border}`, borderRadius: radius.md, padding: `${space.sm}px ${space.lg}px`, cursor: 'pointer', fontWeight: fontWeight.semibold, fontSize: fontSize.sm, color: color.text }}>
            Cancel
          </button>
          <button type="button" onClick={() => onApply(draft)} disabled={!hasDraft}
            style={{ display: 'inline-flex', alignItems: 'center', gap: space.xs, background: color.primary[600], color: color.onPrimary, border: 'none', borderRadius: radius.md, padding: `${space.sm}px ${space.lg}px`, cursor: hasDraft ? 'pointer' : 'default', fontWeight: fontWeight.bold, fontSize: fontSize.sm, opacity: hasDraft ? 1 : 0.5 }}>
            <Check size={14} /> Use this brief
          </button>
        </div>
      </div>
    </div>
  );
}

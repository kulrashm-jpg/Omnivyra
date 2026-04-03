'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { BlockType } from '../../../lib/blog/blockTypes';
import { BLOCK_GROUPS, BLOCK_LABELS, BLOCK_DESCRIPTIONS } from '../../../lib/blog/blockTypes';

type Props = {
  onSelect: (type: BlockType) => void;
};

const BLOCK_ICONS: Record<BlockType, string> = {
  paragraph:     '¶',
  heading:       'H',
  key_insights:  '💡',
  callout:       '📌',
  quote:         '"',
  image:         '🖼',
  media:         '▶',
  divider:       '—',
  list:          '☰',
  references:    '📚',
  internal_link: '🔗',
  summary:       '✦',
};

// ── AI keyword → block type map ───────────────────────────────────────────────

type AISuggestion = { type: BlockType; icon: string; hint: string };

const AI_KEYWORD_MAP: { keywords: string[]; type: BlockType; hint: string }[] = [
  {
    keywords: ['image', 'photo', 'picture', 'screenshot', 'visual', 'graphic', 'figure', 'illustration', 'banner'],
    type: 'image',
    hint: 'Full-width image with caption and alt text',
  },
  {
    keywords: ['quote', 'said', 'according to', 'cited', 'testimony', 'expert says', 'attributed', 'pull quote'],
    type: 'quote',
    hint: 'Pull quote with optional attribution',
  },
  {
    keywords: ['list', 'steps', 'bullet', 'items', 'checklist', 'numbered', 'options', 'points', 'enumerate', 'outline'],
    type: 'list',
    hint: 'Bullet or numbered list with nested items',
  },
  {
    keywords: ['heading', 'title', 'section', 'h2', 'h3', 'subtitle', 'chapter', 'subheading'],
    type: 'heading',
    hint: 'H2 or H3 section heading with anchor',
  },
  {
    keywords: ['insight', 'key', 'takeaway', 'highlight', 'findings', 'key points', 'summary points', 'callout facts'],
    type: 'key_insights',
    hint: 'Key insights card with numbered decision points',
  },
  {
    keywords: ['warning', 'caution', 'alert', 'tip', 'note', 'important', 'callout', 'advice', 'notice', 'box'],
    type: 'callout',
    hint: 'Highlighted callout — insight / note / warning',
  },
  {
    keywords: ['video', 'youtube', 'embed', 'spotify', 'podcast', 'media', 'external link', 'link card', 'url card', 'record'],
    type: 'media',
    hint: 'Embed YouTube, Spotify, or external link card',
  },
  {
    keywords: ['summary', 'conclusion', 'wrap up', 'wrap-up', 'bottom line', 'tldr', 'tl;dr', 'final thoughts', 'ending'],
    type: 'summary',
    hint: 'End-of-article dark summary card',
  },
  {
    keywords: ['related', 'internal link', 'read more', 'link to', 'another article', 'blog post', 'cross link', 'further reading'],
    type: 'internal_link',
    hint: 'Linked card to another blog post',
  },
  {
    keywords: ['reference', 'source', 'citation', 'bibliography', 'footnote', 'sources cited'],
    type: 'references',
    hint: 'Numbered auto-linked references list',
  },
  {
    keywords: ['divider', 'separator', 'break', 'section break', 'line', 'hr', 'split', 'pause', 'ornament'],
    type: 'divider',
    hint: 'Visual break — subtle line or ornamental section break',
  },
  {
    keywords: ['paragraph', 'text', 'write', 'content', 'body', 'prose', 'describe', 'explain', 'copy'],
    type: 'paragraph',
    hint: 'Rich text with bold, italic, links, lists',
  },
];

const AI_EXAMPLES = [
  'add an image of the dashboard',
  'key takeaways from the report',
  'warning about pricing limits',
  'expert quote about AI trends',
  'related article link',
];

function getAISuggestions(query: string): AISuggestion[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const scored = AI_KEYWORD_MAP.map((entry) => {
    const exact  = entry.keywords.filter((kw) => q.includes(kw)).length;
    const prefix = entry.keywords.filter((kw) => kw.startsWith(q.split(' ')[0])).length;
    const fuzzy  = entry.keywords.filter((kw) => kw.includes(q) || q.split(' ').some((w) => w.length > 3 && kw.includes(w))).length;
    return { ...entry, score: exact * 4 + prefix * 2 + fuzzy };
  }).filter((e) => e.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, 4).map((e) => ({
    type: e.type,
    icon: BLOCK_ICONS[e.type],
    hint: e.hint,
  }));
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BlockPicker({ onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'browse' | 'ai'>('browse');
  const [aiQuery, setAiQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const aiInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Auto-focus AI input when tab switches
  useEffect(() => {
    if (tab === 'ai' && open) setTimeout(() => aiInputRef.current?.focus(), 60);
  }, [tab, open]);

  const handleSelect = (type: BlockType) => {
    onSelect(type);
    setOpen(false);
    setAiQuery('');
    setTab('browse');
  };

  const aiSuggestions = getAISuggestions(aiQuery);

  return (
    <div ref={ref} className="relative flex justify-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group flex items-center gap-1.5 rounded-full border border-dashed border-gray-300 bg-white px-4 py-2 text-xs font-medium text-gray-500 shadow-sm transition-all hover:border-[#0A66C2] hover:text-[#0A66C2] hover:shadow-md"
      >
        <Plus className="h-3.5 w-3.5" />
        Add block
      </button>

      {open && (
        <div
          className="absolute top-full left-1/2 z-50 mt-2 -translate-x-1/2 rounded-2xl border border-gray-100 bg-white shadow-2xl ring-1 ring-black/5"
          style={{ width: '360px' }}
        >
          {/* Tab bar */}
          <div className="flex border-b border-gray-100 rounded-t-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => setTab('browse')}
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
                tab === 'browse'
                  ? 'bg-white text-[#0A66C2] border-b-2 border-[#0A66C2]'
                  : 'bg-gray-50 text-gray-500 hover:text-gray-700'
              }`}
            >
              📋 Browse Blocks
            </button>
            <button
              type="button"
              onClick={() => setTab('ai')}
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
                tab === 'ai'
                  ? 'bg-white text-purple-600 border-b-2 border-purple-500'
                  : 'bg-gray-50 text-gray-500 hover:text-gray-700'
              }`}
            >
              ✨ AI Suggest
            </button>
          </div>

          {/* Browse tab */}
          {tab === 'browse' && (
            <div className="p-3 space-y-3 max-h-80 overflow-y-auto">
              {BLOCK_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="px-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    {group.types.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => handleSelect(type)}
                        className="flex items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[#F5F9FF] group/item"
                      >
                        <span className="mt-0.5 text-base leading-none">{BLOCK_ICONS[type]}</span>
                        <span>
                          <span className="block text-xs font-semibold text-[#0B1F33] group-hover/item:text-[#0A66C2]">
                            {BLOCK_LABELS[type]}
                          </span>
                          <span className="block text-[10px] text-gray-400 leading-tight mt-0.5">
                            {BLOCK_DESCRIPTIONS[type]}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* AI Suggest tab */}
          {tab === 'ai' && (
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-500 leading-relaxed">
                Describe the section you want to add — AI will suggest the right block type.
              </p>

              <input
                ref={aiInputRef}
                type="text"
                value={aiQuery}
                onChange={(e) => setAiQuery(e.target.value)}
                placeholder={'e.g. "add an image", "key takeaways", "expert quote"'}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#3D4F61] focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-300"
              />

              {/* Suggestions */}
              {aiQuery.trim() && aiSuggestions.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Suggested</p>
                  {aiSuggestions.map((s, i) => (
                    <button
                      key={s.type}
                      type="button"
                      onClick={() => handleSelect(s.type)}
                      className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-purple-50 ${
                        i === 0 ? 'bg-purple-50 ring-1 ring-purple-200' : ''
                      }`}
                    >
                      <span className="text-xl leading-none shrink-0">{s.icon}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#0B1F33]">{BLOCK_LABELS[s.type]}</p>
                        <p className="text-[11px] text-gray-500 truncate">{s.hint}</p>
                      </div>
                      {i === 0 && (
                        <span className="ml-auto shrink-0 text-[10px] bg-purple-100 text-purple-700 font-semibold rounded-full px-2 py-0.5">
                          Best match
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* No match */}
              {aiQuery.trim() && aiSuggestions.length === 0 && (
                <div className="text-center py-3">
                  <p className="text-xs text-gray-400">No strong match found.</p>
                  <button
                    type="button"
                    onClick={() => setTab('browse')}
                    className="mt-1 text-xs text-[#0A66C2] hover:underline"
                  >
                    Browse all block types →
                  </button>
                </div>
              )}

              {/* Examples when query is empty */}
              {!aiQuery.trim() && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Try asking for…</p>
                  {AI_EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => setAiQuery(ex)}
                      className="block w-full text-left rounded-lg bg-gray-50 hover:bg-purple-50 px-3 py-1.5 text-xs text-gray-600 transition-colors"
                    >
                      &ldquo;{ex}&rdquo;
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

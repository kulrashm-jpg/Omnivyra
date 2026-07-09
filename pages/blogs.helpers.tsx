/**
 * Shared helper components and utilities for BlogsPage.
 */

import React, { useRef, useEffect } from 'react';
import { sanitizeHtml } from '../lib/security/htmlSanitizer';
import {
  Bold, Italic, Underline, List, ListOrdered, Quote,
  Heading1, Heading2, Link2, Undo2,
  Lightbulb, TrendingUp, Rocket, BarChart2, Network, BookOpen,
} from 'lucide-react';

// ── Utility functions ─────────────────────────────────────────────────────────

export function wordCount(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
}

export function fmtDate(d: string | null) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Toolbar button ─────────────────────────────────────────────────────────────

export function TBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      className="p-1.5 rounded hover:bg-gray-200 text-gray-600 hover:text-gray-900 transition-colors"
    >
      {children}
    </button>
  );
}

// ── Rich Text Editor ──────────────────────────────────────────────────────────

export function RichEditor({ initialContent, onChange }: { initialContent: string; onChange: (html: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current) {
      // HARDEN-003: stored HTML is sanitized before entering the editor DOM —
      // a stored <img onerror> payload must not execute on edit.
      editorRef.current.innerHTML = sanitizeHtml(initialContent, 'rich');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cmd(command: string, value?: string) {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  }

  function insertLink() {
    const url = window.prompt('Enter URL:');
    if (url) cmd('createLink', url);
  }

  return (
    <div className="flex flex-col border border-gray-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-indigo-300 focus-within:border-indigo-400">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 flex-wrap px-2 py-1.5 bg-gray-50 border-b border-gray-200">
        <TBtn title="Bold" onClick={() => cmd('bold')}><Bold className="h-4 w-4" /></TBtn>
        <TBtn title="Italic" onClick={() => cmd('italic')}><Italic className="h-4 w-4" /></TBtn>
        <TBtn title="Underline" onClick={() => cmd('underline')}><Underline className="h-4 w-4" /></TBtn>
        <span className="w-px h-5 bg-gray-300 mx-1" />
        <TBtn title="Heading 1" onClick={() => cmd('formatBlock', '<h1>')}><Heading1 className="h-4 w-4" /></TBtn>
        <TBtn title="Heading 2" onClick={() => cmd('formatBlock', '<h2>')}><Heading2 className="h-4 w-4" /></TBtn>
        <TBtn title="Paragraph" onClick={() => cmd('formatBlock', '<p>')}><span className="text-xs font-bold px-0.5">P</span></TBtn>
        <span className="w-px h-5 bg-gray-300 mx-1" />
        <TBtn title="Bullet list" onClick={() => cmd('insertUnorderedList')}><List className="h-4 w-4" /></TBtn>
        <TBtn title="Numbered list" onClick={() => cmd('insertOrderedList')}><ListOrdered className="h-4 w-4" /></TBtn>
        <TBtn title="Blockquote" onClick={() => cmd('formatBlock', '<blockquote>')}><Quote className="h-4 w-4" /></TBtn>
        <TBtn title="Insert link" onClick={insertLink}><Link2 className="h-4 w-4" /></TBtn>
        <span className="w-px h-5 bg-gray-300 mx-1" />
        <TBtn title="Clear formatting" onClick={() => cmd('removeFormat')}><Undo2 className="h-4 w-4" /></TBtn>
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange(editorRef.current?.innerHTML || '')}
        className="min-h-[420px] p-5 focus:outline-none text-gray-800 leading-relaxed text-base
          [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:text-gray-900
          [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:mb-3 [&_h2]:text-gray-900
          [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:mb-2
          [&_p]:mb-3 [&_p]:text-gray-700
          [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-3 [&_ul]:space-y-1
          [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-3 [&_ol]:space-y-1
          [&_blockquote]:border-l-4 [&_blockquote]:border-indigo-300 [&_blockquote]:pl-4
          [&_blockquote]:italic [&_blockquote]:text-gray-500 [&_blockquote]:mb-3
          [&_a]:text-indigo-600 [&_a]:underline"
      />
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

type BlogStatus = 'draft' | 'published' | 'failed';

export function StatusBadge({ status }: { status: BlogStatus }) {
  const map: Record<BlogStatus, string> = {
    draft: 'bg-amber-100 text-amber-700',
    published: 'bg-emerald-100 text-emerald-700',
    failed: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${map[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const TAB_LABELS = [
  { id: 'recommendations', label: 'What to Write',   icon: Lightbulb  },
  { id: 'performance',     label: 'Performance',     icon: TrendingUp },
  { id: 'growth',          label: 'Growth Engine',   icon: Rocket     },
  { id: 'coverage',        label: 'Topic Coverage',  icon: BarChart2  },
  { id: 'graph',           label: 'Knowledge Graph', icon: Network    },
  { id: 'series',          label: 'Series',          icon: BookOpen   },
] as const;

export type TabId = typeof TAB_LABELS[number]['id'];

export const PRIORITY_COLOURS: Record<string, string> = {
  high:   'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low:    'bg-gray-100 text-gray-600',
};

export const TYPE_COLOURS: Record<string, string> = {
  write:    'bg-[#0A66C2]/10 text-[#0A66C2]',
  optimize: 'bg-violet-100 text-violet-700',
  link:     'bg-teal-100 text-teal-700',
  series:   'bg-orange-100 text-orange-700',
};


export interface Blog {
  id: string; company_id: string; title: string; content: string;
  status: BlogStatus; integration_id: string | null; external_id: string | null;
  published_at: string | null; created_at: string; updated_at: string;
  slug: string | null; excerpt: string | null; featured_image_url: string | null;
  category: string | null; tags: string[]; seo_meta_title: string | null;
  seo_meta_description: string | null; is_featured: boolean;
  angle_type?: string | null;
  views_count?: number;
  likes_count?: number;
  has_summary?: boolean;
  internal_links?: number;
  references_count?: number;
}
export default function BlogsHelpersPage() {
  return null;
}

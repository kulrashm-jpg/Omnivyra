/**
 * RichTextEditor — TipTap-powered WYSIWYG editor for platform content.
 *
 * Stores content as HTML internally. Exposes `onChange(html)` so callers
 * can store the HTML in state and later convert to plain text for posting.
 *
 * Toolbar: Bold · Italic · Underline · H1/H2/H3 · Bullets · Ordered list
 *          Align L/C/R/Justify · Indent/Outdent · Font family · Font size
 *          Blockquote · Clear formatting
 */

import React, { useEffect } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  Heading1, Heading2, Heading3,
  List, ListOrdered, Quote,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Indent as IndentIcon, Outdent as OutdentIcon,
  Undo, Redo, RemoveFormatting,
} from 'lucide-react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import Underline from '@tiptap/extension-underline';
import Color from '@tiptap/extension-color';
import { Extension } from '@tiptap/core';

// ─── Custom FontSize extension ────────────────────────────────────────────────
const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() {
    return { types: ['textStyle'] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }: any) =>
          chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }: any) =>
          chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    } as any;
  },
});

// ─── Custom Indent extension ──────────────────────────────────────────────────
const Indent = Extension.create({
  name: 'indent',
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { state } = this.editor;
        if (state.selection.$from.node().type.name === 'listItem') return false;
        this.editor.chain().insertContent('    ').run();
        return true;
      },
    };
  },
  addCommands() {
    return {
      indent:
        () =>
        ({ chain }: any) =>
          chain().sinkListItem('listItem').run(),
      outdent:
        () =>
        ({ chain }: any) =>
          chain().liftListItem('listItem').run(),
    } as any;
  },
});

// ─── Helper: convert markdown-like text to HTML for initial load ──────────────
export function markdownToHtml(text: string): string {
  if (!text) return '';
  // Already HTML — return as-is
  if (/^<[a-z][\s\S]*>/i.test(text.trim())) return text;
  return text
    .split('\n\n')
    .map((para) => {
      const escaped = para
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/_([^_]+)_/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
      return `<p>${escaped}</p>`;
    })
    .join('');
}

// ─── Helper: convert HTML to plain text for posting ──────────────────────────
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/p>/gi, '')
    .replace(/<p>/gi, '')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<\/ul>/gi, '\n')
    .replace(/<ul>/gi, '')
    .replace(/<\/ol>/gi, '\n')
    .replace(/<ol>/gi, '')
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Toolbar button ───────────────────────────────────────────────────────────
function ToolBtn({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      disabled={disabled}
      title={title}
      className={[
        'flex items-center justify-center w-7 h-7 rounded text-xs transition-colors',
        active
          ? 'bg-indigo-100 text-indigo-700 font-semibold'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-5 bg-gray-200 mx-0.5" />;
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────
function Toolbar({ editor }: { editor: Editor }) {
  const FONT_FAMILIES = [
    { label: 'Default', value: '' },
    { label: 'Sans-serif', value: 'Inter, Arial, sans-serif' },
    { label: 'Serif', value: 'Georgia, serif' },
    { label: 'Mono', value: 'ui-monospace, monospace' },
  ];

  const FONT_SIZES = [
    { label: 'Small', value: '12px' },
    { label: 'Normal', value: '14px' },
    { label: 'Large', value: '18px' },
    { label: 'XL', value: '22px' },
    { label: 'XXL', value: '28px' },
  ];

  const currentFamily = (editor.getAttributes('textStyle') as any).fontFamily || '';
  const currentSize = (editor.getAttributes('textStyle') as any).fontSize || '';

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 bg-gray-50 rounded-t-lg">
      {/* Font family */}
      <select
        value={currentFamily}
        onChange={(e) => {
          if (e.target.value) {
            editor.chain().focus().setFontFamily(e.target.value).run();
          } else {
            editor.chain().focus().unsetFontFamily().run();
          }
        }}
        className="h-7 rounded border border-gray-200 bg-white text-xs text-gray-700 px-1 cursor-pointer focus:outline-none focus:border-indigo-300"
        title="Font family"
      >
        {FONT_FAMILIES.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>

      {/* Font size */}
      <select
        value={currentSize}
        onChange={(e) => {
          if (e.target.value) {
            (editor.chain().focus() as any).setFontSize(e.target.value).run();
          } else {
            (editor.chain().focus() as any).unsetFontSize().run();
          }
        }}
        className="h-7 rounded border border-gray-200 bg-white text-xs text-gray-700 px-1 cursor-pointer focus:outline-none focus:border-indigo-300"
        title="Font size"
      >
        <option value="">Size</option>
        {FONT_SIZES.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>

      <Divider />

      {/* Headings */}
      <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1">
        <Heading1 className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">
        <Heading2 className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3">
        <Heading3 className="h-3.5 w-3.5" />
      </ToolBtn>

      <Divider />

      {/* Inline marks */}
      <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold (Ctrl+B)">
        <Bold className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic (Ctrl+I)">
        <Italic className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline (Ctrl+U)">
        <UnderlineIcon className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolBtn>

      <Divider />

      {/* Lists */}
      <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
        <List className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Blockquote / Quote">
        <Quote className="h-3.5 w-3.5" />
      </ToolBtn>

      <Divider />

      {/* Alignment */}
      <ToolBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left">
        <AlignLeft className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Center">
        <AlignCenter className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align right">
        <AlignRight className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justify">
        <AlignJustify className="h-3.5 w-3.5" />
      </ToolBtn>

      <Divider />

      {/* Indent / Outdent */}
      <ToolBtn onClick={() => editor.chain().focus().sinkListItem('listItem').run()} disabled={!editor.can().sinkListItem('listItem')} title="Indent">
        <IndentIcon className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().liftListItem('listItem').run()} disabled={!editor.can().liftListItem('listItem')} title="Outdent">
        <OutdentIcon className="h-3.5 w-3.5" />
      </ToolBtn>

      <Divider />

      {/* Undo / Redo */}
      <ToolBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo (Ctrl+Z)">
        <Undo className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo (Ctrl+Y)">
        <Redo className="h-3.5 w-3.5" />
      </ToolBtn>

      <Divider />

      {/* Clear formatting */}
      <ToolBtn onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title="Clear formatting">
        <RemoveFormatting className="h-3.5 w-3.5" />
      </ToolBtn>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minHeight?: string;
  className?: string;
  /** Border color variant when content is finalized */
  finalized?: boolean;
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write your content here…',
  disabled = false,
  minHeight = '120px',
  className = '',
  finalized = false,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      FontFamily,
      FontSize,
      Underline,
      Color,
      Indent,
    ],
    content: markdownToHtml(value),
    editable: !disabled,
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
  });

  // Sync external value changes (e.g. when AI generates new content)
  const prevValueRef = React.useRef(value);
  useEffect(() => {
    if (!editor) return;
    if (value === prevValueRef.current) return;
    prevValueRef.current = value;
    // Only update if different from current editor content
    const currentHtml = editor.getHTML();
    const incomingHtml = markdownToHtml(value);
    if (currentHtml !== incomingHtml) {
      editor.commands.setContent(incomingHtml, false);
    }
  }, [value, editor]);

  // Update editable state
  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [disabled, editor]);

  const borderCls = finalized
    ? 'border-amber-300 focus-within:border-amber-400 focus-within:ring-amber-100'
    : 'border-gray-200 focus-within:border-indigo-400 focus-within:ring-indigo-100';

  return (
    <div
      className={[
        'rounded-lg border bg-white focus-within:ring-1 overflow-hidden',
        borderCls,
        disabled ? 'opacity-60' : '',
        className,
      ].join(' ')}
    >
      {!disabled && editor && <Toolbar editor={editor} />}
      <EditorContent
        editor={editor}
        className="rich-editor-content"
        style={{ minHeight }}
      />
      {!value && !editor?.getText() && (
        <style>{`
          .rich-editor-content .ProseMirror p.is-editor-empty:first-child::before {
            content: attr(data-placeholder);
            float: left;
            color: #9ca3af;
            pointer-events: none;
            height: 0;
          }
        `}</style>
      )}
      <style>{`
        .rich-editor-content .ProseMirror {
          padding: 10px 12px;
          font-size: 14px;
          line-height: 1.6;
          color: #1f2937;
          outline: none;
          min-height: ${minHeight};
        }
        .rich-editor-content .ProseMirror p { margin-bottom: 0.6em; }
        .rich-editor-content .ProseMirror p:last-child { margin-bottom: 0; }
        .rich-editor-content .ProseMirror h1 { font-size: 1.4em; font-weight: 700; margin-bottom: 0.5em; }
        .rich-editor-content .ProseMirror h2 { font-size: 1.2em; font-weight: 600; margin-bottom: 0.4em; }
        .rich-editor-content .ProseMirror h3 { font-size: 1.05em; font-weight: 600; margin-bottom: 0.4em; }
        .rich-editor-content .ProseMirror ul { list-style-type: disc; padding-left: 1.4em; margin-bottom: 0.6em; }
        .rich-editor-content .ProseMirror ol { list-style-type: decimal; padding-left: 1.4em; margin-bottom: 0.6em; }
        .rich-editor-content .ProseMirror li { margin-bottom: 0.2em; }
        .rich-editor-content .ProseMirror blockquote {
          border-left: 3px solid #d1d5db;
          margin-left: 0;
          padding-left: 1em;
          color: #6b7280;
          font-style: italic;
        }
        .rich-editor-content .ProseMirror strong { font-weight: 600; }
        .rich-editor-content .ProseMirror em { font-style: italic; }
        .rich-editor-content .ProseMirror u { text-decoration: underline; }
        .rich-editor-content .ProseMirror s { text-decoration: line-through; }
      `}</style>
    </div>
  );
}

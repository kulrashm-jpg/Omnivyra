'use client';

import React, { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import type { ParagraphBlock } from '../../../lib/blog/blockTypes';
import { Bold, Italic, Link2, Code, List, ListOrdered, Quote } from 'lucide-react';

type Props = {
  block: ParagraphBlock;
  onChange: (block: ParagraphBlock) => void;
};

export function ParagraphBlockEditor({ block, onChange }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
      }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Write your paragraph here…' }),
    ],
    content: block.html || '<p></p>',
    editorProps: {
      attributes: {
        class: 'prose prose-sm prose-slate max-w-none min-h-[80px] px-3 py-2 focus:outline-none text-[#3D4F61] leading-relaxed',
      },
    },
    onUpdate({ editor }) {
      onChange({ ...block, html: editor.getHTML() });
    },
  });

  // Sync external block changes (e.g. undo from parent)
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (current !== block.html && block.html) {
      editor.commands.setContent(block.html, false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);

  if (!editor) return null;

  const btn = (active: boolean) =>
    `rounded p-1.5 transition-colors ${active ? 'bg-[#0A66C2]/10 text-[#0A66C2]' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'}`;

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      {/* Minimal toolbar — bold, italic, link, inline code, lists, quote */}
      <div className="flex items-center gap-0.5 border-b border-gray-100 bg-gray-50 px-2 py-1.5">
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
          className={btn(editor.isActive('bold'))}
          title="Bold (Ctrl+B)"
        >
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
          className={btn(editor.isActive('italic'))}
          title="Italic (Ctrl+I)"
        >
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            const prev = editor.getAttributes('link').href;
            const url = window.prompt('Link URL', prev || 'https://');
            if (url === null) return;
            if (url === '') { editor.chain().focus().unsetLink().run(); return; }
            editor.chain().focus().setLink({ href: url, target: '_blank', rel: 'noopener' }).run();
          }}
          className={btn(editor.isActive('link'))}
          title="Link"
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleCode().run(); }}
          className={btn(editor.isActive('code'))}
          title="Inline code"
        >
          <Code className="h-3.5 w-3.5" />
        </button>
        <span className="mx-1 h-4 w-px bg-gray-200" />
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBulletList().run(); }}
          className={btn(editor.isActive('bulletList'))}
          title="Bullet list"
        >
          <List className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run(); }}
          className={btn(editor.isActive('orderedList'))}
          title="Numbered list"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBlockquote().run(); }}
          className={btn(editor.isActive('blockquote'))}
          title="Blockquote"
        >
          <Quote className="h-3.5 w-3.5" />
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

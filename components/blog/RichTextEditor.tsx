'use client';

import React from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExtension from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import {
  Bold, Italic, Underline as UnderlineIcon, Link2, Code,
  List, ListOrdered, Quote, Heading1, Heading2, Heading3,
  RotateCcw, AlignLeft, AlignCenter, AlignRight, Indent,
} from 'lucide-react';

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
};

export function RichTextEditor({ value, onChange, placeholder = 'Write your content here…', minHeight = 400 }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      LinkExtension.configure({
        openOnClick: false,
        autolink: true,
        validate: (href) => /^https?:\/\//.test(href),
      }),
      Placeholder.configure({
        placeholder,
      }),
      Underline,
    ],
    content: value || `<p>${placeholder}</p>`,
    editorProps: {
      attributes: {
        class: `prose prose-sm prose-slate max-w-none px-4 py-3 focus:outline-none text-gray-900 leading-relaxed`,
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
  });

  if (!editor) return null;

  const isActive = (name: string, attrs?: Record<string, unknown>) => editor.isActive(name, attrs);
  const btn = (isActive: boolean) =>
    `rounded px-2 py-1.5 transition-all ${
      isActive
        ? 'bg-[#0B5ED7] text-white'
        : 'text-gray-700 bg-gray-100 hover:bg-gray-200'
    }`;

  const toggleLink = () => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('Enter URL:', previousUrl || 'https://');

    if (url === null) return;

    if (url === '') {
      editor.chain().focus().unsetLink().run();
      return;
    }

    editor.chain().focus().setLink({ href: url, target: '_blank', rel: 'noopener noreferrer' }).run();
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 bg-gray-50 p-2">
        {/* Text formatting */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            disabled={!editor.can().chain().focus().toggleBold().run()}
            className={btn(isActive('bold'))}
            title="Bold (Ctrl+B)"
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            disabled={!editor.can().chain().focus().toggleItalic().run()}
            className={btn(isActive('italic'))}
            title="Italic (Ctrl+I)"
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            disabled={!editor.can().chain().focus().toggleUnderline().run()}
            className={btn(isActive('underline'))}
            title="Underline (Ctrl+U)"
          >
            <UnderlineIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleCode().run()}
            disabled={!editor.can().chain().focus().toggleCode().run()}
            className={btn(isActive('code'))}
            title="Inline Code"
          >
            <Code className="h-4 w-4" />
          </button>
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-gray-300" />

        {/* Headings */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={btn(isActive('heading', { level: 1 }))}
            title="Heading 1"
          >
            <Heading1 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={btn(isActive('heading', { level: 2 }))}
            title="Heading 2"
          >
            <Heading2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={btn(isActive('heading', { level: 3 }))}
            title="Heading 3"
          >
            <Heading3 className="h-4 w-4" />
          </button>
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-gray-300" />

        {/* Lists */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={btn(isActive('bulletList'))}
            title="Bullet List"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={btn(isActive('orderedList'))}
            title="Numbered List"
          >
            <ListOrdered className="h-4 w-4" />
          </button>
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-gray-300" />

        {/* Block formatting */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={btn(isActive('blockquote'))}
            title="Block Quote"
          >
            <Quote className="h-4 w-4" />
          </button>
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-gray-300" />

        {/* Links & Utilities */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleLink}
            className={btn(isActive('link'))}
            title="Add Link (Ctrl+K)"
          >
            <Link2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().clearNodes().run()}
            className={btn(false)}
            title="Clear Formatting"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Editor */}
      <div
        className="overflow-y-auto"
        style={{ minHeight: `${minHeight}px` }}
      >
        <EditorContent
          editor={editor}
          className="editor-content"
        />
      </div>

      {/* Footer: Word count */}
      <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-600">
        {editor?.storage.characterCount?.characters() || 0} characters • {Math.ceil((editor?.storage.characterCount?.characters() || 0) / 5)} words
      </div>
    </div>
  );
}

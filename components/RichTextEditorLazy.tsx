/**
 * W5-2 (audit B-28) — lazy wrapper for the tiptap/ProseMirror editor.
 *
 * The editor (~200 KB+ parsed incl. @tiptap/pm + extensions) was statically
 * imported on the hottest content routes (/activity-workspace compiled 3× the
 * field because of it). This wrapper moves it behind next/dynamic so the
 * chunk loads when the editor actually mounts; consumers swap ONE import
 * path and keep identical props/behavior. ssr:false — the editor is
 * client-only anyway (contenteditable). The fallback mirrors the editor
 * frame so there is no layout shift.
 */
import dynamic from 'next/dynamic';

const RichTextEditorLazy = dynamic(() => import('./RichTextEditor'), {
  ssr: false,
  loading: () => (
    <div
      aria-busy="true"
      aria-label="Loading editor"
      className="min-h-[120px] w-full animate-pulse rounded-md border border-gray-200 bg-gray-50"
    />
  ),
});

export default RichTextEditorLazy;

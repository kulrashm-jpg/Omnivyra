import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import {
  FileText, Plus, Edit2, Trash2, Globe, Loader2, AlertCircle,
  CheckCircle2, ExternalLink, ChevronLeft, Bold, Italic, Underline,
  List, ListOrdered, Quote, Heading1, Heading2, Link2, Undo2, Search, X, Zap, Wand2,
} from 'lucide-react';
import { useCompanyContext } from '../components/CompanyContext';
import { buildImageQuery, searchImages as searchStockImages, type ImageResult } from '../lib/media/imageService';
import BlogIntelligenceWizard from '../components/blog/BlogIntelligenceWizard';
import BlogAnalyticsPanel from '../components/blog/BlogAnalyticsPanel';
import BlogGenerateModal from '../components/blog/BlogGenerateModal';
import type { BlogGenerationOutput } from '../lib/blog/blogGenerationEngine';
import type { HookAssessment } from './api/admin/blog/generate';

// ─── Types ────────────────────────────────────────────────────────────────────
type BlogStatus = 'draft' | 'published' | 'failed';
interface Blog {
  id: string; company_id: string; title: string; content: string;
  status: BlogStatus; integration_id: string | null; external_id: string | null;
  published_at: string | null; created_at: string; updated_at: string;
  slug: string | null; excerpt: string | null; featured_image_url: string | null;
  category: string | null; tags: string[]; seo_meta_title: string | null;
  seo_meta_description: string | null; is_featured: boolean;
  angle_type?: string | null;
}
interface BlogIntegration { id: string; name: string; type: string; status: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function wordCount(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
}
function fmtDate(d: string | null) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── Toolbar button ───────────────────────────────────────────────────────────
function TBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
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

// ─── Rich Text Editor ─────────────────────────────────────────────────────────
function RichEditor({ initialContent, onChange }: { initialContent: string; onChange: (html: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = initialContent;
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

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: BlogStatus }) {
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

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function BlogsPage() {
  const router = useRouter();
  const { selectedCompanyId, userRole } = useCompanyContext();
  const isAdmin = ['COMPANY_ADMIN', 'SUPER_ADMIN'].includes((userRole || '').toUpperCase());

  // Data
  const [blogs, setBlogs] = useState<Blog[]>([]);
  const [blogIntegrations, setBlogIntegrations] = useState<BlogIntegration[]>([]);
  const [companyIndustry, setCompanyIndustry] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // View: 'dashboard' or 'editor'
  const [view, setView] = useState<'dashboard' | 'editor'>('dashboard');
  const [editingBlog, setEditingBlog] = useState<Blog | null>(null);

  // Editor state
  const [editorTitle, setEditorTitle] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [editorIntegrationId, setEditorIntegrationId] = useState('');
  const [editorSlug, setEditorSlug] = useState('');
  const [editorExcerpt, setEditorExcerpt] = useState('');
  const [editorFeaturedImageUrl, setEditorFeaturedImageUrl] = useState('');
  const [editorCategory, setEditorCategory] = useState('');
  const [editorTagsInput, setEditorTagsInput] = useState('');
  const [editorSeoTitle, setEditorSeoTitle] = useState('');
  const [editorSeoDesc, setEditorSeoDesc] = useState('');
  const [editorIsFeatured, setEditorIsFeatured] = useState(false);

  // Featured image search
  const [imgSearchOpen,    setImgSearchOpen]    = useState(false);
  const [imgSearchQuery,   setImgSearchQuery]   = useState('');
  const [imgSearchResults, setImgSearchResults] = useState<ImageResult[]>([]);
  const [imgSearchLoading, setImgSearchLoading] = useState(false);

  const runImgSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setImgSearchLoading(true);
    const imgs = await searchStockImages({ query: q.trim(), perPage: 6 });
    setImgSearchResults(imgs);
    setImgSearchLoading(false);
  }, []);

  const openImgSearch = useCallback(() => {
    const q = buildImageQuery({ title: editorTitle, excerpt: editorExcerpt, tags: editorTagsInput.split(',').map(t => t.trim()).filter(Boolean) });
    setImgSearchQuery(q);
    setImgSearchOpen(true);
    setImgSearchResults([]);
    if (q) runImgSearch(q);
  }, [editorTitle, editorExcerpt, editorTagsInput, runImgSearch]);

  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Blog Intelligence wizard
  const [intelligenceWizardOpen, setIntelligenceWizardOpen] = useState(false);
  const [intelligenceEnabled,    setIntelligenceEnabled]    = useState(false);

  // Blog generation modal
  const [generateModalOpen,    setGenerateModalOpen]    = useState(false);
  const [generatedConfidence,  setGeneratedConfidence]  = useState<'high' | 'medium' | null>(null);
  const [generatedAngleType,   setGeneratedAngleType]   = useState<string | null>(null);
  const [generatedBlocks,      setGeneratedBlocks]      = useState<unknown[] | null>(null);
  const [hookAssessment,       setHookAssessment]       = useState<HookAssessment | null>(null);
  const [rewritingHook,        setRewritingHook]        = useState(false);
  const [editorKey,            setEditorKey]            = useState(0);
  useEffect(() => {
    if (!selectedCompanyId) return;
    setIntelligenceEnabled(!!localStorage.getItem(`blog_intelligence_enabled_${selectedCompanyId}`));
  }, [selectedCompanyId]);

  // Dashboard filter
  const [filterTab, setFilterTab] = useState<'all' | 'draft' | 'published'>('all');

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Open editor pre-filled from AI generation ──────────────────────────────
  function openGenerated(
    output:     BlogGenerationOutput & { content_blocks?: unknown[] },
    confidence: 'high' | 'medium',
    hook:       HookAssessment,
    angleType:  string | null,
  ) {
    setGenerateModalOpen(false);
    setGeneratedConfidence(confidence);
    setGeneratedAngleType(angleType);
    setGeneratedBlocks(Array.isArray(output.content_blocks) ? output.content_blocks : null);
    setHookAssessment(hook);
    setEditingBlog(null);
    setEditorTitle(output.title);
    setEditorContent(output.content_html);
    setEditorExcerpt(output.excerpt);
    setEditorCategory(output.category);
    setEditorTagsInput(output.tags.join(', '));
    setEditorSeoTitle(output.seo_meta_title);
    setEditorSeoDesc(output.seo_meta_description);
    setEditorFeaturedImageUrl('');
    setEditorSlug('');
    setEditorIsFeatured(false);
    setEditorIntegrationId('');
    setSaveMsg(null);
    setView('editor');
  }

  // ── Rewrite Hook ───────────────────────────────────────────────────────────
  async function rewriteHook() {
    if (!selectedCompanyId || !editorContent) return;
    setRewritingHook(true);
    try {
      const resp = await fetch('/api/admin/blog/rewrite-hook', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          company_id:   selectedCompanyId,
          content_html: editorContent,
          topic:        editorTitle || editorExcerpt || 'Blog post',
          angle_type:   generatedAngleType ?? undefined,
        }),
      });
      if (resp.ok) {
        const { new_hook } = await resp.json() as { new_hook: string };
        if (new_hook) {
          // Replace the first <p>…</p> in editorContent
          const updated = editorContent.replace(/<p[^>]*>[\s\S]*?<\/p>/i, new_hook);
          setEditorContent(updated);
          setEditorKey(k => k + 1); // force RichEditor remount with new content
          setHookAssessment(null);  // clear warning
        }
      }
    } finally {
      setRewritingHook(false);
    }
  }

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true); setError('');
    try {
      const qs = `company_id=${selectedCompanyId}`;
      const [blogsRes, wpRes, apiRes, profileRes] = await Promise.all([
        fetch(`/api/blogs?${qs}`).then(r => r.json()),
        fetch(`/api/integrations?${qs}&type=wordpress`).then(r => r.json()),
        fetch(`/api/integrations?${qs}&type=custom_blog_api`).then(r => r.json()),
        fetch(`/api/company-profile?company_id=${selectedCompanyId}`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      setBlogs(blogsRes.blogs || []);
      setBlogIntegrations([...(wpRes.integrations || []), ...(apiRes.integrations || [])]);
      setCompanyIndustry(profileRes?.profile?.industry ?? profileRes?.industry ?? null);
    } catch { setError('Failed to load. Please refresh.'); }
    finally { setLoading(false); }
  }, [selectedCompanyId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Open editor ────────────────────────────────────────────────────────────
  function clearEditorMeta() {
    setEditorSlug('');
    setEditorExcerpt('');
    setEditorFeaturedImageUrl('');
    setEditorCategory('');
    setEditorTagsInput('');
    setEditorSeoTitle('');
    setEditorSeoDesc('');
    setEditorIsFeatured(false);
  }
  function openNew() {
    setEditingBlog(null);
    setGeneratedConfidence(null);
    setGeneratedAngleType(null);
    setGeneratedBlocks(null);
    setHookAssessment(null);
    setEditorTitle('');
    setEditorContent('');
    setEditorIntegrationId('');
    clearEditorMeta();
    setSaveMsg(null);
    setView('editor');
  }
  function openEdit(blog: Blog) {
    setEditingBlog(blog);
    setEditorTitle(blog.title);
    setEditorContent(blog.content);
    setEditorIntegrationId(blog.integration_id || '');
    setEditorSlug(blog.slug || '');
    setEditorExcerpt(blog.excerpt || '');
    setEditorFeaturedImageUrl(blog.featured_image_url || '');
    setEditorCategory(blog.category || '');
    setEditorTagsInput((blog.tags || []).join(', '));
    setEditorSeoTitle(blog.seo_meta_title || '');
    setEditorSeoDesc(blog.seo_meta_description || '');
    setEditorIsFeatured(blog.is_featured || false);
    setSaveMsg(null);
    setView('editor');
  }

  // ── Save draft ─────────────────────────────────────────────────────────────
  function buildBlogPayload() {
    const tags = editorTagsInput.split(',').map(t => t.trim()).filter(Boolean);
    return {
      company_id: selectedCompanyId,
      title: editorTitle,
      content: editorContent,
      ...(editorSlug.trim()              ? { slug: editorSlug.trim() }                         : {}),
      ...(editorExcerpt.trim()           ? { excerpt: editorExcerpt.trim() }                   : {}),
      ...(editorFeaturedImageUrl.trim()  ? { featured_image_url: editorFeaturedImageUrl.trim() } : {}),
      ...(editorCategory.trim()          ? { category: editorCategory.trim() }                 : {}),
      ...(tags.length                    ? { tags }                                             : {}),
      ...(editorSeoTitle.trim()          ? { seo_meta_title: editorSeoTitle.trim() }           : {}),
      ...(editorSeoDesc.trim()           ? { seo_meta_description: editorSeoDesc.trim() }      : {}),
      ...(generatedBlocks                ? { content_blocks: generatedBlocks }                 : {}),
      ...(generatedAngleType             ? { angle_type: generatedAngleType }                  : {}),
      ...(hookAssessment                 ? { hook_strength: hookAssessment.strength }           : {}),
      is_featured: editorIsFeatured,
    };
  }

  // ── Update angle×industry matrix after first save of a generated post ────────
  function updateAngleIndustryMatrix(contentScore: number) {
    if (!generatedAngleType || !companyIndustry || !selectedCompanyId) return;
    // Fire-and-forget — non-blocking
    fetch('/api/track/angle-industry-matrix', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        company_id:    selectedCompanyId,
        industry:      companyIndustry,
        angle_type:    generatedAngleType,
        content_score: Math.min(100, Math.max(0, Math.round(contentScore))),
      }),
    }).catch(() => { /* ignore */ });
  }

  async function saveDraft() {
    if (!editorTitle.trim()) { setSaveMsg({ ok: false, text: 'Add a title first.' }); return; }
    setSaving(true); setSaveMsg(null);
    try {
      const body = buildBlogPayload();
      const url = editingBlog ? `/api/blogs/${editingBlog.id}` : '/api/blogs';
      const method = editingBlog ? 'PUT' : 'POST';
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) { setSaveMsg({ ok: false, text: data.error || 'Save failed.' }); return; }
      setEditingBlog(data.blog);
      setSaveMsg({ ok: true, text: 'Draft saved.' });
      // On first save of a generated post, record angle × industry performance signal
      if (!editingBlog && generatedAngleType && companyIndustry) {
        // Use hook strength as a proxy for initial content score (strong=80, moderate=60, weak=40)
        const hookScore = hookAssessment?.strength === 'strong' ? 80 : hookAssessment?.strength === 'weak' ? 40 : 60;
        updateAngleIndustryMatrix(hookScore);
      }
      fetchAll();
    } catch { setSaveMsg({ ok: false, text: 'Network error.' }); }
    finally { setSaving(false); }
  }

  // ── Publish ────────────────────────────────────────────────────────────────
  async function publish() {
    if (!editorTitle.trim()) { setSaveMsg({ ok: false, text: 'Add a title before publishing.' }); return; }
    setPublishing(true); setSaveMsg(null);

    // Save latest content first
    let blogId = editingBlog?.id;
    try {
      const body = buildBlogPayload();
      if (!blogId) {
        const r = await fetch('/api/blogs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await r.json();
        if (!r.ok) { setSaveMsg({ ok: false, text: data.error || 'Save failed.' }); setPublishing(false); return; }
        blogId = data.blog.id;
        setEditingBlog(data.blog);
      } else {
        await fetch(`/api/blogs/${blogId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
    } catch { setSaveMsg({ ok: false, text: 'Failed to save before publishing.' }); setPublishing(false); return; }

    // Now publish
    try {
      const r = await fetch(`/api/blogs/${blogId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: selectedCompanyId, integration_id: editorIntegrationId || null }),
      });
      const data = await r.json();
      if (data.success) {
        setSaveMsg({ ok: true, text: data.message });
        if (data.blog) setEditingBlog(data.blog);
        fetchAll();
      } else {
        setSaveMsg({ ok: false, text: data.message || 'Publish failed.' });
      }
    } catch { setSaveMsg({ ok: false, text: 'Network error during publish.' }); }
    finally { setPublishing(false); }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function confirmDelete() {
    if (!deleteConfirm) return;
    setDeleting(true);
    await fetch(`/api/blogs/${deleteConfirm.id}?company_id=${selectedCompanyId}`, { method: 'DELETE' }).catch(() => {});
    setDeleteConfirm(null);
    setDeleting(false);
    fetchAll();
  }

  // ── Filtered list ──────────────────────────────────────────────────────────
  const displayed = blogs.filter(b => filterTab === 'all' || b.status === filterTab);
  const draftCount = blogs.filter(b => b.status === 'draft').length;
  const publishedCount = blogs.filter(b => b.status === 'published').length;

  // ── No company ────────────────────────────────────────────────────────────
  if (!selectedCompanyId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
        <div className="text-center text-gray-500">
          <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">Select a company to manage blogs</p>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EDITOR VIEW
  // ─────────────────────────────────────────────────────────────────────────
  if (view === 'editor') {
    const wc = wordCount(editorContent);
    const isPublished = editingBlog?.status === 'published';

    return (
      <div className="min-h-screen bg-white">
        {/* Editor top bar */}
        <div className="border-b border-gray-200 bg-white sticky top-0 z-20">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
            <button onClick={() => { setView('dashboard'); fetchAll(); }}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 font-medium transition-colors shrink-0">
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {saveMsg && (
                <span className={`text-xs font-medium flex items-center gap-1 ${saveMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                  {saveMsg.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                  {saveMsg.text}
                </span>
              )}
              {editingBlog && <StatusBadge status={editingBlog.status} />}
              {isAdmin && (
                <>
                  <button onClick={saveDraft} disabled={saving}
                    className="px-3 py-1.5 text-sm font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors">
                    {saving ? 'Saving...' : 'Save Draft'}
                  </button>
                  {!isPublished && (
                    <button onClick={publish} disabled={publishing}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                      {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                      {publishing ? 'Publishing...' : 'Publish'}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Editor body */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6">
          {/* Main editor */}
          <div className="min-w-0">
            <input
              value={editorTitle}
              onChange={e => setEditorTitle(e.target.value)}
              placeholder="Blog title..."
              className="w-full text-3xl sm:text-4xl font-bold text-gray-900 placeholder-gray-300 border-0 focus:outline-none mb-6 bg-transparent"
            />
            <RichEditor
              key={`${editingBlog?.id || 'new'}-${editorKey}`}
              initialContent={editorContent}
              onChange={setEditorContent}
            />
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Publish destination */}
            {isAdmin && !isPublished && (
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Publish to</p>
                <select
                  value={editorIntegrationId}
                  onChange={e => setEditorIntegrationId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
                  <option value="">Virality (hosted here)</option>
                  {blogIntegrations.map(i => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
                {blogIntegrations.length === 0 && (
                  <p className="text-xs text-gray-400 mt-2">
                    No blog integrations connected.{' '}
                    <button onClick={() => router.push('/integrations')} className="text-indigo-600 hover:underline">
                      Set one up
                    </button>{' '}to publish to WordPress or your blog.
                  </p>
                )}
              </div>
            )}

            {/* Published info */}
            {isPublished && editingBlog && (
              <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 space-y-1.5">
                <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Published</p>
                <p className="text-xs text-emerald-700">{fmtDate(editingBlog.published_at)}</p>
                {editingBlog.external_id && (
                  <p className="text-xs text-emerald-600">External ID: {editingBlog.external_id}</p>
                )}
              </div>
            )}

            {/* Metadata */}
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Post Settings</p>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Slug (URL)</label>
                <input
                  value={editorSlug}
                  onChange={e => setEditorSlug(e.target.value)}
                  placeholder="auto-generated from title"
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder-gray-300"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Category</label>
                <input
                  value={editorCategory}
                  onChange={e => setEditorCategory(e.target.value)}
                  placeholder="e.g. Marketing"
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder-gray-300"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Tags (comma-separated)</label>
                <input
                  value={editorTagsInput}
                  onChange={e => setEditorTagsInput(e.target.value)}
                  placeholder="e.g. seo, growth"
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder-gray-300"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Featured image</label>
                {/* Preview */}
                {editorFeaturedImageUrl && (
                  <div className="relative mb-2 rounded-lg overflow-hidden border border-gray-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={editorFeaturedImageUrl} alt="featured" className="w-full h-28 object-cover" />
                    <button
                      type="button"
                      onClick={() => setEditorFeaturedImageUrl('')}
                      className="absolute top-1 right-1 rounded-full bg-black/50 p-0.5 text-white hover:bg-black/70"
                      title="Remove image"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
                {/* URL input */}
                <input
                  value={editorFeaturedImageUrl}
                  onChange={e => setEditorFeaturedImageUrl(e.target.value)}
                  placeholder="https://... or search below"
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder-gray-300"
                />
                {/* Search toggle */}
                <button
                  type="button"
                  onClick={() => imgSearchOpen ? setImgSearchOpen(false) : openImgSearch()}
                  className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  <Search className="h-3 w-3" />
                  {imgSearchOpen ? 'Hide image search' : 'Search stock images'}
                </button>
                {/* Image search panel */}
                {imgSearchOpen && (
                  <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3">
                    <div className="flex gap-1.5 mb-2">
                      <input
                        type="text"
                        value={imgSearchQuery}
                        onChange={e => setImgSearchQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && runImgSearch(imgSearchQuery)}
                        placeholder="Search images…"
                        className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs bg-gray-50 focus:outline-none focus:border-indigo-300"
                      />
                      <button
                        type="button"
                        onClick={() => runImgSearch(imgSearchQuery)}
                        disabled={imgSearchLoading}
                        className="px-2.5 py-1 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {imgSearchLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Go'}
                      </button>
                    </div>
                    {imgSearchResults.length > 0 ? (
                      <div className="grid grid-cols-3 gap-1.5">
                        {imgSearchResults.map((img) => (
                          <button
                            key={img.id}
                            type="button"
                            onClick={() => { setEditorFeaturedImageUrl(img.full); setImgSearchOpen(false); }}
                            className={`relative rounded overflow-hidden aspect-video focus:outline-none ${
                              editorFeaturedImageUrl === img.full ? 'ring-2 ring-indigo-500' : 'hover:ring-2 hover:ring-gray-300'
                            }`}
                            title={img.attribution}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={img.thumb} alt={img.alt} className="w-full h-full object-cover" loading="lazy" />
                          </button>
                        ))}
                      </div>
                    ) : !imgSearchLoading ? (
                      <p className="text-[11px] text-gray-400 text-center py-2">No results. Try different keywords.</p>
                    ) : (
                      <p className="text-[11px] text-gray-400 text-center py-2">Searching…</p>
                    )}
                    {imgSearchResults.length > 0 && (
                      <p className="text-[9px] text-gray-400 mt-2">Images from Unsplash, Pexels, Pixabay. Attribution required when publishing.</p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Excerpt</label>
                <textarea
                  value={editorExcerpt}
                  onChange={e => setEditorExcerpt(e.target.value)}
                  placeholder="Short summary shown in listings…"
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder-gray-300 resize-none"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-500">Feature this post</label>
                <button
                  type="button"
                  onClick={() => setEditorIsFeatured(v => !v)}
                  className={`w-9 h-5 rounded-full transition-colors ${editorIsFeatured ? 'bg-indigo-600' : 'bg-gray-300'} relative`}
                >
                  <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${editorIsFeatured ? 'translate-x-4' : ''}`} />
                </button>
              </div>
            </div>

            {/* SEO */}
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">SEO</p>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Meta title</label>
                <input
                  value={editorSeoTitle}
                  onChange={e => setEditorSeoTitle(e.target.value)}
                  placeholder="Defaults to post title"
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder-gray-300"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Meta description</label>
                <textarea
                  value={editorSeoDesc}
                  onChange={e => setEditorSeoDesc(e.target.value)}
                  placeholder="Defaults to excerpt"
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder-gray-300 resize-none"
                />
              </div>
            </div>

            {/* Hook Strength Warning (only for AI-generated posts with weak/moderate hook) */}
            {hookAssessment && hookAssessment.strength !== 'strong' && (
              <div className={`rounded-xl border p-3 ${
                hookAssessment.strength === 'weak'
                  ? 'bg-red-50 border-red-200'
                  : 'bg-amber-50 border-amber-200'
              }`}>
                <div className="flex items-start gap-2.5">
                  <AlertCircle className={`mt-0.5 h-4 w-4 shrink-0 ${hookAssessment.strength === 'weak' ? 'text-red-500' : 'text-amber-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold ${hookAssessment.strength === 'weak' ? 'text-red-800' : 'text-amber-800'}`}>
                      {hookAssessment.strength === 'weak' ? 'Weak Hook Detected' : 'Hook Could Be Stronger'}
                    </p>
                    {hookAssessment.note && (
                      <p className={`text-[11px] mt-0.5 leading-relaxed ${hookAssessment.strength === 'weak' ? 'text-red-600' : 'text-amber-600'}`}>
                        {hookAssessment.note}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={rewriteHook}
                  disabled={rewritingHook}
                  className={`mt-2 w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold py-1.5 px-2 rounded-lg transition-colors ${
                    hookAssessment.strength === 'weak'
                      ? 'bg-red-100 hover:bg-red-200 text-red-700 disabled:opacity-50'
                      : 'bg-amber-100 hover:bg-amber-200 text-amber-700 disabled:opacity-50'
                  }`}
                >
                  {rewritingHook ? (
                    <><Loader2 className="h-3 w-3 animate-spin" /> Rewriting…</>
                  ) : (
                    <><Wand2 className="h-3 w-3" /> Rewrite Hook</>
                  )}
                </button>
              </div>
            )}

            {/* Source Confidence Badge (only for AI-generated posts) */}
            {generatedConfidence && (
              <div className={`rounded-xl border p-3 flex items-start gap-2.5 ${
                generatedConfidence === 'high'
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-amber-50 border-amber-200'
              }`}>
                <div className={`mt-0.5 shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${
                  generatedConfidence === 'high' ? 'bg-emerald-500' : 'bg-amber-500'
                }`}>
                  {generatedConfidence === 'high' ? '✓' : '~'}
                </div>
                <div>
                  <p className={`text-xs font-semibold ${generatedConfidence === 'high' ? 'text-emerald-800' : 'text-amber-800'}`}>
                    {generatedConfidence === 'high' ? 'High Confidence' : 'Medium Confidence'}
                  </p>
                  <p className={`text-[11px] mt-0.5 ${generatedConfidence === 'high' ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {generatedConfidence === 'high'
                      ? 'Strong signal — generated from clear topic context.'
                      : 'Generated with some assumptions. Review closely before publishing.'}
                  </p>
                </div>
              </div>
            )}

            {/* Stats */}
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-2 text-xs text-gray-500">
              <div className="flex justify-between"><span>Words</span><span className="font-medium text-gray-700">{wc}</span></div>
              <div className="flex justify-between"><span>Characters</span><span className="font-medium text-gray-700">{stripHtml(editorContent).length}</span></div>
              {editingBlog && (
                <div className="flex justify-between"><span>Last saved</span><span className="font-medium text-gray-700">{fmtDate(editingBlog.updated_at)}</span></div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DASHBOARD VIEW
  // ─────────────────────────────────────────────────────────────────────────
  const tabCls = (t: 'all' | 'draft' | 'published') =>
    `px-4 py-2 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap ${filterTab === t ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Blog</h1>
            <p className="text-sm text-gray-500 mt-0.5">Write, publish, and manage your blog posts.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => router.push('/integrations')}
              className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors">
              <ExternalLink className="h-4 w-4" /> Connect Website
            </button>
            {isAdmin && (
              <>
                <button
                  onClick={() => setGenerateModalOpen(true)}
                  className="flex items-center gap-1.5 bg-violet-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors">
                  <Wand2 className="h-4 w-4" /> Generate Blog
                </button>
                <button
                  onClick={openNew}
                  className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors">
                  <Plus className="h-4 w-4" /> Write Blog
                </button>
              </>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Total', value: blogs.length },
            { label: 'Drafts', value: draftCount },
            { label: 'Published', value: publishedCount },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-200/60 shadow-sm p-4 text-center">
              <div className="text-2xl font-bold text-gray-900">{value}</div>
              <div className="text-xs text-gray-500 font-medium mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* No integration callout */}
        {blogIntegrations.length === 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-blue-800">No blog integration connected</p>
              <p className="text-xs text-blue-600 mt-0.5">Your posts will be hosted here on Virality. Connect WordPress or a custom blog API to also publish externally.</p>
            </div>
            <button onClick={() => router.push('/integrations')} className="shrink-0 flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors">
              <ExternalLink className="h-3.5 w-3.5" /> Connect Now
            </button>
          </div>
        )}

        {/* Blog Intelligence CTA */}
        {intelligenceEnabled ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-800">Blog Intelligence Active</p>
                <p className="text-xs text-green-600 mt-0.5">Tracking views, scroll depth &amp; engagement from your blog.</p>
              </div>
            </div>
            <button
              onClick={() => setIntelligenceWizardOpen(true)}
              className="shrink-0 text-xs text-green-700 underline hover:text-green-900"
            >
              Manage
            </button>
          </div>
        ) : (
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-5 mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-indigo-900">Turn your blog into a growth engine</p>
              <p className="text-xs text-indigo-600 mt-0.5">Track views, scroll depth, and engagement — one script, any platform.</p>
            </div>
            <button
              onClick={() => setIntelligenceWizardOpen(true)}
              className="shrink-0 flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
            >
              <Zap className="h-3.5 w-3.5" /> Enable Blog Intelligence
            </button>
          </div>
        )}

        {/* Analytics panel — shown when intelligence is enabled */}
        {intelligenceEnabled && (
          <BlogAnalyticsPanel accountId={selectedCompanyId} />
        )}

        {/* Tabs */}
        <div className="flex gap-1.5 mb-5">
          <button onClick={() => setFilterTab('all')} className={tabCls('all')}>All ({blogs.length})</button>
          <button onClick={() => setFilterTab('draft')} className={tabCls('draft')}>Drafts ({draftCount})</button>
          <button onClick={() => setFilterTab('published')} className={tabCls('published')}>Published ({publishedCount})</button>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 rounded-lg p-3 mb-4 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading...
          </div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-20">
            <FileText className="h-10 w-10 mx-auto mb-3 text-gray-300" />
            <p className="font-medium text-gray-600">{filterTab === 'all' ? 'No blog posts yet' : `No ${filterTab} posts`}</p>
            {isAdmin && filterTab !== 'published' && (
              <button onClick={openNew} className="mt-3 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors">
                Write Your First Post
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {displayed.map(blog => {
              const integration = blogIntegrations.find(i => i.id === blog.integration_id);
              const wc = wordCount(blog.content);
              const preview = stripHtml(blog.content).slice(0, 120);
              return (
                <div key={blog.id} className="bg-white rounded-xl border border-gray-200/60 shadow-sm p-4 sm:p-5 hover:shadow-md transition-shadow">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="font-semibold text-gray-900 text-base">{blog.title || 'Untitled'}</h3>
                        <StatusBadge status={blog.status} />
                        {integration && (
                          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                            {integration.name}
                          </span>
                        )}
                        {blog.status === 'published' && !blog.integration_id && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Hosted</span>
                        )}
                      </div>
                      {preview && (
                        <p className="text-sm text-gray-400 line-clamp-2 mt-0.5">{preview}{blog.content.length > 120 ? '...' : ''}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                        <span>{wc} words</span>
                        <span>{blog.status === 'published' ? 'Published ' + fmtDate(blog.published_at) : 'Updated ' + fmtDate(blog.updated_at)}</span>
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button onClick={() => openEdit(blog)} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                          <Edit2 className="h-3.5 w-3.5" /> Edit
                        </button>
                        {blog.status === 'draft' && (
                          <button onClick={() => { openEdit(blog); setTimeout(publish, 100); }} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors">
                            <Globe className="h-3.5 w-3.5" /> Publish
                          </button>
                        )}
                        {blog.status === 'published' && (
                          <a
                            href={`/company-blog/${blog.slug ?? blog.id}?company_id=${selectedCompanyId}#repurpose`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
                            title="Repurpose into LinkedIn, Twitter & Email"
                          >
                            <Zap className="h-3.5 w-3.5" /> Campaign
                          </a>
                        )}
                        <button onClick={() => setDeleteConfirm({ id: blog.id, title: blog.title })} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── BLOG GENERATE MODAL ───────────────────────────────────────────── */}
      {generateModalOpen && (
        <BlogGenerateModal
          companyId={selectedCompanyId}
          industry={companyIndustry}
          blogs={blogs.filter(b => b.status === 'published').map(b => ({ id: b.id, title: b.title, slug: b.slug, angle_type: b.angle_type ?? null }))}
          onClose={() => setGenerateModalOpen(false)}
          onGenerated={openGenerated}
        />
      )}

      {/* ── BLOG INTELLIGENCE WIZARD ──────────────────────────────────────── */}
      {intelligenceWizardOpen && (
        <BlogIntelligenceWizard
          accountId={selectedCompanyId}
          onClose={() => setIntelligenceWizardOpen(false)}
          onSuccess={() => {
            localStorage.setItem(`blog_intelligence_enabled_${selectedCompanyId}`, '1');
            setIntelligenceEnabled(true);
            setIntelligenceWizardOpen(false);
          }}
        />
      )}

      {/* ── DELETE CONFIRM ───────────────────────────────────────────────── */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Delete Post?</h2>
            <p className="text-sm text-gray-600 mb-5">
              <strong>{deleteConfirm.title || 'Untitled'}</strong> will be permanently deleted.
            </p>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                Cancel
              </button>
              <button onClick={confirmDelete} disabled={deleting} className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

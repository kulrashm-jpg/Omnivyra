import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import {
  FileText, Plus, Edit2, Trash2, Globe, Loader2, AlertCircle,
  CheckCircle2, ExternalLink, ChevronLeft, Bold, Italic, Underline,
  List, ListOrdered, Quote, Heading1, Heading2, Link2, Undo2,
} from 'lucide-react';
import { useCompanyContext } from '../components/CompanyContext';

// ─── Types ────────────────────────────────────────────────────────────────────
type BlogStatus = 'draft' | 'published' | 'failed';
interface Blog {
  id: string; company_id: string; title: string; content: string;
  status: BlogStatus; integration_id: string | null; external_id: string | null;
  published_at: string | null; created_at: string; updated_at: string;
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // View: 'dashboard' or 'editor'
  const [view, setView] = useState<'dashboard' | 'editor'>('dashboard');
  const [editingBlog, setEditingBlog] = useState<Blog | null>(null);

  // Editor state
  const [editorTitle, setEditorTitle] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [editorIntegrationId, setEditorIntegrationId] = useState('');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Dashboard filter
  const [filterTab, setFilterTab] = useState<'all' | 'draft' | 'published'>('all');

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true); setError('');
    try {
      const qs = `company_id=${selectedCompanyId}`;
      const [blogsRes, wpRes, apiRes] = await Promise.all([
        fetch(`/api/blogs?${qs}`).then(r => r.json()),
        fetch(`/api/integrations?${qs}&type=wordpress`).then(r => r.json()),
        fetch(`/api/integrations?${qs}&type=custom_blog_api`).then(r => r.json()),
      ]);
      setBlogs(blogsRes.blogs || []);
      setBlogIntegrations([...(wpRes.integrations || []), ...(apiRes.integrations || [])]);
    } catch { setError('Failed to load. Please refresh.'); }
    finally { setLoading(false); }
  }, [selectedCompanyId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Open editor ────────────────────────────────────────────────────────────
  function openNew() {
    setEditingBlog(null);
    setEditorTitle('');
    setEditorContent('');
    setEditorIntegrationId('');
    setSaveMsg(null);
    setView('editor');
  }
  function openEdit(blog: Blog) {
    setEditingBlog(blog);
    setEditorTitle(blog.title);
    setEditorContent(blog.content);
    setEditorIntegrationId(blog.integration_id || '');
    setSaveMsg(null);
    setView('editor');
  }

  // ── Save draft ─────────────────────────────────────────────────────────────
  async function saveDraft() {
    if (!editorTitle.trim()) { setSaveMsg({ ok: false, text: 'Add a title first.' }); return; }
    setSaving(true); setSaveMsg(null);
    try {
      const body = { company_id: selectedCompanyId, title: editorTitle, content: editorContent };
      const url = editingBlog ? `/api/blogs/${editingBlog.id}` : '/api/blogs';
      const method = editingBlog ? 'PUT' : 'POST';
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) { setSaveMsg({ ok: false, text: data.error || 'Save failed.' }); return; }
      setEditingBlog(data.blog);
      setSaveMsg({ ok: true, text: 'Draft saved.' });
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
      const body = { company_id: selectedCompanyId, title: editorTitle, content: editorContent };
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
              key={editingBlog?.id || 'new'}
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
              <button
                onClick={openNew}
                className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors">
                <Plus className="h-4 w-4" /> Write Blog
              </button>
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

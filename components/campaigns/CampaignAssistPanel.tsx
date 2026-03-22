'use client';

/**
 * CampaignAssistPanel
 *
 * Modal that opens between "Build Campaign" click and the actual API call.
 * Lets users enrich campaign context with blogs, insights, and topics.
 *
 * Blogs shown in two tabs:
 *   "Your Content"     — company's own published blogs
 *   "Omnivyra Library" — platform knowledge library (public_blogs)
 *
 * Fully optional — skipping sends null for all context fields so the
 * existing campaign flow is completely unaffected.
 */

import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  X, Search, Plus, Sparkles, ChevronDown, ChevronRight,
  BookOpen, Lightbulb, Hash, Loader2, Building2, Globe,
} from 'lucide-react';

// ── Public types ──────────────────────────────────────────────────────────────

export interface BlogContextItem {
  id:           string;
  title:        string;
  slug:         string;
  tags:         string[];
  category:     string;
  excerpt:      string;
  summary:      string;
  key_insights: string[];
  h2_headings:  string[];
  views_count:  number;
  likes_count:  number;
  source:       'company' | 'omnivyra';
}

export interface AssistContext {
  blog_context:    { blogs: Array<{ title: string; summary: string; key_insights: string[]; tags: string[]; headings: string[]; source: 'company' | 'omnivyra' }> } | null;
  insight_context: { insights: string[] } | null;
  topic_context:   { topics: string[] }   | null;
  ai_assist:       boolean;
}

export const EMPTY_ASSIST_CONTEXT: AssistContext = {
  blog_context: null, insight_context: null, topic_context: null, ai_assist: false,
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface CampaignAssistPanelProps {
  open:                boolean;
  onClose:             () => void;
  onConfirm:           (context: AssistContext) => void;
  recommendationTopic?: string;
  /** Blog ID to pre-select when the panel opens (from blog → campaign flow). */
  initialBlogId?:      string;
}

type BlogTab = 'company' | 'omnivyra';

// ── Component ─────────────────────────────────────────────────────────────────

export function CampaignAssistPanel({
  open,
  onClose,
  onConfirm,
  recommendationTopic,
  initialBlogId,
}: CampaignAssistPanelProps) {
  const [companyBlogs,   setCompanyBlogs]   = useState<BlogContextItem[]>([]);
  const [omnivyraBlogs,  setOmnivyraBlogs]  = useState<BlogContextItem[]>([]);
  const [blogsLoading,   setBlogsLoading]   = useState(false);
  const [blogTab,        setBlogTab]        = useState<BlogTab>('company');
  const [blogSearch,     setBlogSearch]     = useState('');
  const [selectedIds,    setSelectedIds]    = useState<Set<string>>(new Set());
  const [selInsights,    setSelInsights]    = useState<string[]>([]);
  const [customInsight,  setCustomInsight]  = useState('');
  const [topics,         setTopics]         = useState<string[]>([]);
  const [topicInput,     setTopicInput]     = useState('');
  const [aiAssist,       setAiAssist]       = useState(true);
  const [openSec, setOpenSec] = useState({ blogs: true, insights: true, topics: false });

  const toggleSec = (s: keyof typeof openSec) =>
    setOpenSec((p) => ({ ...p, [s]: !p[s] }));

  // All blogs combined (for selection lookup)
  const allBlogs = [...companyBlogs, ...omnivyraBlogs];

  // ── Load blogs when panel opens ───────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setBlogsLoading(true);
    fetch('/api/campaigns/blog-context', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { company_blogs: [], omnivyra_blogs: [] }))
      .then((d) => {
        setCompanyBlogs(d.company_blogs  ?? []);
        setOmnivyraBlogs(d.omnivyra_blogs ?? []);
        // Default to omnivyra tab if no company blogs
        if ((d.company_blogs ?? []).length === 0) setBlogTab('omnivyra');
      })
      .catch(() => {})
      .finally(() => setBlogsLoading(false));
  }, [open]);

  // ── Pre-select blog from blog → campaign flow ─────────────────────────────
  useEffect(() => {
    if (!open || !initialBlogId || allBlogs.length === 0) return;
    // Check company blogs first, then omnivyra
    const match =
      companyBlogs.find((b) => b.id === initialBlogId) ??
      omnivyraBlogs.find((b) => b.id === initialBlogId);
    if (!match) return;
    // Switch to the correct tab
    setBlogTab(match.source === 'company' ? 'company' : 'omnivyra');
    setSelectedIds((prev) => {
      if (prev.has(initialBlogId)) return prev;
      const next = new Set(prev);
      next.add(initialBlogId);
      return next;
    });
    setSelInsights((prev) => {
      const toAdd = match.key_insights.filter((i) => i && !prev.includes(i));
      return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
    });
  }, [open, initialBlogId, allBlogs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pre-fill topics from the recommendation signal ────────────────────────
  useEffect(() => {
    if (!open || !recommendationTopic) return;
    const tokens = recommendationTopic
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 3);
    setTopics([recommendationTopic, ...tokens].slice(0, 4));
  }, [open, recommendationTopic]);

  // ── Reset state when panel closes ─────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setSelectedIds(new Set());
      setSelInsights([]);
      setTopics([]);
      setBlogSearch('');
      setCustomInsight('');
      setTopicInput('');
    }
  }, [open]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const selectedBlogs   = allBlogs.filter((b) => selectedIds.has(b.id));
  const avInsights      = [...new Set(selectedBlogs.flatMap((b) => b.key_insights.filter(Boolean)))];
  const customInsights  = selInsights.filter((i) => !avInsights.includes(i));

  const search = blogSearch.toLowerCase();
  const activeList = blogTab === 'company' ? companyBlogs : omnivyraBlogs;
  const filteredBlogs = search
    ? activeList.filter(
        (b) =>
          b.title.toLowerCase().includes(search) ||
          b.tags.some((t) => t.toLowerCase().includes(search)) ||
          b.category.toLowerCase().includes(search),
      )
    : activeList;

  // ── Handlers ─────────────────────────────────────────────────────────────
  const toggleBlog = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        const blog = allBlogs.find((b) => b.id === id);
        if (blog) setSelInsights((si) => si.filter((i) => !blog.key_insights.includes(i)));
      } else {
        next.add(id);
        const blog = allBlogs.find((b) => b.id === id);
        if (blog) setSelInsights((si) => [...new Set([...si, ...blog.key_insights.filter(Boolean)])]);
      }
      return next;
    });
  };

  const toggleInsight = (i: string) =>
    setSelInsights((prev) => prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]);

  const addCustomInsight = () => {
    const t = customInsight.trim();
    if (t && !selInsights.includes(t)) { setSelInsights((p) => [...p, t]); setCustomInsight(''); }
  };

  const addTopic = () => {
    const t = topicInput.trim();
    if (t && !topics.includes(t)) { setTopics((p) => [...p, t]); setTopicInput(''); }
  };

  const handleConfirm = () => {
    onConfirm({
      blog_context: selectedBlogs.length > 0
        ? {
            blogs: selectedBlogs.map((b) => ({
              title:        b.title,
              summary:      b.summary,
              key_insights: b.key_insights,
              tags:         b.tags,
              headings:     b.h2_headings,
              source:       b.source,
            })),
          }
        : null,
      insight_context: selInsights.length > 0 ? { insights: selInsights } : null,
      topic_context:   topics.length > 0       ? { topics }               : null,
      ai_assist: aiAssist,
    });
  };

  const hasContext = selectedBlogs.length > 0 || selInsights.length > 0 || topics.length > 0;

  // ── Sub-components ────────────────────────────────────────────────────────
  const SectionHeader = ({
    section, icon, label, badge,
  }: { section: keyof typeof openSec; icon: React.ReactNode; label: string; badge?: number }) => (
    <button
      type="button"
      onClick={() => toggleSec(section)}
      className="flex w-full items-center justify-between px-6 py-3 hover:bg-gray-50 transition-colors"
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-semibold text-gray-900">{label}</span>
        {badge != null && badge > 0 && (
          <span className="rounded-full bg-[#0B5ED7] px-2 py-0.5 text-[10px] font-bold text-white">{badge}</span>
        )}
      </div>
      {openSec[section]
        ? <ChevronDown className="h-4 w-4 text-gray-400" />
        : <ChevronRight className="h-4 w-4 text-gray-400" />}
    </button>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  if (!open) return null;

  const modal = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">Campaign Assist</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Enrich this campaign with blog content, insights, and topics — or skip to use defaults.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100">

          {/* ── Section 1: Blogs ──────────────────────────────────────────── */}
          <section>
            <SectionHeader
              section="blogs"
              icon={<BookOpen className="h-4 w-4 text-[#0B5ED7]" />}
              label="Blogs"
              badge={selectedBlogs.length}
            />
            {openSec.blogs && (
              <div className="px-6 pb-4">

                {/* ── Source tabs ─────────────────────────────────────────── */}
                <div className="flex items-center gap-1 mb-3 rounded-lg border border-gray-100 bg-gray-50 p-1 w-fit">
                  <button
                    type="button"
                    onClick={() => setBlogTab('company')}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      blogTab === 'company'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Building2 className="h-3 w-3" />
                    Your Content
                    {companyBlogs.length > 0 && (
                      <span className="rounded-full bg-[#0B5ED7]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#0B5ED7]">
                        {companyBlogs.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBlogTab('omnivyra')}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      blogTab === 'omnivyra'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Globe className="h-3 w-3" />
                    Omnivyra Library
                    {omnivyraBlogs.length > 0 && (
                      <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                        {omnivyraBlogs.length}
                      </span>
                    )}
                  </button>
                </div>

                {/* Search */}
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                  <input
                    value={blogSearch}
                    onChange={(e) => setBlogSearch(e.target.value)}
                    placeholder="Search by title, tag, or topic…"
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-8 pr-3 text-sm text-gray-800 placeholder-gray-400 focus:border-[#0B5ED7] focus:outline-none"
                  />
                </div>

                {/* Selected chips */}
                {selectedBlogs.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {selectedBlogs.map((b) => (
                      <span
                        key={b.id}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${
                          b.source === 'company'
                            ? 'border-[#0B5ED7]/30 bg-blue-50 text-[#0B5ED7]'
                            : 'border-gray-300 bg-gray-100 text-gray-700'
                        }`}
                      >
                        {b.source === 'company' ? <Building2 className="h-3 w-3 shrink-0" /> : <Globe className="h-3 w-3 shrink-0" />}
                        {b.title.length > 32 ? b.title.slice(0, 32) + '…' : b.title}
                        <button type="button" onClick={() => toggleBlog(b.id)} className="ml-0.5 hover:text-red-500">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Blog list */}
                {blogsLoading ? (
                  <div className="flex items-center justify-center py-6 gap-2 text-sm text-gray-400">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading blogs…
                  </div>
                ) : filteredBlogs.length === 0 ? (
                  <p className="py-4 text-center text-sm text-gray-400">
                    {blogSearch
                      ? 'No blogs match your search.'
                      : blogTab === 'company'
                        ? 'No published company blogs yet.'
                        : 'No published blogs found.'}
                  </p>
                ) : (
                  <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                    {filteredBlogs.map((b) => {
                      const sel = selectedIds.has(b.id);
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => toggleBlog(b.id)}
                          className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                            sel ? 'border-[#0B5ED7]/40 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 leading-snug line-clamp-1">{b.title}</p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {b.tags.slice(0, 3).map((t) => (
                                  <span key={t} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">{t}</span>
                                ))}
                                {b.key_insights.length > 0 && (
                                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] text-green-600">
                                    {b.key_insights.length} insights
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 transition-colors ${sel ? 'border-[#0B5ED7] bg-[#0B5ED7]' : 'border-gray-300'}`}>
                              {sel && (
                                <div className="flex h-full items-center justify-center">
                                  <div className="h-1.5 w-1.5 rounded-full bg-white" />
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Section 2: Insights ───────────────────────────────────────── */}
          <section>
            <SectionHeader
              section="insights"
              icon={<Lightbulb className="h-4 w-4 text-amber-500" />}
              label="Insights"
              badge={selInsights.length}
            />
            {openSec.insights && (
              <div className="px-6 pb-4">
                {avInsights.length === 0 && customInsights.length === 0 && (
                  <p className="mb-3 text-xs text-gray-400">
                    Select blogs above to auto-load their key insights, or add custom ones below.
                  </p>
                )}

                {avInsights.length > 0 && (
                  <div className="mb-3 space-y-1.5">
                    {avInsights.map((insight) => (
                      <label
                        key={insight}
                        className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50"
                      >
                        <input
                          type="checkbox"
                          checked={selInsights.includes(insight)}
                          onChange={() => toggleInsight(insight)}
                          className="mt-0.5 h-3.5 w-3.5 accent-[#0B5ED7]"
                        />
                        <span className="text-sm text-gray-800 leading-snug">{insight}</span>
                      </label>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    value={customInsight}
                    onChange={(e) => setCustomInsight(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomInsight(); } }}
                    placeholder="Add a custom insight…"
                    className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:border-[#0B5ED7] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={addCustomInsight}
                    disabled={!customInsight.trim()}
                    className="rounded-lg bg-[#0B5ED7] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 hover:bg-[#0A52BE]"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                {customInsights.map((ins) => (
                  <div
                    key={ins}
                    className="mt-1.5 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5"
                  >
                    <span className="text-sm text-gray-800 leading-snug">{ins}</span>
                    <button type="button" onClick={() => toggleInsight(ins)} className="ml-2 text-gray-400 hover:text-red-500">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Section 3: Topics ────────────────────────────────────────── */}
          <section>
            <SectionHeader
              section="topics"
              icon={<Hash className="h-4 w-4 text-violet-500" />}
              label="Topics"
              badge={topics.length}
            />
            {openSec.topics && (
              <div className="px-6 pb-4">
                <p className="mb-3 text-xs text-gray-400">
                  Topics guide content direction. Pre-filled from the recommendation signal.
                </p>

                {topics.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {topics.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700"
                      >
                        #{t}
                        <button
                          type="button"
                          onClick={() => setTopics((p) => p.filter((x) => x !== t))}
                          className="ml-0.5 hover:text-red-500"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    value={topicInput}
                    onChange={(e) => setTopicInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTopic(); } }}
                    placeholder="Add a topic…"
                    className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:border-[#0B5ED7] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={addTopic}
                    disabled={!topicInput.trim()}
                    className="rounded-lg bg-violet-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 hover:bg-violet-600"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ── Section 4: AI Assist toggle ───────────────────────────────── */}
          <section className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                <div>
                  <p className="text-sm font-semibold text-gray-900">Enhance with AI</p>
                  <p className="text-xs text-gray-500">
                    {aiAssist
                      ? 'AI will use your selected context to enrich the campaign plan'
                      : 'Only the selected inputs will be used as-is'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAiAssist((v) => !v)}
                className={`relative h-6 w-11 rounded-full transition-colors focus:outline-none ${aiAssist ? 'bg-indigo-500' : 'bg-gray-300'}`}
                aria-checked={aiAssist}
                role="switch"
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${aiAssist ? 'translate-x-5' : 'translate-x-0.5'}`}
                />
              </button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium text-gray-500 hover:text-gray-700"
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B5ED7] px-5 py-2 text-sm font-semibold text-white hover:bg-[#0A52BE]"
          >
            {hasContext && <Sparkles className="h-4 w-4" />}
            {hasContext ? 'Continue with context' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof window === 'undefined') return null;
  return ReactDOM.createPortal(modal, document.body);
}

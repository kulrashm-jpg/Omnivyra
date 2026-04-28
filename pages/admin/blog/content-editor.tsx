'use client';

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Loader2, ArrowRight, AlertCircle, CheckCircle2, Sparkles,
  BookOpen, Eye, BarChart2, X, ChevronDown,
} from 'lucide-react';
import { RichTextEditor } from '../../../components/blog/RichTextEditor';

// ── Types ──────────────────────────────────────────────────────────────────
type BlogGenerationInput = {
  title?: string;
  excerpt?: string;
  content_html?: string;
  content?: string;
  content_markdown?: string;
  content_blocks?: unknown[];
  tags?: string[];
  category?: string;
  seo_meta_title?: string;
  seo_meta_description?: string;
  featured_image_url?: string;
  key_insights?: string[];
  [key: string]: unknown;
};

type AISuggestion = {
  type: 'grammar' | 'tone' | 'seo' | 'readability' | 'structure';
  title: string;
  description: string;
  suggestions: string[];
  applyFn: () => void;
  isApplying: boolean;
};

type ContentEditorState = {
  title: string;
  excerpt: string;
  content: string;
  featuredImageUrl: string;
  category: string;
  tags: string[];
  seoMetaTitle: string;
  seoMetaDescription: string;
};

type PrefillPayload = {
  output: BlogGenerationInput;
  confidence?: 'high' | 'medium';
  hookAssessment?: { strength: string; note: string };
  source?: string;
  selectedCompanyId?: string;
  prefillTopic?: string;
  prefillReason?: string;
  brief?: unknown;
};

// ── Helper: Extract content from generation output ───────────────────────
function extractContentFromOutput(output: BlogGenerationInput): Partial<ContentEditorState> {
  // Try multiple content sources in order
  let content = '';
  
  if (typeof output?.content_markdown === 'string') {
    content = output.content_markdown.trim();
  } else if (typeof output?.content === 'string') {
    content = output.content.trim();
  } else if (typeof output?.content_html === 'string') {
    // Strip HTML tags for editing (convert <p> tags to newlines)
    content = output.content_html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
  } else if (Array.isArray(output?.content_blocks)) {
    content = output.content_blocks
      .map((block: unknown) => {
        if (typeof block === 'object' && block !== null) {
          const b = block as Record<string, unknown>;
          return b.text || b.html || b.body || '';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }

  return {
    title: typeof output?.title === 'string' ? output.title : '',
    excerpt: typeof output?.excerpt === 'string' ? output.excerpt : '',
    content: content,
    featuredImageUrl: typeof output?.featured_image_url === 'string' ? output.featured_image_url : '',
    category: typeof output?.category === 'string' ? output.category : '',
    tags: Array.isArray(output?.tags) ? output.tags : [],
    seoMetaTitle: typeof output?.seo_meta_title === 'string' ? output.seo_meta_title : '',
    seoMetaDescription: typeof output?.seo_meta_description === 'string' ? output.seo_meta_description : '',
  };
}

export default function AdminBlogContentEditorPage() {
  const router = useRouter();
  const token = typeof router.query.prefill === 'string' ? router.query.prefill : '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [companyId, setCompanyId] = useState('');
  const [topic, setTopic] = useState('');
  const [confidence, setConfidence] = useState<'high' | 'medium' | 'low'>('medium');

  const [state, setState] = useState<ContentEditorState>({
    title: '',
    excerpt: '',
    content: '',
    featuredImageUrl: '',
    category: '',
    tags: [],
    seoMetaTitle: '',
    seoMetaDescription: '',
  });

  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [fetchingSuggestions, setFetchingSuggestions] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write');

  // ── Load prefill data ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!router.isReady) return;

    setLoading(true);
    setError(null);

    try {
      if (!token) {
        setError('Missing content data. Please restart from the Generate page.');
        setLoading(false);
        return;
      }

      const raw = sessionStorage.getItem(token);
      if (!raw) {
        setError('Content data expired. Please restart from the Generate page.');
        setLoading(false);
        return;
      }

      const payload = JSON.parse(raw) as PrefillPayload;
      if (!payload.output) {
        setError('Invalid content data.');
        setLoading(false);
        return;
      }

      setCompanyId(payload.selectedCompanyId || '');
      setTopic(payload.prefillTopic || '');
      setConfidence(payload.confidence || 'medium');

      const extracted = extractContentFromOutput(payload.output);
      setState((prev) => ({ ...prev, ...extracted }));

      // Clean up session storage after loading
      sessionStorage.removeItem(token);
    } catch (e) {
      setError('Failed to load content. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [router.isReady, token]);

  // ── AI Suggestions ────────────────────────────────────────────────────────
  const generateSuggestions = async () => {
    if (!companyId) {
      setError('Company context required for AI suggestions.');
      return;
    }

    setFetchingSuggestions(true);
    setError(null);

    try {
      const res = await fetch('/api/content/improve-draft', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          area: 'all',
          contentType: 'blog',
          draft: {
            title: state.title,
            excerpt: state.excerpt,
            seo_meta_title: state.seoMetaTitle,
            seo_meta_description: state.seoMetaDescription,
            tags: state.tags,
            content_blocks: [{ text: state.content, type: 'paragraph' }],
          },
        }),
      });

      const data = await res.json().catch(() => ({})) as {
        updated?: Partial<ContentEditorState>;
        suggestions?: Array<{
          type: string;
          title: string;
          description: string;
          suggestions: string[];
        }>;
        error?: string;
      };

      if (!res.ok) throw new Error(data?.error || 'AI suggestion failed');

      // Build suggestion objects
      const sugg: AISuggestion[] = [];

      // Grammar check
      sugg.push({
        type: 'grammar',
        title: '✨ Grammar & Clarity',
        description: 'Fix grammar, spelling, and sentence clarity',
        suggestions: [
          'Review sentences for active voice',
          'Check for consistent tense usage',
          'Verify punctuation placement',
        ],
        applyFn: () => {
          if (data.updated?.content) {
            setState((prev) => ({ ...prev, content: data.updated?.content || prev.content }));
          }
        },
        isApplying: false,
      });

      // Tone & voice
      sugg.push({
        type: 'tone',
        title: '🎯 Tone & Voice',
        description: 'Make writing more professional and consistent',
        suggestions: [
          'Adjust formality level',
          'Strengthen authoritative tone',
          'Reduce jargon for clarity',
        ],
        applyFn: () => {
          if (data.updated?.content) {
            setState((prev) => ({ ...prev, content: data.updated?.content || prev.content }));
          }
        },
        isApplying: false,
      });

      // Readability
      sugg.push({
        type: 'readability',
        title: '📖 Readability',
        description: 'Improve flow and make content scannable',
        suggestions: [
          `Current word count: ${state.content.split(/\s+/).length}`,
          'Break long paragraphs into shorter ones',
          'Add transitional phrases between ideas',
        ],
        applyFn: () => {
          if (data.updated?.content) {
            setState((prev) => ({ ...prev, content: data.updated?.content || prev.content }));
          }
        },
        isApplying: false,
      });

      // SEO
      sugg.push({
        type: 'seo',
        title: '🔍 SEO & Keywords',
        description: 'Optimize for search engines',
        suggestions: [
          `Meta title: ${state.seoMetaTitle || '(add title)'}`,
          `Meta description: ${state.seoMetaDescription || '(add description)'}`,
          'Include target keywords naturally in content',
        ],
        applyFn: () => {
          if (data.updated?.seoMetaTitle) {
            setState((prev) => ({
              ...prev,
              seoMetaTitle: data.updated?.seoMetaTitle || prev.seoMetaTitle,
              seoMetaDescription: data.updated?.seoMetaDescription || prev.seoMetaDescription,
            }));
          }
        },
        isApplying: false,
      });

      // Structure
      sugg.push({
        type: 'structure',
        title: '🏗️ Content Structure',
        description: 'Ensure proper flow and hierarchy',
        suggestions: [
          'Opening hook is engaging',
          'Key points are clearly introduced',
          'Call-to-action is present and aligned',
        ],
        applyFn: () => {
          if (data.updated?.content) {
            setState((prev) => ({ ...prev, content: data.updated?.content || prev.content }));
          }
        },
        isApplying: false,
      });

      setSuggestions(sugg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate suggestions');
    } finally {
      setFetchingSuggestions(false);
    }
  };

  const applySuggestion = (type: string) => {
    setSuggestions((prev) =>
      prev.map((s) => {
        if (s.type === type) {
          s.applyFn();
          return { ...s, isApplying: true };
        }
        return s;
      })
    );

    setTimeout(() => {
      setSuggestions((prev) =>
        prev.map((s) => (s.type === type ? { ...s, isApplying: false } : s))
      );
    }, 1500);
  };

  // ── Submit to /admin/blog/new ──────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!state.title.trim() || !state.content.trim()) {
      setError('Title and content are required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const prefillToken = `sa_blog_prefill_editor_${Date.now()}`;
      const prefillData = {
        output: {
          title: state.title,
          excerpt: state.excerpt,
          content: undefined,
          content_markdown: state.content, // Send as markdown for proper conversion
          featured_image_url: state.featuredImageUrl,
          category: state.category,
          tags: state.tags,
          seo_meta_title: state.seoMetaTitle,
          seo_meta_description: state.seoMetaDescription,
          content_blocks: [], // Let the new page use markdown
        },
        source: 'content_editor',
        confidence,
      };

      sessionStorage.setItem(prefillToken, JSON.stringify(prefillData));

      await router.push({
        pathname: '/admin/blog/new',
        query: { prefill: prefillToken },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to proceed');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-[#0B5ED7]" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Content Editor | Blog CMS</title>
      </Head>
      <div className="min-h-screen bg-gray-50">
        {/* Top bar */}
        <div className="border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between">
            <div>
              <Link href="/dashboard" className="flex shrink-0 items-center" aria-label="Home">
                <img
                  src="/logo.png"
                  alt="Omnivyra"
                  width={100}
                  height={40}
                  className="h-10 w-auto object-contain"
                />
              </Link>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => router.back()}
                className="text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                ← Back
              </button>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="mx-auto max-w-[1400px] p-6">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900">Content Editor</h1>
            <p className="mt-1 text-sm text-gray-600">
              {confidence === 'high' ? (
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  High-confidence draft — refine and customize as needed
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  Draft ready for editing — personalize to match your style
                </span>
              )}
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          <div className="flex gap-6">
            {/* ── Left: Editor ──────────────────────────────────────────────── */}
            <div className="flex-1 min-w-0">
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                {/* Tabs */}
                <div className="flex gap-4 border-b border-gray-200 pb-4 mb-6">
                  <button
                    onClick={() => setActiveTab('write')}
                    className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
                      activeTab === 'write'
                        ? 'text-[#0B5ED7] border-[#0B5ED7]'
                        : 'text-gray-600 border-transparent hover:text-gray-900'
                    }`}
                  >
                    <BookOpen className="inline-block h-4 w-4 mr-2" />
                    Edit Content
                  </button>
                  <button
                    onClick={() => setActiveTab('preview')}
                    className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
                      activeTab === 'preview'
                        ? 'text-[#0B5ED7] border-[#0B5ED7]'
                        : 'text-gray-600 border-transparent hover:text-gray-900'
                    }`}
                  >
                    <Eye className="inline-block h-4 w-4 mr-2" />
                    Preview
                  </button>
                </div>

                {activeTab === 'write' ? (
                  <div className="space-y-4">
                    {/* Title */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Title
                      </label>
                      <input
                        type="text"
                        value={state.title}
                        onChange={(e) => setState((prev) => ({ ...prev, title: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B5ED7] focus:border-transparent"
                        placeholder="Blog post title..."
                      />
                    </div>

                    {/* Excerpt */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Excerpt (brief summary)
                      </label>
                      <textarea
                        value={state.excerpt}
                        onChange={(e) => setState((prev) => ({ ...prev, excerpt: e.target.value }))}
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B5ED7] focus:border-transparent"
                        placeholder="Short description shown in listings..."
                      />
                    </div>

                    {/* Main content - Rich Text Editor */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Content
                        <span className="ml-2 text-xs text-gray-500">
                          {state.content.split(/\s+/).filter(Boolean).length} words
                        </span>
                      </label>
                      <RichTextEditor
                        value={state.content}
                        onChange={(content) => setState((prev) => ({ ...prev, content }))}
                        placeholder="Start writing your blog content..."
                        minHeight={450}
                      />
                    </div>

                    {/* Featured image */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Featured Image URL
                      </label>
                      <input
                        type="url"
                        value={state.featuredImageUrl}
                        onChange={(e) => setState((prev) => ({ ...prev, featuredImageUrl: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B5ED7] focus:border-transparent"
                        placeholder="https://example.com/image.jpg"
                      />
                    </div>

                    {/* Category */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Category
                      </label>
                      <input
                        type="text"
                        value={state.category}
                        onChange={(e) => setState((prev) => ({ ...prev, category: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B5ED7] focus:border-transparent"
                        placeholder="e.g., Marketing Intelligence"
                      />
                    </div>

                    {/* Tags */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Tags (comma-separated)
                      </label>
                      <textarea
                        value={state.tags.join(', ')}
                        onChange={(e) =>
                          setState((prev) => ({
                            ...prev,
                            tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                          }))
                        }
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B5ED7] focus:border-transparent"
                        placeholder="tag1, tag2, tag3"
                      />
                    </div>

                    {/* Advanced SEO */}
                    <div className="pt-4 border-t border-gray-200">
                      <button
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                      >
                        <ChevronDown
                          className={`h-4 w-4 transform transition-transform ${
                            showAdvanced ? 'rotate-180' : ''
                          }`}
                        />
                        Advanced SEO Settings
                      </button>

                      {showAdvanced && (
                        <div className="mt-4 space-y-4 pl-6 border-l-2 border-gray-200">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              SEO Meta Title
                            </label>
                            <input
                              type="text"
                              value={state.seoMetaTitle}
                              onChange={(e) =>
                                setState((prev) => ({ ...prev, seoMetaTitle: e.target.value }))
                              }
                              maxLength={60}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B5ED7] focus:border-transparent text-sm"
                              placeholder="Max 60 characters for search engines..."
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              SEO Meta Description
                            </label>
                            <textarea
                              value={state.seoMetaDescription}
                              onChange={(e) =>
                                setState((prev) => ({ ...prev, seoMetaDescription: e.target.value }))
                              }
                              maxLength={160}
                              rows={2}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B5ED7] focus:border-transparent text-sm"
                              placeholder="Max 160 characters for search engines..."
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Preview mode */
                  <div className="prose prose-sm max-w-none">
                    <h1>{state.title || 'Untitled'}</h1>
                    {state.featuredImageUrl && (
                      <img src={state.featuredImageUrl} alt={state.title} className="w-full h-auto rounded-lg" />
                    )}
                    {state.excerpt && <p className="italic text-gray-600">{state.excerpt}</p>}
                    <div
                      className="prose prose-sm prose-slate max-w-none"
                      dangerouslySetInnerHTML={{ __html: state.content }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* ── Right: AI Suggestions ──────────────────────────────────────── */}
            <div className="w-80 shrink-0">
              <div className="sticky top-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <div className="mb-4">
                  <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-yellow-500" />
                    AI Suggestions
                  </h2>
                  <p className="mt-1 text-xs text-gray-600">
                    Click "Apply" to implement AI-powered improvements
                  </p>
                </div>

                {suggestions.length === 0 ? (
                  <button
                    onClick={generateSuggestions}
                    disabled={fetchingSuggestions}
                    className="w-full px-4 py-2 bg-[#0B5ED7] text-white text-sm font-medium rounded-lg hover:bg-[#0A50C0] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    {fetchingSuggestions ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Get AI Suggestions
                      </>
                    )}
                  </button>
                ) : (
                  <div className="space-y-3">
                    {suggestions.map((sugg) => (
                      <div
                        key={sugg.type}
                        className="rounded-lg border border-gray-200 bg-gray-50 p-3"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h3 className="text-sm font-medium text-gray-900">{sugg.title}</h3>
                            <p className="text-xs text-gray-600 mt-1">{sugg.description}</p>
                          </div>
                        </div>

                        <ul className="text-xs text-gray-700 space-y-1 mb-3 pl-4 list-disc">
                          {sugg.suggestions.slice(0, 2).map((s, idx) => (
                            <li key={idx}>{s}</li>
                          ))}
                        </ul>

                        <button
                          onClick={() => applySuggestion(sugg.type)}
                          disabled={sugg.isApplying}
                          className="w-full px-3 py-1.5 bg-[#0B5ED7] text-white text-xs font-medium rounded hover:bg-[#0A50C0] disabled:opacity-50 transition-colors flex items-center justify-center gap-1"
                        >
                          {sugg.isApplying ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Applied
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-3 w-3" />
                              Apply
                            </>
                          )}
                        </button>
                      </div>
                    ))}

                    <button
                      onClick={generateSuggestions}
                      disabled={fetchingSuggestions}
                      className="w-full px-3 py-1.5 text-gray-700 text-xs font-medium border border-gray-300 rounded hover:bg-gray-100 transition-colors"
                    >
                      Refresh Suggestions
                    </button>
                  </div>
                )}

                {/* Stats */}
                <div className="mt-6 pt-6 border-t border-gray-200 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Word Count:</span>
                    <span className="font-medium">{state.content.split(/\s+/).filter(Boolean).length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Title:</span>
                    <span className={`font-medium ${state.title.length < 30 ? 'text-amber-600' : 'text-green-600'}`}>
                      {state.title.length}/70
                    </span>
                  </div>
                </div>

                {/* Submit button */}
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !state.title.trim() || !state.content.trim()}
                  className="w-full mt-6 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Proceeding...
                    </>
                  ) : (
                    <>
                      Continue to Publish
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

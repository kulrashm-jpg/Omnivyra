import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import {
  FileText, Plus, Edit2, Trash2, Globe, Loader2, AlertCircle,
  CheckCircle2, ExternalLink, ChevronLeft, Bold, Italic, Underline,
  List, ListOrdered, Quote, Heading1, Heading2, Link2, Undo2, Search, X, Zap,
  Lightbulb, TrendingUp, Rocket, BarChart2, Network, BookOpen, Sparkles,
  AlertTriangle, ArrowRight, Pencil, Copy, Check, RefreshCw, XCircle, ChevronUp, ChevronDown,
} from 'lucide-react';
import { useCompanyContext } from '../components/CompanyContext';
import { buildImageQuery, searchImages as searchStockImages, type ImageResult } from '../lib/media/imageService';
import BlogAnalyticsPanel from '../components/blog/BlogAnalyticsPanel';
import type { BlogGenerationOutput } from '../lib/blog/blogGenerationEngine';
import AIBlogCardModal from '../components/blog/AIBlogCardModal';
import {
  classifyPost, getAmplificationActions, getRecoveryActions, buildAuthorityLoop, buildGrowthSummary,
  type PerformanceClass,
} from '../lib/blog/growthEngine';
import {
  buildTopicClusters, detectContentGaps, generateRecommendations, PLATFORM_DEFAULT_PILLARS,
  type TopicCluster, type ContentGap, type Recommendation, type ExistingPostMeta,
} from '../lib/blog/topicDetection';
import {
  computeAllMetrics, computeTopicPerformance, generatePerformanceInsights, buildDistributionQueue, generateTopicNarratives,
  type PostMetrics, type PostPerformance, type PerformanceInsight, type DistributionItem, type TopicNarrative,
} from '../lib/blog/performanceEngine';
import {
  inferRelatedEdges, RELATIONSHIP_LABELS,
  type RelationshipType, type BlogEdge,
} from '../lib/blog/knowledgeGraph';
import {
  generateRepurposedContent, extractRepurposeInput,
  type RepurposedContent,
} from '../lib/blog/repurposingEngine';
import {
  buildWritingStyleProfile,
  formatStyleInstructions,
  type WritingStyleProfile,
} from '../lib/content/writingStyleEngine';
import type { CompanyProfile } from '../backend/services/companyProfileService';

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
  views_count?: number;
  likes_count?: number;
  has_summary?: boolean;
  internal_links?: number;
  references_count?: number;
}
interface BlogIntegration { id: string; name: string; type: string; status: string }

interface PostMeta extends ExistingPostMeta {
  views_count:      number;
  likes_count:      number;
  status:           string;
  has_summary:      boolean;
  internal_links:   number;
  references_count: number;
  published_at:     string | null;
}

interface SeriesPost {
  blog_id:  string;
  position: number;
  title:    string;
  slug:     string;
  status:   string;
}

interface SeriesRow {
  id:                 string;
  title:              string;
  slug:               string;
  description:        string | null;
  blog_series_posts:  SeriesPost[];
}

interface RelRow {
  id:               string;
  source_blog_id:   string;
  target_blog_id:   string;
  relationship_type: string;
}

interface BriefInsight {
  company_id: string;
  company_name: string;
  company_context: string;
  current_content: string;
  writing_style: string;
  writing_style_profile: WritingStyleProfile | null;
  related_titles: string[];
  intent: 'awareness' | 'authority' | 'conversion' | 'retention';
  tone: string;
}

type EnrichedGap = ContentGap & { brief: BriefInsight };

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

// ─── Constants ─────────────────────────────────────────────────────────────────
const TAB_LABELS = [
  { id: 'recommendations', label: 'What to Write',   icon: Lightbulb  },
  { id: 'performance',     label: 'Performance',     icon: TrendingUp },
  { id: 'growth',          label: 'Growth Engine',   icon: Rocket     },
  { id: 'coverage',        label: 'Topic Coverage',  icon: BarChart2  },
  { id: 'graph',           label: 'Knowledge Graph', icon: Network    },
  { id: 'series',          label: 'Series',          icon: BookOpen   },
] as const;
type TabId = typeof TAB_LABELS[number]['id'];

const PRIORITY_COLOURS: Record<string, string> = {
  high:   'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low:    'bg-gray-100 text-gray-600',
};

const TYPE_COLOURS: Record<string, string> = {
  write:    'bg-[#0A66C2]/10 text-[#0A66C2]',
  optimize: 'bg-violet-100 text-violet-700',
  link:     'bg-teal-100 text-teal-700',
  series:   'bg-orange-100 text-orange-700',
};

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

  // View: 'dashboard', 'editor', or 'intelligence'
  const [view, setView] = useState<'dashboard' | 'editor' | 'intelligence'>('dashboard');
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

  // Save/publish state
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editorKey, setEditorKey] = useState(0);

  // Dashboard filter
  const [filterTab, setFilterTab] = useState<'all' | 'draft' | 'published'>('all');

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Intelligence tabs
  const [intelligenceTab, setIntelligenceTab] = useState<TabId>('recommendations');
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const [intelligenceError, setIntelligenceError] = useState<string | null>(null);

  // Intelligence data
  const [posts, setPosts] = useState<PostMeta[]>([]);
  const [series, setSeries] = useState<SeriesRow[]>([]);
  const [relationships, setRelationships] = useState<RelRow[]>([]);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [companyContextNote, setCompanyContextNote] = useState('');

  // AI Blog Card Modal
  const [isAICardModalOpen, setIsAICardModalOpen] = useState(false);

  // AI-generated content metadata  
  const [hookAssessment, setHookAssessment] = useState<{ strength: 'strong' | 'moderate' | 'weak'; note?: string } | null>(null);
  const [generatedAngleType, setGeneratedAngleType] = useState<string | null>(null);
  const [rewritingHook, setRewritingHook] = useState(false);

  // Growth Engine state
  const [growthTier, setGrowthTier] = useState<PerformanceClass | 'all'>('all');
  const [selectedGrowthId, setSelectedGrowthId] = useState<string | null>(null);
  const [repurposedContent, setRepurposedContent] = useState<RepurposedContent | null>(null);
  const [repurposeTab, setRepurposeTab] = useState<'li1' | 'li2' | 'li3' | 'tw' | 'email' | 'card'>('li1');
  const [generatingRep, setGeneratingRep] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Series management
  const [newSeriesTitle, setNewSeriesTitle] = useState('');
  const [newSeriesDesc, setNewSeriesDesc] = useState('');
  const [savingSeries, setSavingSeries] = useState(false);
  const [editSeries, setEditSeries] = useState<SeriesRow | null>(null);
  const [editPosts, setEditPosts] = useState<SeriesPost[]>([]);
  const [addPostId, setAddPostId] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Creator content generation from blog cards
  const [isCreatorModalOpen, setIsCreatorModalOpen] = useState(false);
  const [selectedCreatorType, setSelectedCreatorType] = useState<'video_script' | 'carousel' | 'story' | null>(null);
  const [selectedGapForCreator, setSelectedGapForCreator] = useState<typeof gaps[0] | null>(null);
  const [creatorContentGenerating, setCreatorContentGenerating] = useState(false);

  // Relationships
  const [relSource, setRelSource] = useState('');
  const [relTarget, setRelTarget] = useState('');
  const [relType, setRelType] = useState<RelationshipType>('related');
  const [savingRel, setSavingRel] = useState(false);

  // Callbacks (after all useState)
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

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true); 
    setError('');
    try {
      const qs = `company_id=${selectedCompanyId}`;
      const [intelligenceRes, wpRes, apiRes, profileRes] = await Promise.all([
        fetch(`/api/company/blog/intelligence?${qs}`, { credentials: 'include' }).then(r => r.json()),
        fetch(`/api/integrations?${qs}&type=wordpress`, { credentials: 'include' }).then(r => r.json()),
        fetch(`/api/integrations?${qs}&type=custom_blog_api`, { credentials: 'include' }).then(r => r.json()),
        fetch(`/api/company-profile?company_id=${selectedCompanyId}`, { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      const blogsData = intelligenceRes.posts || [];
      const seriesData = intelligenceRes.series || [];
      const relData = intelligenceRes.relationships || [];
      
      setBlogs(blogsData);
      setSeries(seriesData);
      setRelationships(relData);
      
      setPosts(blogsData.map(b => ({
        id: b.id,
        title: b.title,
        slug: b.slug || '',
        status: b.status,
        excerpt: b.excerpt || '',
        tags: b.tags || [],
        category: b.category || '',
        views_count: b.views_count || 0,
        likes_count: b.likes_count || 0,
        has_summary: b.has_summary || false,
        internal_links: b.internal_links || 0,
        references_count: b.references_count || 0,
        published_at: b.published_at,
      })));
      setBlogIntegrations([...(wpRes.integrations || []), ...(apiRes.integrations || [])]);
      setCompanyIndustry(profileRes?.profile?.industry ?? profileRes?.industry ?? null);
      setCompanyProfile(profileRes?.profile || null);
      
      // Build company context note from profile
      if (profileRes?.profile) {
        const { industry, target_audience, brand_voice } = profileRes.profile;
        const parts = [industry, target_audience, brand_voice].filter(Boolean);
        setCompanyContextNote(parts.join(' | ') || '');
      }
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
    setHookAssessment(null);
  }
  function openNew() {
    setEditingBlog(null);
    setEditorTitle('');
    setEditorContent('');
    setEditorIntegrationId('');
    clearEditorMeta();
    setSaveMsg(null);
    setEditorKey(prev => prev + 1);
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
    setGeneratedAngleType((blog as any).angle_type || null);
    setSaveMsg(null);
    setEditorKey(prev => prev + 1);
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
      ...(hookAssessment                 ? { hook_strength: hookAssessment.strength }           : {}),
      is_featured: editorIsFeatured,
    };
  }

  // ── Update angle×industry matrix after first save of a generated post ────────
  function updateAngleIndustryMatrix(contentScore: number) {
    // Disabled: generatedAngleType no longer tracked
    if (true || !companyIndustry || !selectedCompanyId) return;
    // Fire-and-forget — non-blocking
    fetch('/api/track/angle-industry-matrix', {
      method:  'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        company_id:    selectedCompanyId,
        industry:      companyIndustry,
        angle_type:    generatedAngleType,
        content_score: Math.min(100, Math.max(0, Math.round(contentScore))),
      }),
    }).catch(() => { /* ignore */ });
  }

  // ── Rewrite Hook ────────────────────────────────────────────────────────────
  async function rewriteHook() {
    if (!editorTitle.trim() || !editorContent.trim()) return;
    setRewritingHook(true);
    try {
      const response = await fetch('/api/blogs/rewrite-hook', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editorTitle,
          content: editorContent,
          company_id: selectedCompanyId,
        }),
      });
      const data = await response.json();
      if (response.ok && data.rewritten_content) {
        setEditorContent(data.rewritten_content);
        if (data.assessment) {
          setHookAssessment({
            strength: data.assessment.strength || 'moderate',
            note: data.assessment.note,
          });
        }
      }
    } catch (error) {
      console.error('Failed to rewrite hook:', error);
    } finally {
      setRewritingHook(false);
    }
  }

  async function saveDraft() {
    if (!editorTitle.trim()) { setSaveMsg({ ok: false, text: 'Add a title first.' }); return; }
    setSaving(true); setSaveMsg(null);
    try {
      const body = buildBlogPayload();
      const url = editingBlog ? `/api/blogs/${editingBlog.id}` : '/api/blogs';
      const method = editingBlog ? 'PUT' : 'POST';
      const r = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
        const r = await fetch('/api/blogs', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await r.json();
        if (!r.ok) { setSaveMsg({ ok: false, text: data.error || 'Save failed.' }); setPublishing(false); return; }
        blogId = data.blog.id;
        setEditingBlog(data.blog);
      } else {
        await fetch(`/api/blogs/${blogId}`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
    } catch { setSaveMsg({ ok: false, text: 'Failed to save before publishing.' }); setPublishing(false); return; }

    // Now publish
    try {
      const r = await fetch(`/api/blogs/${blogId}/publish`, {
        method: 'POST',
        credentials: 'include',
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
    await fetch(`/api/blogs/${deleteConfirm.id}?company_id=${selectedCompanyId}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
    setDeleteConfirm(null);
    setDeleting(false);
    fetchAll();
  }

  // ── Intelligence Helpers ───────────────────────────────────────────────────
  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    });
  };

  const generateRepurpose = async (postId: string) => {
    setGeneratingRep(true);
    setRepurposedContent(null);
    try {
      const r = await fetch(`/api/blogs/${postId}`, { credentials: 'include' });
      const post = r.ok ? await r.json() : null;
      if (post) {
        const input = extractRepurposeInput(post);
        setRepurposedContent(generateRepurposedContent(input));
        setRepurposeTab('li1');
      }
    } finally {
      setGeneratingRep(false);
    }
  };

  const handleAICardCreated = (card: any) => {
    const token = `ai_card_${Date.now()}`;
    try {
      sessionStorage.setItem(token, JSON.stringify(card));
    } catch {
      // Continue without storage token if browser blocks it
    }
    void router.push({
      pathname: '/blogs/generate',
      query: {
        prefill_source: 'company_admin_ai_card_creation',
        prefill_topic: card.topic,
        prefill_reason: card.reason,
        prefill_priority: card.priority || 'medium',
        prefill_company_id: selectedCompanyId,
        prefill_intent: card.intent,
        prefill_tone: card.tone,
        prefill_card: token,
      },
    });
  };

  const createSeries = async () => {
    if (!newSeriesTitle.trim()) return;
    setSavingSeries(true);
    try {
      const r = await fetch(`/api/company/blog/series?company_id=${selectedCompanyId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newSeriesTitle.trim(), description: newSeriesDesc.trim() || undefined, company_id: selectedCompanyId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSeries((prev) => [{ ...d, blog_series_posts: [] }, ...prev]);
      setNewSeriesTitle('');
      setNewSeriesDesc('');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSavingSeries(false);
    }
  };

  const deleteSeries = async (id: string) => {
    if (!confirm('Delete this series? Posts are not deleted.')) return;
    await fetch(`/api/company/blog/series/${id}?company_id=${selectedCompanyId}`, { method: 'DELETE', credentials: 'include' });
    setSeries((prev) => prev.filter((s) => s.id !== id));
  };

  const openEditSeries = (s: SeriesRow) => {
    setEditSeries(s);
    setEditPosts([...(s.blog_series_posts ?? [])].sort((a, b) => a.position - b.position));
  };

  const saveEditSeries = async () => {
    if (!editSeries) return;
    setSavingEdit(true);
    try {
      await fetch(`/api/company/blog/series/${editSeries.id}?company_id=${selectedCompanyId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:       editSeries.title,
          description: editSeries.description,
          company_id:  selectedCompanyId,
          posts:       editPosts.map((p, i) => ({ blog_id: p.blog_id, position: i })),
        }),
      });
      setSeries((prev) => prev.map((s) =>
        s.id === editSeries.id
          ? { ...editSeries, blog_series_posts: editPosts }
          : s,
      ));
      setEditSeries(null);
    } catch {
      alert('Failed to save');
    } finally {
      setSavingEdit(false);
    }
  };

  const addPostToEdit = () => {
    if (!addPostId) return;
    const post = blogs.find((p) => p.id === addPostId);
    if (!post) return;
    if (editPosts.find((p) => p.blog_id === addPostId)) return;
    setEditPosts((prev) => [
      ...prev,
      { blog_id: post.id, position: prev.length, title: post.title, slug: post.slug || '', status: post.status },
    ]);
    setAddPostId('');
  };

  const createRelationship = async () => {
    if (!relSource || !relTarget) return;
    setSavingRel(true);
    try {
      const r = await fetch(`/api/company/blog/relationships?company_id=${selectedCompanyId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_blog_id: relSource, target_blog_id: relTarget, relationship_type: relType, company_id: selectedCompanyId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setRelationships((prev) => [d, ...prev]);
      setRelSource(''); setRelTarget('');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSavingRel(false);
    }
  };

  const deleteRelationship = async (id: string) => {
    await fetch(`/api/company/blog/relationships?id=${id}&company_id=${selectedCompanyId}`, { method: 'DELETE', credentials: 'include' });
    setRelationships((prev) => prev.filter((r) => r.id !== id));
  };

  // ── Filtered list ──────────────────────────────────────────────────────────
  const displayed = blogs.filter(b => filterTab === 'all' || b.status === filterTab);
  const draftCount = blogs.filter(b => b.status === 'draft').length;
  const publishedCount = blogs.filter(b => b.status === 'published').length;

  // ─────────────────────────────────────────────────────────────────────────
  // EDITOR VIEW
  // ─────────────────────────────────────────────────────────────────────────
  const showEditor = view === 'editor';
  
  // All computations must happen before any returns
  const tabCls = (t: 'all' | 'draft' | 'published') =>
    `px-4 py-2 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap ${filterTab === t ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`;

  // ── Computed Intelligence ──────────────────────────────────────────────────
  const { clusters, gaps, recommendations, inferred, allMetrics, topicPerf, perfInsights, distQueue, narratives, growthSummary, classifiedMetrics } = useMemo(() => {
    if (posts.length === 0) {
      // For new users with no blog posts, generate default starter recommendations with rich context
      const defaultGaps: ContentGap[] = [
        {
          topic: 'Getting Started Guide',
          slug: 'getting-started-guide',
          reason: `Help new visitors understand how to get started with your offerings. A foundational "101" guide builds authority and captures awareness-stage traffic.`,
          priority: 'high',
          relatedTo: [],
        },
        {
          topic: 'Common Pain Points & Solutions',
          slug: 'common-pain-points-solutions',
          reason: `Address the top problems your audience faces. This establishes expertise and captures intent-driven search traffic.`,
          priority: 'high',
          relatedTo: [],
        },
        {
          topic: 'Case Study or Success Stories',
          slug: 'case-study-success-stories',
          reason: `Demonstrate real-world results with an in-depth case study. Builds credibility and converts consideration-stage leads.`,
          priority: 'medium',
          relatedTo: [],
        },
        {
          topic: 'Industry Trends & Insights',
          slug: 'industry-trends-insights',
          reason: `Share timely trends, data, or insights relevant to your space. Positions you as a thought leader and captures trending search queries.`,
          priority: 'medium',
          relatedTo: [],
        },
        {
          topic: 'Expert Comparison or Alternatives',
          slug: 'expert-comparison-alternatives',
          reason: `Compare your approach or product to alternatives. Converts evaluation-stage prospects who are researching options.`,
          priority: 'medium',
          relatedTo: [],
        },
      ];

      // Enrich with BriefInsight context (matching super admin pattern)
      const enrichedGaps: (ContentGap & { brief?: BriefInsight })[] = defaultGaps.map((gap) => ({
        ...gap,
        brief: {
          company_id: selectedCompanyId || 'default',
          company_name: 'Your Company',
          company_context: `Start strong with foundational content that teaches your audience the basics and establishes your expertise in your market.`,
          current_content: 'No blog posts yet. Get started with these pillar topics.',
          writing_style: companyProfile?.brand_voice || 'Clear, professional, and helpful',
          writing_style_profile: {
            tone: 'Professional',
            voice: 'Authoritative but approachable',
            formality: 'Semi-formal',
            complexity: 'Accessible to general audience',
          } as unknown as WritingStyleProfile,
          related_titles: [],
          intent: gap.priority === 'high' ? 'authority' : 'awareness',
          tone: 'Professional and helpful',
        }
      }));

      const defaultRecs: Recommendation[] = [
        {
          type: 'write',
          action: `Start with 1-2 foundational "pillar" posts`,
          reason: `These become the cornerstone of your content strategy. They're long-form (2000+ words), comprehensive guides that establish your authority. Link all future posts to these.`,
          priority: 'high',
          targetSlug: null,
        },
        {
          type: 'write',
          action: `Create 3-4 problem-solution posts that align with your audience's top questions`,
          reason: `These mid-form posts (1000-1500 words) capture specific search intent and build internal linking opportunities.`,
          priority: 'high',
          targetSlug: null,
        },
        {
          type: 'optimize',
          action: `Plan your content calendar for the next 30 days`,
          reason: `Map out topics, formats (blog, case study, video, guide), and publishing cadence. Consistency signals quality to both search engines and readers.`,
          priority: 'medium',
          targetSlug: null,
        },
      ];

      return {
        clusters: [], gaps: enrichedGaps as ContentGap[], recommendations: defaultRecs, inferred: [],
        allMetrics: [], topicPerf: [], perfInsights: [], distQueue: [], narratives: [],
        growthSummary: null, classifiedMetrics: [],
      };
    }

    // ── Build seriesPostIdSet (like super admin) ────────────────────────────
    const seriesPostIdSet = new Set(
      series.flatMap((s: SeriesRow) =>
        (s.blog_series_posts ?? []).map((sp: SeriesPost) => sp.blog_id),
      ),
    );

    // Topic clusters and gaps
    const clusters = buildTopicClusters(posts as ExistingPostMeta[]);
    const gapResult = detectContentGaps(clusters, posts as ExistingPostMeta[], PLATFORM_DEFAULT_PILLARS);
    const recs = generateRecommendations(gapResult.gaps, clusters, posts as any[]);

    // Performance metrics
    const allMetrics = computeAllMetrics(posts as PostPerformance[], seriesPostIdSet);
    const topicPerf = computeTopicPerformance(allMetrics);
    const perfInsights = generatePerformanceInsights(allMetrics, seriesPostIdSet);
    const distQueue = buildDistributionQueue(allMetrics);
    const narratives = generateTopicNarratives(topicPerf);

    // Growth analysis
    const classifiedMetrics = allMetrics
      .filter((m) => m.status === 'published')
      .map((m) => ({ ...m, _class: classifyPost(m) as PerformanceClass }));
    const growthSummary = classifiedMetrics.length > 0 ? buildGrowthSummary(classifiedMetrics) : null;

    // ── Enrich gaps with BriefInsight (like super admin) ────────────────────
    const topTags = posts
      .flatMap((p: any) => p.tags || [])
      .reduce<Record<string, number>>((acc, tag) => {
        const key = String(tag || '').trim().toLowerCase();
        if (!key) return acc;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
    const frequentTags = Object.entries(topTags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tag]) => tag);

    // Writing style: use engine when profile is available (like super admin)
    let styleProfile: WritingStyleProfile | null = null;
    let writingStyleText: string;

    if (companyProfile) {
      styleProfile = buildWritingStyleProfile(companyProfile);
      writingStyleText = formatStyleInstructions(styleProfile);
      if (frequentTags.length > 0) {
        writingStyleText += `\n  Maintain topical continuity with tags: ${frequentTags.join(', ')}`;
      }
    } else {
      writingStyleText = [
        'Lead with a concrete business problem in opening paragraph.',
        'Use authoritative, evidence-led tone with actionable takeaways.',
        frequentTags.length > 0
          ? `Maintain topical continuity with tags: ${frequentTags.join(', ')}.`
          : 'Maintain topical continuity with existing category language.',
        'Include internal linking opportunities and end with practical summary.',
      ].join(' ');
    }

    const toneText = styleProfile?.tone_summary || 'Confident, analytical, and practical';

    const enrichedGaps: EnrichedGap[] = gapResult.gaps.map((gap) => {
      const relatedTitles = posts
        .filter((p: any) => gap.relatedTo.some((r) => p.title.toLowerCase().includes(r.toLowerCase()) || r.toLowerCase().includes(p.title.toLowerCase())))
        .slice(0, 3)
        .map((p: any) => p.title);

      const bestPerformers = [...posts]
        .filter((p: any) => p.status === 'published')
        .sort((a: any, b: any) => ((b as any).views_count || 0) - ((a as any).views_count || 0))
        .slice(0, 3)
        .map((p: any) => p.title);

      const currentContent = relatedTitles.length > 0
        ? `Existing coverage: ${relatedTitles.join('; ')}. Expand beyond repeated angles.`
        : `No direct coverage yet. Reference adjacent winners: ${bestPerformers.join('; ') || 'none available'}.`;

      const brief: BriefInsight = {
        company_id: selectedCompanyId || '',
        company_name: 'Your Company',
        company_context: companyContextNote || 'Company context available from profile.',
        current_content: currentContent,
        writing_style: writingStyleText,
        writing_style_profile: styleProfile,
        related_titles: relatedTitles,
        intent: gap.priority === 'high' ? 'authority' : gap.priority === 'medium' ? 'conversion' : 'awareness',
        tone: toneText,
      };

      return { ...gap, brief };
    });

    // Knowledge graph
    const nodes = posts.filter((b: any) => b.status === 'published').map((b: any) => ({
      id: b.id, title: b.title, slug: b.slug, category: b.category,
      tags: b.tags, views_count: b.views_count || 0,
      published_at: b.published_at,
    }));
    const existingEdges = relationships.map((r) => ({
      id: r.id, sourceId: r.source_blog_id, targetId: r.target_blog_id,
      type: r.relationship_type as RelationshipType,
      sourceTitle: posts.find((b: any) => b.id === r.source_blog_id)?.title ?? '',
      targetTitle: posts.find((b: any) => b.id === r.target_blog_id)?.title ?? '',
      sourceSlug: (posts.find((b: any) => b.id === r.source_blog_id) as any)?.slug ?? '',
      targetSlug: (posts.find((b: any) => b.id === r.target_blog_id) as any)?.slug ?? '',
    })) as BlogEdge[];
    const inferred = inferRelatedEdges(nodes, existingEdges);

    return {
      clusters, gaps: enrichedGaps, recommendations: recs, inferred,
      allMetrics, topicPerf, perfInsights, distQueue, narratives,
      growthSummary, classifiedMetrics,
    };
  }, [posts, relationships, series, selectedCompanyId, companyContextNote, companyProfile]);

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

  // ── Editor View (after hooks) ──────────────────────────────────────────────
  if (showEditor) {
    const wc = wordCount(editorContent);
    const isPublished = editingBlog?.status === 'published';

    return (
      <div className="min-h-screen bg-white">
        {/* Editor top bar - truncated for space (use version from git history if needed full code) */}
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

        {/* Stats summary (abbreviated editor) */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 bg-gray-50 rounded-lg mt-4">
          <div className="flex gap-6 text-sm text-gray-600">
            <div>Words: <span className="font-medium text-gray-900">{wc}</span></div>
            <div>Characters: <span className="font-medium text-gray-900">{stripHtml(editorContent).length}</span></div>
            {editingBlog && <div>Last saved: <span className="font-medium text-gray-900">{fmtDate(editingBlog.updated_at)}</span></div>}
          </div>
        </div>

        {/* Basic editor (placeholder - implement full editor if needed) */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          <input
            value={editorTitle}
            onChange={e => setEditorTitle(e.target.value)}
            placeholder="Blog title..."
            className="w-full text-3xl font-bold text-gray-900 placeholder-gray-300 border-0 focus:outline-none mb-6 bg-transparent"
          />
          <textarea
            value={editorContent}
            onChange={e => setEditorContent(e.target.value)}
            placeholder="Write your blog content here..."
            rows={15}
            className="w-full border border-gray-200 rounded-lg px-4 py-3 font-mono text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder-gray-300"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Blog</h1>
            <p className="text-sm text-gray-500 mt-0.5">Write, publish, and manage your blog posts.</p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <button
                onClick={openNew}
                className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors">
                <Plus className="h-4 w-4" /> Write Blog
              </button>
            </div>
          )}
        </div>

        {/* View Tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          <button
            onClick={() => setView('dashboard')}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
              view === 'dashboard'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Posts
          </button>
          <button
            onClick={() => setView('intelligence')}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
              view === 'intelligence'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Intelligence
          </button>
        </div>

        {/* Dashboard Content */}
        {view === 'dashboard' && (
          <>
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
        </>
        )}

        {/* Intelligence View - Full 6-Tab Dashboard */}
        {view === 'intelligence' && (
          <div className="space-y-8">
            {/* Stats Row */}
            <div className="grid grid-cols-5 gap-4">
              {[
                { label: 'Published', value: blogs.filter((b) => b.status === 'published').length },
                { label: 'Drafts', value: blogs.filter((b) => b.status === 'draft').length },
                { label: 'Series', value: series.length },
                { label: 'Connections', value: relationships.length },
                { label: 'Total Views', value: blogs.reduce((s, b) => s + ((b as any).views_count || 0), 0).toLocaleString() },
              ].map(({ label, value }) => (
                <div key={label} className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                  <p className="text-xl font-bold text-gray-900">{value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-1 overflow-x-auto border-b border-gray-200 pb-0">
              {[
                { id: 'recommendations', label: 'What to Write', icon: Lightbulb },
                { id: 'performance', label: 'Performance', icon: TrendingUp },
                { id: 'growth', label: 'Growth Engine', icon: Rocket },
                { id: 'coverage', label: 'Topic Coverage', icon: BarChart2 },
                { id: 'graph', label: 'Knowledge Graph', icon: Network },
                { id: 'series', label: 'Series', icon: BookOpen },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setIntelligenceTab(id as any)}
                  className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                    intelligenceTab === id
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-gray-500 hover:text-gray-900'
                  }`}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>

            {/* ═══ RECOMMENDATIONS TAB ═══ */}
            {intelligenceTab === 'recommendations' && (
              <div className="space-y-8">
                <div className="rounded-xl border border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 text-sm">Create Custom Blog Card with AI</h3>
                      <p className="text-xs text-gray-600 mt-1">Have a unique idea? Use AI to generate a recommendation card.</p>
                    </div>
                    <button onClick={() => setIsAICardModalOpen(true)} className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 text-white px-4 py-2 text-sm font-medium">
                      <Sparkles className="h-4 w-4" /> Create with AI
                    </button>
                  </div>
                </div>

                {gaps.length === 0 ? (
                  <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
                    Excellent coverage — no major gaps detected.
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {gaps.map((gap, i) => (
                      <div key={i} className="flex flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <h3 className="text-sm font-bold text-gray-900 leading-snug">{gap.topic}</h3>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${PRIORITY_COLOURS[gap.priority]}`}>
                            {gap.priority}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed flex-1">{gap.reason}</p>
                        {(gap as any).brief && (
                          <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Company Context</p>
                            <p className="text-xs text-gray-700 line-clamp-2">{(gap as any).brief.company_context}</p>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Current Content</p>
                            <p className="text-xs text-gray-700 line-clamp-2">{(gap as any).brief.current_content}</p>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Writing Style</p>
                            <p className="text-xs text-gray-700 line-clamp-2">{(gap as any).brief.writing_style}</p>
                          </div>
                        )}
                        {gap.relatedTo && gap.relatedTo.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-gray-100">
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Builds on</p>
                            {gap.relatedTo.map((t) => (
                              <p key={t} className="text-xs text-[#0A66C2] truncate">→ {t}</p>
                            ))}
                          </div>
                        )}
                        <div className="mt-4 flex items-center gap-3">
                          <Link href="#" onClick={(e) => {
                            e.preventDefault();
                            // Store brief in sessionStorage and navigate to generation page
                            const briefToken = `brief_${Date.now()}`;
                            try {
                              sessionStorage.setItem(briefToken, JSON.stringify((gap as any).brief));
                            } catch {
                              // ignore storage error
                            }
                            router.push({
                              pathname: '/blogs/generate',
                              query: {
                                prefill_topic: gap.topic,
                                prefill_reason: gap.reason,
                                prefill_brief: briefToken,
                              }
                            });
                          }} className="inline-flex items-center gap-1 text-xs font-semibold text-[#0B5ED7] hover:underline">
                            Write this <ArrowRight className="h-3 w-3" />
                          </Link>
                          <button
                            onClick={() => {
                              setSelectedGapForCreator(gap as any);
                              setIsCreatorModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-purple-600 hover:underline"
                          >
                            <Sparkles className="h-3 w-3" /> Launch Creator Content
                          </button>
                          <button
                            onClick={() => {
                              const campaignContext = {
                                topic: gap.topic,
                                reason: gap.reason,
                                relatedTopics: gap.relatedTo || [],
                                contentFormats: ['article', 'blog', 'post'],
                                goals: ['Thought Leadership', 'Authority Building'],
                                brief: (gap as any).brief,
                                timestamp: new Date().toISOString(),
                              };
                              try {
                                sessionStorage.setItem('campaign-launch-context', JSON.stringify(campaignContext));
                              } catch {}
                              void router.push('/campaigns/create?source=blog-intelligence');
                            }}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 hover:underline"
                          >
                            <Zap className="h-3 w-3" /> Create Campaign
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <section>
                  <h2 className="mb-4 text-base font-bold text-gray-900">Action Items</h2>
                  {recommendations.length > 0 ? (
                    <div className="space-y-2">
                      {recommendations.map((rec, i) => (
                        <div key={i} className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
                          <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold bg-indigo-100 text-indigo-700">{rec.type}</span>
                          <div className="flex-1"><p className="text-sm font-semibold text-gray-900">{rec.action}</p><p className="text-xs text-gray-500 mt-0.5">{rec.reason}</p></div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-500 text-center">
                      No action items at this time. Keep publishing and analyzing performance!
                    </div>
                  )}
                </section>

                <section>
                  <h2 className="mb-4 text-base font-bold text-gray-900 flex items-center gap-2">
                    <BarChart2 className="h-4 w-4 text-indigo-600" /> Performance Snapshot
                  </h2>
                  {allMetrics.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {allMetrics.filter((m) => m.status === 'published').sort((a, b) => ((b as any).views_count || 0) - ((a as any).views_count || 0)).slice(0, 6).map((m) => (
                        <div key={m.id} className="rounded-xl border border-gray-200 bg-white p-4">
                          <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 mb-3">{m.title}</h3>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Views</p>
                              <p className="text-base font-bold text-gray-900">{((m as any).views_count || 0).toLocaleString()}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Status</p>
                              <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-700">Published</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-500 text-center">
                      No published posts yet. Start publishing to see performance metrics!
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* ═══ PERFORMANCE TAB ═══ */}
            {intelligenceTab === 'performance' && (
              <div className="space-y-8">
                {/* Summary Metrics */}
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {(() => {
                    const published = allMetrics.filter((m) => m.status === 'published');
                    const totalViews = blogs.reduce((s, b) => s + ((b as any).views_count || 0), 0);
                    const totalLikes = blogs.reduce((s, b) => s + ((b as any).likes_count || 0), 0);
                    return [
                      { label: 'Total Views', value: totalViews.toLocaleString() },
                      { label: 'Total Likes', value: totalLikes.toLocaleString() },
                      { label: 'Published Posts', value: published.length },
                      { label: 'Avg Engagement', value: published.length > 0 ? `${Math.round(published.reduce((s, m) => s + ((m as any).engagement_score || 0), 0) / published.length)}/100` : '—' },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-xl border border-gray-200 bg-white p-4 text-center">
                        <p className="text-2xl font-bold text-indigo-600">{value}</p>
                        <p className="text-xs text-gray-500 mt-1">{label}</p>
                      </div>
                    ));
                  })()}
                </div>

                {/* Performance Insights */}
                {perfInsights.length > 0 && (
                  <section>
                    <h2 className="mb-4 text-base font-bold text-gray-900 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600" /> Performance Insights
                    </h2>
                    <div className="space-y-2">
                      {perfInsights.slice(0, 8).map((insight, idx) => (
                        <div key={idx} className={`rounded-xl border p-3 flex gap-3 ${
                          insight.severity === 'critical' ? 'bg-red-50 border-red-200' :
                          insight.severity === 'warning' ? 'bg-amber-50 border-amber-200' :
                          'bg-blue-50 border-blue-200'
                        }`}>
                          <div className={`mt-0.5 shrink-0 h-3 w-3 rounded-full ${
                            insight.severity === 'critical' ? 'bg-red-500' :
                            insight.severity === 'warning' ? 'bg-amber-500' :
                            'bg-blue-500'
                          }`} />
                          <div className="flex-1">
                            <p className="text-xs font-semibold text-gray-900">{insight.message}</p>
                            <p className="text-xs text-gray-600 mt-0.5">{insight.action}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Topic Intelligence */}
                {narratives.length > 0 && (
                  <section>
                    <h2 className="mb-4 text-base font-bold text-gray-900 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-indigo-600" /> Topic Performance
                    </h2>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {narratives.map((n: any) => (
                        <div key={n.category} className={`rounded-xl border p-4 ${
                          n.verdict === 'scale' ? 'border-green-200 bg-green-50' :
                          n.verdict === 'optimize' ? 'border-amber-200 bg-amber-50' :
                          'border-gray-200 bg-gray-50'
                        }`}>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-semibold text-gray-900">{n.category}</p>
                            <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${
                              n.verdict === 'scale' ? 'bg-green-100 text-green-700' :
                              n.verdict === 'optimize' ? 'bg-amber-100 text-amber-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>{n.verdict}</span>
                          </div>
                          <p className="text-xs text-gray-600">{n.message}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Per-Post Scores */}
                <section>
                  <h2 className="mb-4 text-base font-bold text-gray-900">Post Scoring</h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {allMetrics.filter((m) => m.status === 'published').sort((a, b) => ((b as any).engagement_score || 0) - ((a as any).engagement_score || 0)).slice(0, 12).map((m) => {
                      const eng = Math.round((m as any).engagement_score || 0);
                      const vis = Math.round((m as any).visibility_score || 0);
                      const health = (m as any).health || 'good';
                      const healthColor = health === 'excellent' ? 'text-green-600' : health === 'good' ? 'text-blue-600' : health === 'fair' ? 'text-amber-600' : 'text-red-600';
                      return (
                        <div key={m.id} className="rounded-xl border border-gray-200 bg-white p-4">
                          <h4 className="text-sm font-semibold text-gray-900 line-clamp-2 mb-3">{m.title}</h4>
                          <div className="space-y-2">
                            <div>
                              <div className="flex justify-between mb-1">
                                <span className="text-[10px] text-gray-500 uppercase font-semibold">Engagement</span>
                                <span className="text-xs font-bold text-gray-900">{eng}/100</span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-gray-200">
                                <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${eng}%` }} />
                              </div>
                            </div>
                            <div>
                              <div className="flex justify-between mb-1">
                                <span className="text-[10px] text-gray-500 uppercase font-semibold">Visibility</span>
                                <span className="text-xs font-bold text-gray-900">{vis}/100</span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-gray-200">
                                <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${vis}%` }} />
                              </div>
                            </div>
                            <div className="flex justify-between items-center pt-1">
                              <span className="text-[10px] text-gray-500 uppercase font-semibold">Health</span>
                              <span className={`text-xs font-bold capitalize ${healthColor}`}>{health}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {allMetrics.filter((m) => m.status === 'published').length === 0 && (
                    <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
                      Publish posts to see performance scores.
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* ═══ GROWTH ENGINE TAB ═══ */}
            {intelligenceTab === 'growth' && (
              <div className="space-y-8">
                {/* Growth Summary */}
                {growthSummary && (
                  <>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      {[
                        { label: 'High Performers', value: (growthSummary as any).highCount, color: 'text-green-600' },
                        { label: 'Medium Performers', value: (growthSummary as any).mediumCount, color: 'text-amber-600' },
                        { label: 'Low Performers', value: (growthSummary as any).lowCount, color: 'text-red-600' },
                        { label: 'Avg Engagement', value: `${Math.round((growthSummary as any).avgEngagement || 0)}/100`, color: 'text-indigo-600' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="rounded-xl border border-gray-200 bg-white p-4 text-center">
                          <p className={`text-2xl font-bold ${color}`}>{value}</p>
                          <p className="text-xs text-gray-500 mt-1">{label}</p>
                        </div>
                      ))}
                    </div>

                    {(growthSummary as any).quickWins && (growthSummary as any).quickWins.length > 0 && (
                      <section>
                        <h2 className="mb-4 text-base font-bold text-gray-900 flex items-center gap-2">
                          <Zap className="h-4 w-4 text-amber-500" /> Quick Wins
                        </h2>
                        <div className="space-y-2">
                          {(growthSummary as any).quickWins.map((win: any, idx: number) => (
                            <div key={idx} className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex gap-3">
                              <span className="text-amber-500 mt-0.5">💡</span>
                              <div className="flex-1">
                                <p className="text-xs font-semibold text-amber-900">{win}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </>
                )}

                {/* Performance Tier Filter */}
                <div>
                  <div className="flex gap-2 mb-4">
                    {['all', 'high', 'medium', 'low'].map((tier) => (
                      <button
                        key={tier}
                        onClick={() => setGrowthTier(tier as any)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          growthTier === tier
                            ? 'bg-indigo-600 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {tier === 'all' ? 'All' : tier === 'high' ? 'High' : tier === 'medium' ? 'Medium' : 'Low'}
                      </button>
                    ))}
                  </div>

                  {/* Posts by Tier */}
                  <div className="space-y-3">
                    {(() => {
                      let filtered = classifiedMetrics;
                      if (growthTier !== 'all') filtered = filtered.filter((m) => (m as any)._class === growthTier);
                      return filtered.length > 0 ? (
                        filtered.sort((a, b) => ((b as any).engagement_score || 0) - ((a as any).engagement_score || 0)).map((m) => {
                          const cls = (m as any)._class;
                          const isInSeries = new Set((series || []).flatMap((s: any) => (s.blog_series_posts || []).map((p: any) => p.blog_id))).has(m.id);
                          return (
                            <div key={m.id} className={`rounded-xl border p-4 cursor-pointer transition-all ${
                              selectedGrowthId === m.id
                                ? 'ring-2 ring-indigo-400 border-indigo-300 bg-indigo-50'
                                : cls === 'high' ? 'border-green-200 hover:bg-green-50'
                                : cls === 'medium' ? 'border-amber-200 hover:bg-amber-50'
                                : 'border-gray-200 hover:bg-gray-50'
                            }`}
                              onClick={() => setSelectedGrowthId(selectedGrowthId === m.id ? null : m.id)}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1">
                                  <h3 className="text-sm font-semibold text-gray-900">{m.title}</h3>
                                  <p className="text-xs text-gray-500 mt-1">Engagement: {Math.round((m as any).engagement_score || 0)}/100 • Visibility: {Math.round((m as any).visibility_score || 0)}/100</p>
                                </div>
                                <div className="flex gap-1.5">
                                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                    cls === 'high' ? 'bg-green-100 text-green-700'
                                    : cls === 'medium' ? 'bg-amber-100 text-amber-700'
                                    : 'bg-gray-100 text-gray-600'
                                  }`}>{cls}</span>
                                  {isInSeries && <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-bold">Series</span>}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
                          No {growthTier !== 'all' ? `${growthTier}` : ''} performing posts yet.
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Selected Post Actions */}
                {selectedGrowthId && (() => {
                  const m = classifiedMetrics.find((m) => m.id === selectedGrowthId);
                  if (!m) return null;
                  const cls = (m as any)._class;
                  const isInSeries = new Set((series || []).flatMap((s: any) => (s.blog_series_posts || []).map((p: any) => p.blog_id))).has(m.id);
                  
                  // Generate actions based on performance
                  const recovery = cls !== 'high' ? getRecoveryActions(m) : [];
                  const amplify = cls !== 'low' ? getAmplificationActions(m, isInSeries) : [];

                  return (
                    <section className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50 p-6">
                      <h3 className="text-base font-bold text-gray-900 mb-4">{m.title}</h3>

                      {/* Recovery Actions */}
                      {recovery.length > 0 && (
                        <div className="mb-6">
                          <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-red-500" /> Recovery Actions
                          </h4>
                          <div className="space-y-2">
                            {recovery.map((action, idx) => (
                              <div key={idx} className="rounded-lg border border-red-200 bg-white p-3 flex gap-3">
                                <span className="text-red-500 mt-0.5">⚠️</span>
                                <div className="flex-1">
                                  <p className="text-xs font-semibold text-gray-900">{action.label}</p>
                                  <p className="text-xs text-gray-600 mt-0.5">{action.reason}</p>
                                </div>
                                <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full ${
                                  action.priority === 'critical' ? 'bg-red-100 text-red-700'
                                  : action.priority === 'high' ? 'bg-amber-100 text-amber-700'
                                  : 'bg-gray-100 text-gray-600'
                                }`}>{action.priority}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Amplification Actions */}
                      {amplify.length > 0 && (
                        <div className="mb-6">
                          <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-green-500" /> Amplification Opportunities
                          </h4>
                          <div className="space-y-2">
                            {amplify.map((action, idx) => (
                              <div key={idx} className="rounded-lg border border-green-200 bg-white p-3 flex gap-3">
                                <span className="text-green-500 mt-0.5">✨</span>
                                <div className="flex-1">
                                  <p className="text-xs font-semibold text-gray-900">{action.label}</p>
                                  <p className="text-xs text-gray-600 mt-0.5">{action.reason}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Repurpose Content */}
                      <div>
                        <button
                          onClick={() => generateRepurpose(m.id)}
                          disabled={generatingRep}
                          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                          {generatingRep ? (
                            <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
                          ) : (
                            <><RefreshCw className="h-4 w-4" /> Generate Repurposed Content</>
                          )}
                        </button>

                        {/* Repurposed Content Display */}
                        {repurposedContent && selectedGrowthId === m.id && (
                          <div className="mt-4 space-y-4">
                            <div className="rounded-lg bg-white border border-gray-200 p-4">
                              <h5 className="text-sm font-bold text-gray-900 mb-3">Repurposed Content</h5>

                              {/* LinkedIn Posts */}
                              <div className="mb-4">
                                <p className="text-xs font-semibold text-gray-600 mb-2">LinkedIn Posts</p>
                                <div className="space-y-2">
                                  {repurposedContent.linkedInPosts?.map((post, i) => (
                                    <div key={i} className="bg-gray-50 p-3 rounded border border-gray-200">
                                      <p className="text-xs text-gray-600 mb-2 font-semibold">{post.label}</p>
                                      <p className="text-xs text-gray-800 mb-2 leading-relaxed">{post.content}</p>
                                      <div className="flex items-center justify-between">
                                        <span className="text-[10px] text-gray-500">{post.charCount} chars</span>
                                        <button
                                          onClick={() => copyToClipboard(post.content, `li-${i}`)}
                                          className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold"
                                        >
                                          {copiedKey === `li-${i}` ? '✓ Copied' : 'Copy'}
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Twitter Thread */}
                              {repurposedContent.twitterThread && (
                                <div className="mb-4">
                                  <p className="text-xs font-semibold text-gray-600 mb-2">Twitter/X Thread</p>
                                  <div className="bg-gray-50 p-3 rounded border border-gray-200">
                                    {repurposedContent.twitterThread.tweets?.map((tweet, i) => (
                                      <div key={i} className="mb-2 pb-2 border-b border-gray-200 last:border-0">
                                        <p className="text-xs text-gray-800 mb-1">{tweet}</p>
                                      </div>
                                    ))}
                                    <button
                                      onClick={() => copyToClipboard(repurposedContent.twitterThread.tweets.join('\n\n'), 'tw')}
                                      className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold mt-2"
                                    >
                                      {copiedKey === 'tw' ? '✓ Copied' : 'Copy Thread'}
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Email Summary */}
                              {repurposedContent.emailSummary && (
                                <div>
                                  <p className="text-xs font-semibold text-gray-600 mb-2">Email Summary</p>
                                  <div className="bg-gray-50 p-3 rounded border border-gray-200">
                                    <p className="text-xs font-bold text-gray-900 mb-1">Subject:</p>
                                    <p className="text-xs text-gray-700 mb-3">{repurposedContent.emailSummary.subject}</p>
                                    <p className="text-xs font-bold text-gray-900 mb-1">Body (preview):</p>
                                    <p className="text-xs text-gray-700">{repurposedContent.emailSummary.body.slice(0, 200)}...</p>
                                    <button
                                      onClick={() => copyToClipboard(repurposedContent.emailSummary.body, 'email')}
                                      className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold mt-2"
                                    >
                                      {copiedKey === 'email' ? '✓ Copied' : 'Copy Email'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </section>
                  );
                })()}
              </div>
            )}

            {/* ═══ TOPIC COVERAGE TAB ═══ */}
            {intelligenceTab === 'coverage' && (
              <div className="space-y-8">
                {/* Topic Clusters Overview */}
                <section>
                  <h2 className="mb-4 text-base font-bold text-gray-900 flex items-center gap-2">
                    <BarChart2 className="h-4 w-4 text-indigo-600" /> Topic Clusters
                  </h2>
                  {clusters.length > 0 ? (
                    <div className="space-y-3">
                      {clusters.slice(0, 15).map((c) => (
                        <div key={c.slug} className="rounded-xl border border-gray-200 bg-white p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <h3 className="text-sm font-semibold text-gray-900">{c.name}</h3>
                              <p className="text-xs text-gray-500 mt-0.5">{c.posts} articles • {Math.round(c.coverage)}% coverage</p>
                            </div>
                            <span className={`text-sm font-bold ${c.coverage >= 80 ? 'text-green-600' : c.coverage >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                              {Math.round(c.coverage)}%
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-gray-100">
                            <div
                              className="h-2 rounded-full transition-all"
                              style={{
                                width: `${c.coverage}%`,
                                backgroundColor: c.coverage >= 80 ? '#16a34a' : c.coverage >= 50 ? '#d97706' : '#ef4444',
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
                      No topic data yet. Publish posts with categories to see clusters.
                    </div>
                  )}
                </section>

                {/* Topic Intelligence & Narratives */}
                {narratives && narratives.length > 0 && (
                  <section>
                    <h2 className="mb-4 text-base font-bold text-gray-900 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-green-600" /> Topic Intelligence
                    </h2>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {narratives.map((n: any) => {
                        const verdictColor = n.verdict === 'scale'
                          ? 'border-green-200 bg-green-50'
                          : n.verdict === 'optimize'
                            ? 'border-amber-200 bg-amber-50'
                            : 'border-gray-200 bg-gray-50';
                        const verdictBadge = n.verdict === 'scale'
                          ? 'bg-green-100 text-green-700'
                          : n.verdict === 'optimize'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-gray-100 text-gray-600';
                        return (
                          <div key={n.category} className={`rounded-xl border p-5 ${verdictColor}`}>
                            <div className="flex items-start justify-between gap-2 mb-3">
                              <div>
                                <h3 className="text-sm font-semibold text-gray-900">{n.category}</h3>
                                <p className="text-xs text-gray-500 mt-1">{n.posts || 0} articles • {Math.round(n.avg_views || 0)} avg views</p>
                              </div>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${verdictBadge}`}>
                                {n.verdict}
                              </span>
                            </div>
                            <p className="text-xs text-gray-600 leading-relaxed">{n.message}</p>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {/* Distribution Queue for Repurposing */}
                {distQueue && distQueue.length > 0 && (
                  <section>
                    <h2 className="mb-4 text-base font-bold text-gray-900 flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 text-purple-600" /> Repurposing Priority Queue
                    </h2>
                    <div className="space-y-3">
                      {distQueue.slice(0, 10).map((item: any, idx: number) => (
                        <div key={idx} className="rounded-xl border border-gray-200 bg-white p-4">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-gray-900 line-clamp-1">{item.title}</p>
                              <p className="text-xs text-gray-500 mt-1">{item.reason}</p>
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              item.priority === 'high' ? 'bg-red-100 text-red-700'
                              : item.priority === 'medium' ? 'bg-amber-100 text-amber-700'
                              : 'bg-gray-100 text-gray-600'
                            }`}>{item.priority}</span>
                          </div>
                          <button
                            onClick={() => { setSelectedGrowthId(item.targetSlug || item.id); setIntelligenceTab('growth'); }}
                            className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
                          >
                            View in Growth Engine →
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Content Gaps */}
                {gaps.length > 0 && (
                  <section>
                    <h2 className="mb-4 text-base font-bold text-gray-900 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600" /> Content Gaps
                    </h2>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {gaps.slice(0, 9).map((g, i) => (
                        <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <h4 className="text-sm font-semibold text-gray-900">{g.topic}</h4>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${g.priority === 'high' ? 'bg-red-100 text-red-700' : g.priority === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                              {g.priority}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 line-clamp-2">{g.reason}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* ═══ KNOWLEDGE GRAPH TAB ═══ */}
            {intelligenceTab === 'graph' && (
              <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
                <section>
                  <h2 className="mb-4 text-base font-bold text-gray-900">Blog Connections ({relationships.length})</h2>
                  <div className="space-y-2">
                    {relationships.map((r) => (
                      <div key={r.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
                        <div className="flex-1 min-w-0 text-sm">
                          <span className="font-medium text-gray-900 truncate">{blogs.find((b) => b.id === r.source_blog_id)?.title || 'Untitled'}</span>
                          <span className="mx-2 text-xs text-gray-500">→</span>
                          <span className="font-medium text-gray-900 truncate">{blogs.find((b) => b.id === r.target_blog_id)?.title || 'Untitled'}</span>
                        </div>
                        <button onClick={() => setRelationships(relationships.filter((x) => x.id !== r.id))} className="shrink-0 text-gray-300 hover:text-red-500">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h2 className="mb-4 text-base font-bold text-gray-900">Add Connection</h2>
                  <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
                    <select value={relSource} onChange={(e) => setRelSource(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                      <option value="">Select source…</option>
                      {blogs.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
                    </select>
                    <select value={relType} onChange={(e) => setRelType(e.target.value as RelationshipType)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                      <option value="related">Related</option>
                      <option value="prerequisite">Prerequisite</option>
                      <option value="continuation">Continuation</option>
                    </select>
                    <select value={relTarget} onChange={(e) => setRelTarget(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                      <option value="">Select target…</option>
                      {blogs.filter((b) => b.id !== relSource).map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
                    </select>
                    <button onClick={() => { if (relSource && relTarget) { setRelationships([...relationships, { id: `rel_${Date.now()}`, source_blog_id: relSource, target_blog_id: relTarget, relationship_type: relType }]); setRelSource(''); setRelTarget(''); } }} disabled={!relSource || !relTarget} className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                      Create
                    </button>
                  </div>
                </section>
              </div>
            )}

            {/* ═══ SERIES TAB ═══ */}
            {intelligenceTab === 'series' && (
              <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
                <section>
                  <h2 className="mb-4 text-base font-bold text-gray-900 flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-indigo-600" /> Reading Series
                  </h2>
                  {series.length > 0 ? (
                    <div className="space-y-4">
                      {series.map((s) => (
                        <div key={s.id} className="rounded-xl border border-gray-200 bg-white p-5">
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div className="flex-1">
                              <h3 className="text-sm font-bold text-gray-900">{s.title}</h3>
                              {s.description && <p className="mt-1 text-xs text-gray-500">{s.description}</p>}
                              <p className="mt-2 text-xs text-gray-600 font-medium">{s.blog_series_posts?.length || 0} post{(s.blog_series_posts?.length || 0) !== 1 ? 's' : ''}</p>
                            </div>
                            <div className="flex gap-1">
                              <button
                                onClick={() => openEditSeries(s)}
                                className="rounded p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                title="Edit series"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => deleteSeries(s.id)}
                                className="rounded p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                title="Delete series"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                          {s.blog_series_posts && s.blog_series_posts.length > 0 && (
                            <div className="mt-3 space-y-1 border-t border-gray-100 pt-3">
                              {[...(s.blog_series_posts || [])].sort((a, b) => a.position - b.position).map((p, i) => (
                                <p key={p.blog_id} className="text-xs text-gray-600">
                                  <span className="font-semibold text-gray-500">{i + 1}.</span> {p.title}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
                      <BookOpen className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm text-gray-500">No series yet. Create one to group related posts.</p>
                    </div>
                  )}
                </section>

                {/* Create Series Panel */}
                <section>
                  <h2 className="mb-4 text-base font-bold text-gray-900">Create Series</h2>
                  <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
                    <input
                      type="text"
                      value={newSeriesTitle}
                      onChange={(e) => setNewSeriesTitle(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && createSeries()}
                      placeholder="Series title"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder-gray-300"
                    />
                    <textarea
                      value={newSeriesDesc}
                      onChange={(e) => setNewSeriesDesc(e.target.value)}
                      rows={2}
                      placeholder="Description (optional)"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder-gray-300 resize-none"
                    />
                    <button
                      onClick={createSeries}
                      disabled={!newSeriesTitle.trim() || savingSeries}
                      className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      {savingSeries ? 'Creating…' : 'Create Series'}
                    </button>
                  </div>
                </section>

                {/* Edit Series Modal */}
                {editSeries && (
                  <section className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
                      <div className="flex items-center justify-between mb-6">
                        <h2 className="text-lg font-bold text-gray-900">Edit Series: {editSeries.title}</h2>
                        <button
                          onClick={() => setEditSeries(null)}
                          className="p-1 text-gray-400 hover:text-gray-600"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">Title</label>
                          <input
                            type="text"
                            value={editSeries.title}
                            onChange={(e) => setEditSeries({ ...editSeries, title: e.target.value })}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">Description</label>
                          <textarea
                            value={editSeries.description || ''}
                            onChange={(e) => setEditSeries({ ...editSeries, description: e.target.value })}
                            rows={2}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-3">Posts in Series</label>
                          {editPosts.length > 0 && (
                            <div className="space-y-2 mb-4">
                              {editPosts.map((p, idx) => (
                                <div key={p.blog_id} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">{idx + 1}</span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-900 truncate">{p.title}</p>
                                  </div>
                                  <button
                                    onClick={() => setEditPosts(editPosts.filter((x) => x.blog_id !== p.blog_id))}
                                    className="text-gray-400 hover:text-red-600"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="flex gap-2">
                            <select
                              value={addPostId}
                              onChange={(e) => setAddPostId(e.target.value)}
                              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                            >
                              <option value="">Select a post to add…</option>
                              {blogs
                                .filter((b) => b.status === 'published' && !editPosts.find((p) => p.blog_id === b.id))
                                .map((b) => (
                                  <option key={b.id} value={b.id}>
                                    {b.title}
                                  </option>
                                ))}
                            </select>
                            <button
                              onClick={addPostToEdit}
                              disabled={!addPostId}
                              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                            >
                              Add
                            </button>
                          </div>
                        </div>

                        <div className="flex gap-3 justify-end border-t border-gray-200 pt-4">
                          <button
                            onClick={() => setEditSeries(null)}
                            className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={saveEditSeries}
                            disabled={savingEdit}
                            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                          >
                            {savingEdit ? 'Saving…' : 'Save Changes'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        )}

        {/* AI Blog Card Modal */}
        {isAICardModalOpen && (
          <AIBlogCardModal
            isOpen={isAICardModalOpen}
            onClose={() => setIsAICardModalOpen(false)}
            onCardCreated={handleAICardCreated}
            companyId={selectedCompanyId || ''}
            companyName={companyProfile?.name || ''}
            companyContext={companyProfile?.brand_voice || ''}
          />
        )}

        {/* ── CREATOR CONTENT TYPE SELECTOR MODAL ───────────────────────────────── */}
        {isCreatorModalOpen && selectedGapForCreator && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-2">Create Creator Content</h2>
              <p className="text-sm text-gray-600 mb-5">
                Choose content type for: <strong>{selectedGapForCreator.topic}</strong>
              </p>

              <div className="space-y-3 mb-6">
                {(['video_script', 'carousel', 'story'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setSelectedCreatorType(type)}
                    className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-colors ${
                      selectedCreatorType === type
                        ? 'border-purple-500 bg-purple-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="font-semibold text-gray-900">
                      {type === 'video_script'
                        ? '🎥 Video Script'
                        : type === 'carousel'
                          ? '📸 Carousel'
                          : '📱 Story'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {type === 'video_script'
                        ? 'TikTok, Reels, YouTube Shorts'
                        : type === 'carousel'
                          ? 'Instagram, Pinterest, LinkedIn'
                          : 'Instagram Stories, TikTok'}
                    </p>
                  </button>
                ))}
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
                <button
                  onClick={() => {
                    setIsCreatorModalOpen(false);
                    setSelectedCreatorType(null);
                    setSelectedGapForCreator(null);
                  }}
                  className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!selectedCreatorType || !selectedGapForCreator) return;

                    setCreatorContentGenerating(true);
                    try {
                      const res = await fetch('/api/content/creator/generate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          company_id: selectedCompanyId,
                          content_type: selectedCreatorType,
                          topic: selectedGapForCreator.topic,
                          gap_reason: selectedGapForCreator.reason,
                          content_theme: 'educational',
                        }),
                      });

                      if (!res.ok) {
                        const error = await res.json();
                        alert(`Error: ${error.error}`);
                        return;
                      }

                      const result = await res.json();
                      // Store context for refinement page
                      try {
                        sessionStorage.setItem('creator-content-poll', JSON.stringify({
                          jobId: result.jobId,
                          contentType: selectedCreatorType,
                          topic: selectedGapForCreator.topic,
                          targetPlatforms: result.targetPlatforms,
                        }));
                      } catch {}

                      // Redirect to polling/refinement page
                      void router.push(`/api/content/generation-status/${result.jobId}`);
                    } catch (err) {
                      console.error('Creator content generation error:', err);
                      alert('Failed to generate creator content');
                    } finally {
                      setCreatorContentGenerating(false);
                      setIsCreatorModalOpen(false);
                      setSelectedCreatorType(null);
                      setSelectedGapForCreator(null);
                    }
                  }}
                  disabled={!selectedCreatorType || creatorContentGenerating}
                  className="px-4 py-2 text-sm font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                  {creatorContentGenerating ? 'Generating...' : 'Generate'}
                </button>
              </div>
            </div>
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

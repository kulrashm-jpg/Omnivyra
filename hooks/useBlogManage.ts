import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';
import { retryPublishingIssue, type PublishingIssue } from '../components/blog/publishingIssues';

export type ManagedBlog = {
  id: string;
  title: string;
  slug: string | null;
  excerpt: string | null;
  category: string | null;
  tags: string[];
  status: 'draft' | 'published' | 'scheduled' | 'failed';
  published_at: string | null;
  views_count: number;
  likes_count: number;
  created_at: string;
};

export function useBlogManage() {
  const router = useRouter();
  const { selectedCompanyId, userRole } = useCompanyContext();
  const [blogs, setBlogs] = useState<ManagedBlog[]>([]);
  const [filter, setFilter] = useState<'all' | 'draft' | 'published'>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [ga4Views, setGa4Views] = useState<Record<string, number>>({});
  const [deleteAlsoRemote, setDeleteAlsoRemote] = useState(false);
  const [analyticsSummary, setAnalyticsSummary] = useState<{
    trending: Array<{ blogId: string; title: string; views28d: number; deltaPct14d: number }>;
    trafficSources: Array<{ sourceMedium: string; views: number }>;
    topCategories: Array<{ category: string; views: number; posts: number }>;
    publishSuccessRate: number;
    publishAttempts: number;
    publishSuccesses: number;
    lastAnalyticsRefreshAt: string | null;
    lowPerformingBlogs: Array<{ blogId: string; title: string; views28d: number }>;
  } | null>(null);

  const canManage = ['COMPANY_ADMIN', 'SUPER_ADMIN'].includes((userRole || '').toUpperCase());

  // Dead-lettered CMS publishes, keyed by blog id (e9). An unreadable queue is shown as an error,
  // never as "no issues".
  const [publishingIssues, setPublishingIssues] = useState<Record<string, PublishingIssue>>({});
  const [publishingIssuesError, setPublishingIssuesError] = useState('');
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [retryMessage, setRetryMessage] = useState('');

  const loadPublishingIssues = useCallback(async () => {
    if (!selectedCompanyId) return;
    setPublishingIssuesError('');
    try {
      const res = await fetch(`/api/blogs/publishing-issues?company_id=${encodeURIComponent(selectedCompanyId)}`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not load publishing issues');
      const byBlog: Record<string, PublishingIssue> = {};
      for (const issue of (Array.isArray(data?.issues) ? data.issues : []) as PublishingIssue[]) {
        if (issue.blog_id) byBlog[issue.blog_id] = issue;
      }
      setPublishingIssues(byBlog);
    } catch (e) {
      setPublishingIssuesError(e instanceof Error ? e.message : 'Could not load publishing issues');
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    void loadPublishingIssues();
  }, [loadPublishingIssues]);

  const retryPublish = useCallback(async (blogId: string) => {
    const issue = publishingIssues[blogId];
    if (!issue || !selectedCompanyId) return;
    setRetryingJobId(issue.job_id);
    setRetryMessage('');
    try {
      const outcome = await retryPublishingIssue(issue, selectedCompanyId, {
        fetch: (input, init) => fetch(input, init),
        confirm: (text) => window.confirm(text),
      });
      if (outcome.ok === true) {
        setRetryMessage('Publish re-queued.');
        await loadPublishingIssues();
      } else {
        setRetryMessage((outcome as { message: string }).message);
      }
    } finally {
      setRetryingJobId(null);
    }
  }, [publishingIssues, selectedCompanyId, loadPublishingIssues]);

  const loadBlogs = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/company/blogs?company_id=${encodeURIComponent(selectedCompanyId)}`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load blogs');
      setBlogs(Array.isArray(data?.blogs) ? data.blogs : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load blogs');
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    void loadBlogs();
  }, [loadBlogs]);

  // Hydrate GA4 28d views in a single batch call.
  useEffect(() => {
    if (!selectedCompanyId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/blogs/analytics/top?company_id=${encodeURIComponent(selectedCompanyId)}&limit=50`,
          { credentials: 'include' },
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled || !Array.isArray(data?.rows)) return;
        const map: Record<string, number> = {};
        for (const r of data.rows) {
          if (r?.blogId) map[String(r.blogId)] = Number(r.views28d ?? 0);
        }
        setGa4Views(map);
      } catch { /* silent — GA4 may not be connected */ }
    })();
    (async () => {
      try {
        const res = await fetch(
          `/api/blogs/analytics/summary?company_id=${encodeURIComponent(selectedCompanyId)}`,
          { credentials: 'include' },
        );
        const data = await res.json().catch(() => null);
        if (cancelled || !res.ok || !data) return;
        setAnalyticsSummary(data);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [selectedCompanyId, blogs.length]);

  const filteredBlogs = useMemo(() => {
    if (filter === 'all') return blogs;
    return blogs.filter((blog) => blog.status === filter);
  }, [blogs, filter]);

  const metrics = useMemo(() => {
    const published = blogs.filter((blog) => blog.status === 'published');
    return {
      total: blogs.length,
      drafts: blogs.filter((blog) => blog.status === 'draft').length,
      published: published.length,
      views: published.reduce((sum, blog) => sum + (blog.views_count || 0), 0),
    };
  }, [blogs]);

  const startCreate = useCallback(() => {
    void router.push('/blogs/create');
  }, [router]);

  const startEdit = useCallback((id: string) => {
    void router.push(`/blogs/new?edit=${encodeURIComponent(id)}`);
  }, [router]);

  const confirmDelete = useCallback(async () => {
    if (!deleteId || !selectedCompanyId) return;
    setDeleting(true);
    setError('');
    try {
      const sync = deleteAlsoRemote ? '&sync=remote' : '';
      const res = await fetch(`/api/blogs/${encodeURIComponent(deleteId)}?company_id=${encodeURIComponent(selectedCompanyId)}${sync}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to delete blog');
      setBlogs((current) => current.filter((blog) => blog.id !== deleteId));
      setDeleteId(null);
      setDeleteAlsoRemote(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete blog');
    } finally {
      setDeleting(false);
    }
  }, [deleteId, selectedCompanyId, deleteAlsoRemote]);

  return {
    blogs,
    canManage,
    deleteId,
    deleting,
    error,
    filter,
    filteredBlogs,
    loading,
    metrics,
    ga4Views,
    analyticsSummary,
    deleteAlsoRemote,
    setDeleteAlsoRemote,
    setDeleteId,
    setFilter,
    startCreate,
    startEdit,
    confirmDelete,
    reload: loadBlogs,
    publishingIssues,
    publishingIssuesError,
    retryingJobId,
    retryMessage,
    retryPublish,
  };
}

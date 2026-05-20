'use client';

import Link from 'next/link';
import { BarChart2, Edit2, FileText, Loader2, Plus, Trash2 } from 'lucide-react';
import type { useBlogManage } from '../../hooks/useBlogManage';
import EmptyState from '../shared/EmptyState';
import ExamplePreview from '../shared/ExamplePreview';

type Props = {
  d: ReturnType<typeof useBlogManage>;
};

function fmtDate(value: string | null) {
  if (!value) return 'Not published yet';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function BlogManageView({ d }: Props) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Blog Hub</p>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">Manage Blogs</h1>
            <p className="mt-1 text-sm text-gray-600">View drafts, published blogs, and core performance without leaving the blog workflow.</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/blogs/create" className="text-sm font-medium text-gray-600 transition-colors hover:text-gray-900">
              Back to Create Blog
            </Link>
            {d.canManage && (
              <button
                onClick={d.startCreate}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
              >
                <Plus className="h-4 w-4" />
                Create blog
              </button>
            )}
          </div>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-4">
          {[
            { label: 'Total blogs', value: d.metrics.total },
            { label: 'Drafts', value: d.metrics.drafts },
            { label: 'Published', value: d.metrics.published },
            { label: 'Total views', value: d.metrics.views.toLocaleString() },
          ].map((card) => (
            <div key={card.label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">{card.label}</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">{card.value}</p>
            </div>
          ))}
        </div>

        {d.analyticsSummary && (
          <div className="mb-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Trending (14d Δ)</p>
              <ul className="mt-2 space-y-1 text-xs">
                {(d.analyticsSummary.trending ?? []).slice(0, 5).map((t) => (
                  <li key={t.blogId} className="flex items-center justify-between gap-2">
                    <span className="truncate text-gray-800">{t.title}</span>
                    <span className={t.deltaPct14d > 0 ? 'whitespace-nowrap text-emerald-700' : 'whitespace-nowrap text-gray-500'}>
                      {t.deltaPct14d > 0 ? '↑' : t.deltaPct14d < 0 ? '↓' : '—'} {Math.abs(t.deltaPct14d * 100).toFixed(0)}%
                    </span>
                  </li>
                ))}
                {(d.analyticsSummary.trending ?? []).length === 0 && <li className="text-gray-500">No trending data yet.</li>}
              </ul>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Traffic sources (28d)</p>
              <ul className="mt-2 space-y-1 text-xs">
                {(d.analyticsSummary.trafficSources ?? []).slice(0, 5).map((s, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="text-gray-800">{s.sourceMedium}</span>
                    <span className="text-gray-600">{s.views.toLocaleString()}</span>
                  </li>
                ))}
                {(d.analyticsSummary.trafficSources ?? []).length === 0 && <li className="text-gray-500">No GA4 views yet.</li>}
              </ul>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Publish health</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">{(d.analyticsSummary.publishSuccessRate * 100).toFixed(0)}%</p>
              <p className="text-[11px] text-gray-500">
                {d.analyticsSummary.publishSuccesses}/{d.analyticsSummary.publishAttempts} jobs succeeded
              </p>
              {d.analyticsSummary.lastAnalyticsRefreshAt && (
                <p className="mt-1 text-[10px] text-gray-400">
                  GA4 refreshed {new Date(d.analyticsSummary.lastAnalyticsRefreshAt).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {(['all', 'draft', 'published'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => d.setFilter(tab)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  d.filter === tab ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
                }`}
              >
                {tab === 'all' ? 'All' : tab === 'draft' ? 'Drafts' : 'Published'}
              </button>
            ))}
          </div>
          <button onClick={d.reload} className="text-sm font-medium text-gray-600 transition-colors hover:text-gray-900">
            Refresh
          </button>
        </div>

        {d.error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {d.error}
          </div>
        )}

        {d.loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <Loader2 className="mr-2 h-6 w-6 animate-spin" /> Loading blogs...
          </div>
        ) : d.filteredBlogs.length === 0 ? (
          <EmptyState
            tone={d.filter === 'all' ? 'first-time' : 'no-results'}
            illustration={<FileText className="h-6 w-6" />}
            title={d.filter === 'all' ? 'Create your first blog' : 'No blogs found'}
            description={
              d.filter === 'all'
                ? 'Start with a strong blog so your team has a real example to edit, publish, and improve from here.'
                : `There are no ${d.filter} blogs right now. Switch filters or start a new blog.`
            }
            primaryAction={{
              label: d.filter === 'all' ? 'Create your first blog' : 'Show all blogs',
              onClick: () => (d.filter === 'all' ? d.startCreate() : d.setFilter('all')),
            }}
            secondaryAction={
              d.filter === 'all'
                ? {
                    label: 'Back to create flow',
                    href: '/blogs/create',
                  }
                : undefined
            }
            examplePreview={
              <ExamplePreview variant="blog" />
            }
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {d.filteredBlogs.map((blog) => (
              <div key={blog.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">{blog.category || 'Blog'}</p>
                    <h2 className="mt-2 line-clamp-2 text-lg font-semibold text-gray-900">{blog.title}</h2>
                    <p className="mt-2 line-clamp-3 text-sm leading-6 text-gray-600">
                      {blog.excerpt || 'No excerpt yet. Open the editor to finish the summary and tighten the front of the article.'}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    blog.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {blog.status}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-4 gap-3">
                  <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Views</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">{(blog.views_count || 0).toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">GA4 28d</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">{((d.ga4Views?.[blog.id]) || 0).toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Likes</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">{(blog.likes_count || 0).toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Published</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">{fmtDate(blog.published_at)}</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">
                    <BarChart2 className="h-3 w-3" />
                    Basic performance
                  </span>
                  {blog.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] text-gray-600">
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="mt-5 flex items-center gap-2">
                  <button
                    onClick={() => d.startEdit(blog.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <Edit2 className="h-4 w-4" />
                    Edit
                  </button>
                  <button
                    onClick={() => d.setDeleteId(blog.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {d.deleteId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
              <h2 className="text-lg font-bold text-gray-900">Delete blog?</h2>
              <p className="mt-2 text-sm text-gray-600">This blog will be permanently removed from your company workspace.</p>
              <label className="mt-4 flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={!!d.deleteAlsoRemote}
                  onChange={(e) => d.setDeleteAlsoRemote?.(e.target.checked)}
                />
                <span>
                  Also delete from the live site
                  <span className="ml-1 text-[11px] text-gray-500">(if previously published via an integration; Squarespace not supported)</span>
                </span>
              </label>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => { d.setDeleteId(null); d.setDeleteAlsoRemote?.(false); }}
                  className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={d.confirmDelete}
                  disabled={d.deleting}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {d.deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

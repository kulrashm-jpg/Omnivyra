/**
 * Asset Library — Strategic Mix P2 (SPEC-001 §1 "Asset" / §3.2 Library).
 *
 * The dedicated server-backed library experience: every generated creator
 * asset with its full version history — search, filters, grid/list, preview,
 * duplicate, restore, archive, delete, usage. Duplicate/restore run through
 * the EXISTING client library logic (creatorAssetLibrary) over the server
 * backend; archive/delete/usage are server actions. localStorage is cache
 * only (pre-P2 libraries migrate up transparently on first load).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  ArrowLeft, Archive, ArchiveRestore, Copy, Grid as GridIcon, History,
  List as ListIcon, RefreshCw, Search, Trash2, X,
} from 'lucide-react';
import { useCompanyContext } from '../../../components/CompanyContext';
import { fetchWithAuth } from '../../../components/community-ai/fetchWithAuth';
import {
  duplicateAsset,
  restoreAssetVersion,
  type CreatorAsset,
  type CreatorAssetVersion,
} from '../../../lib/content/creatorAssetLibrary';
import { installServerCreatorAssetBackend } from '../../../lib/content/creatorAssetServerBackend';

type ServerMeta = {
  archivedAt: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  updatedAt: string | null;
  createdAt: string | null;
};
type LibraryEntry = { asset: CreatorAsset; server_meta: ServerMeta };

function currentPayload(asset: CreatorAsset): CreatorAssetVersion['payload'] | null {
  return asset.versions.find((v) => v.version === asset.currentVersion)?.payload
    ?? asset.versions[asset.versions.length - 1]?.payload ?? null;
}

function fmt(dateIso: string | null | undefined): string {
  if (!dateIso) return '—';
  try { return new Date(dateIso).toLocaleString(); } catch { return dateIso; }
}

export default function AssetLibraryPage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext() ?? { selectedCompanyId: null };
  const companyId = selectedCompanyId || null;

  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => { installServerCreatorAssetBackend(companyId); }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ company_id: companyId, limit: '500' });
      if (showArchived) params.set('include_archived', 'true');
      const res = await fetchWithAuth(`/api/creator-assets/library?${params.toString()}`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Failed to load library');
      const data = await res.json();
      setEntries(Array.isArray(data.assets) ? data.assets : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load library');
    } finally {
      setLoading(false);
    }
  }, [companyId, showArchived]);

  useEffect(() => { void load(); }, [load]);

  const types = useMemo(
    () => Array.from(new Set(entries.map((e) => e.asset.metadata?.assetType || 'asset'))).sort(),
    [entries],
  );
  const tags = useMemo(
    () => Array.from(new Set(entries.flatMap((e) => e.asset.metadata?.tags ?? []))).sort().slice(0, 24),
    [entries],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter((e) => {
      const payload = currentPayload(e.asset);
      if (typeFilter && (e.asset.metadata?.assetType || 'asset') !== typeFilter) return false;
      if (tagFilter && !(e.asset.metadata?.tags ?? []).includes(tagFilter)) return false;
      if (needle) {
        const hay = `${payload?.title ?? ''} ${(e.asset.metadata?.tags ?? []).join(' ')}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [entries, q, typeFilter, tagFilter]);

  const detail = detailId ? entries.find((e) => e.asset.id === detailId) ?? null : null;

  const runAction = useCallback(async (id: string, action: 'archive' | 'unarchive' | 'soft-delete') => {
    if (!companyId) return;
    if (action === 'soft-delete' && !window.confirm('Delete this asset? It will be removed from the library (recoverable by support).')) return;
    setBusyId(id);
    try {
      const res = await fetchWithAuth('/api/creator-assets/library-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, id, action }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Action failed');
      if (action === 'soft-delete') setDetailId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  }, [companyId, load]);

  const onDuplicate = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      const result = await duplicateAsset(id); // client logic over the server backend
      if (result) await load();
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const onRestore = useCallback(async (id: string, version: number) => {
    setBusyId(id);
    try {
      const result = await restoreAssetVersion(id, version); // client logic over the server backend
      if (result) await load();
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const card = (entry: LibraryEntry) => {
    const payload = currentPayload(entry.asset);
    const archived = Boolean(entry.server_meta?.archivedAt);
    return (
      <div
        key={entry.asset.id}
        className={`border rounded-xl bg-white overflow-hidden hover:shadow-md transition-shadow cursor-pointer ${archived ? 'opacity-60 border-dashed' : 'border-gray-200'} ${view === 'list' ? 'flex items-center gap-4 p-3' : ''}`}
        onClick={() => setDetailId(entry.asset.id)}
      >
        <div className={view === 'grid' ? 'aspect-video bg-slate-100 flex items-center justify-center overflow-hidden' : 'w-24 h-16 bg-slate-100 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0'}>
          {payload?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img loading="lazy" decoding="async" src={payload.url} alt={payload?.title ?? 'asset preview'} className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs text-slate-400">no preview</span>
          )}
        </div>
        <div className={view === 'grid' ? 'p-3' : 'min-w-0 flex-1'}>
          <div className="text-sm font-medium text-gray-900 truncate">{payload?.title ?? 'Untitled asset'}</div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
            <span className="px-1.5 py-0.5 rounded bg-slate-100 uppercase tracking-wide">{entry.asset.metadata?.assetType ?? 'asset'}</span>
            <span>v{entry.asset.currentVersion}</span>
            {entry.server_meta?.usageCount > 0 && <span title="times used">↻ {entry.server_meta.usageCount}</span>}
            {archived && <span className="text-amber-600">archived</span>}
          </div>
          <div className="mt-1 text-[11px] text-gray-400">Updated {fmt(entry.server_meta?.updatedAt ?? entry.asset.updatedAt)}</div>
        </div>
      </div>
    );
  };

  return (
    <>
      <Head><title>Asset Library | Omnivyra</title></Head>
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          {/* R2-P5 two-door entry: arriving through Strategic Mix's Content
              door keeps the way back to the (already saved) draft campaign. */}
          {router.query.from === 'strategic-mix' ? (
            <button onClick={() => router.push('/campaign-planner?mode=direct')} className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 font-medium">
              <ArrowLeft className="h-5 w-5" /> Back to Strategic Mix
            </button>
          ) : (
            <button onClick={() => router.push('/command-center/creator-content')} className="flex items-center gap-2 text-gray-600 hover:text-gray-900">
              <ArrowLeft className="h-5 w-5" /> Back
            </button>
          )}
          <h1 className="text-lg font-bold text-gray-900">Asset Library</h1>
          <button onClick={() => void load()} className="text-gray-500 hover:text-gray-800" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search assets and tags…"
                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
              />
            </div>
            <select value={typeFilter ?? ''} onChange={(e) => setTypeFilter(e.target.value || null)} className="text-sm border border-gray-300 rounded-lg px-2 py-2 bg-white">
              <option value="">All types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {tags.length > 0 && (
              <select value={tagFilter ?? ''} onChange={(e) => setTagFilter(e.target.value || null)} className="text-sm border border-gray-300 rounded-lg px-2 py-2 bg-white">
                <option value="">All tags</option>
                {tags.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            <label className="flex items-center gap-1.5 text-sm text-gray-600">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archived
            </label>
            <div className="flex border border-gray-300 rounded-lg overflow-hidden">
              <button onClick={() => setView('grid')} className={`p-2 ${view === 'grid' ? 'bg-slate-900 text-white' : 'bg-white text-gray-500'}`} title="Grid"><GridIcon className="h-4 w-4" /></button>
              <button onClick={() => setView('list')} className={`p-2 ${view === 'list' ? 'bg-slate-900 text-white' : 'bg-white text-gray-500'}`} title="List"><ListIcon className="h-4 w-4" /></button>
            </div>
          </div>

          {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          {loading ? (
            <div className="py-16 text-center text-gray-500 text-sm">Loading your library…</div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center text-gray-500 text-sm">
              No assets{q || typeFilter || tagFilter ? ' match the current filters' : ' yet — create images, carousels, or infographics and save them as assets'}.
            </div>
          ) : (
            <div className={view === 'grid' ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3' : 'flex flex-col gap-2'}>
              {visible.map(card)}
            </div>
          )}
        </div>

        {detail && (
          <div className="fixed inset-0 z-40 flex" onClick={() => setDetailId(null)}>
            <div className="flex-1 bg-black/30" />
            <div className="w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="font-semibold text-gray-900 truncate pr-2">{currentPayload(detail.asset)?.title ?? 'Asset'}</h2>
                <button onClick={() => setDetailId(null)} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
              </div>
              <div className="p-4 space-y-4">
                {currentPayload(detail.asset)?.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img loading="lazy" decoding="async" src={currentPayload(detail.asset)!.url} alt="preview" className="w-full rounded-lg border border-gray-200" />
                )}
                <div className="text-xs text-gray-500 space-y-1">
                  <div>Type: <span className="text-gray-800">{detail.asset.metadata?.assetType}</span></div>
                  <div>Created: <span className="text-gray-800">{fmt(detail.server_meta?.createdAt ?? detail.asset.createdAt)}</span></div>
                  <div>Used: <span className="text-gray-800">{detail.server_meta?.usageCount ?? 0}× {detail.server_meta?.lastUsedAt ? `(last ${fmt(detail.server_meta.lastUsedAt)})` : ''}</span></div>
                  {(detail.asset.metadata?.tags ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {detail.asset.metadata!.tags.map((t) => <span key={t} className="px-1.5 py-0.5 bg-slate-100 rounded text-[11px]">{t}</span>)}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button disabled={busyId === detail.asset.id} onClick={() => void onDuplicate(detail.asset.id)} className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50">
                    <Copy className="h-3.5 w-3.5" /> Duplicate
                  </button>
                  {detail.server_meta?.archivedAt ? (
                    <button disabled={busyId === detail.asset.id} onClick={() => void runAction(detail.asset.id, 'unarchive')} className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50">
                      <ArchiveRestore className="h-3.5 w-3.5" /> Unarchive
                    </button>
                  ) : (
                    <button disabled={busyId === detail.asset.id} onClick={() => void runAction(detail.asset.id, 'archive')} className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50">
                      <Archive className="h-3.5 w-3.5" /> Archive
                    </button>
                  )}
                  <button disabled={busyId === detail.asset.id} onClick={() => void runAction(detail.asset.id, 'soft-delete')} className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>

                <div>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-gray-800 mb-2">
                    <History className="h-4 w-4" /> Version history ({detail.asset.versions.length})
                  </div>
                  <div className="space-y-1.5">
                    {[...detail.asset.versions].reverse().map((v) => (
                      <div key={v.version} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg px-2.5 py-2">
                        <div>
                          <span className={`font-medium ${v.version === detail.asset.currentVersion ? 'text-emerald-700' : 'text-gray-700'}`}>
                            v{v.version} · {v.op}{v.restoredFrom ? ` (from v${v.restoredFrom})` : ''}
                          </span>
                          <span className="text-gray-400 ml-2">{fmt(v.createdAt)}</span>
                        </div>
                        {v.version !== detail.asset.currentVersion && (
                          <button disabled={busyId === detail.asset.id} onClick={() => void onRestore(detail.asset.id, v.version)} className="text-blue-600 hover:underline">
                            Restore
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

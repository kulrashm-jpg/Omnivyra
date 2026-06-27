import React, { useCallback, useEffect, useState } from 'react';
import { X, Search as SearchIcon, Check } from 'lucide-react';
import {
  getAssetsByType,
  getRecentAssets,
  searchAssets,
  getAssetsByTags,
  filterAssets,
} from '../../lib/content/creatorAssetCatalog';
import {
  resolveCreatorAssetCatalogMetadata,
  resolveCreatorAsset,
  resolveCreatorAssetPreviewUrl,
  type CreatorAssetRef,
  type CreatorAssetMetadata,
} from '../../lib/content/creatorAssetResolver';
import { attachUsage, type AssetConsumer } from '../../lib/content/creatorAssetUsageGraph';
import type { WriterAttachedAsset } from '../../lib/content/writerCreatorAssetLaunch';

/**
 * Reuse Existing Asset — the FIRST runtime consumer of the Creator Asset Catalog.
 *
 * Discovery is metadata-driven through the Catalog only (no direct Library/storage
 * access). The list shows metadata; the PAYLOAD is resolved (via the Resolver) only
 * after a row is selected, for preview. Attaching creates a new Usage Graph edge —
 * it never duplicates the asset, never mints an ID, and preserves version history.
 *
 *   Catalog → metadata filters → CreatorAssetRef → Resolver → Preview → attachUsage → Writer
 */

interface Props {
  consumer: AssetConsumer;
  assetType?: string | null;
  onAttached: () => void;
  onClose: () => void;
}

type Mode = 'type' | 'recent' | 'search' | 'tags';
interface Row { ref: CreatorAssetRef; metadata: CreatorAssetMetadata | null }

export default function AssetReusePicker({ consumer, assetType, onAttached, onClose }: Props) {
  const [mode, setMode] = useState<Mode>(assetType ? 'type' : 'recent');
  const [query, setQuery] = useState('');
  const [tags, setTags] = useState('');
  const [platform, setPlatform] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<{ ref: CreatorAssetRef; payload: WriterAttachedAsset; preview: string | null } | null>(null);
  const [attaching, setAttaching] = useState(false);

  // Discovery via the CATALOG only → refs; then resolve METADATA (not payload) for display.
  const runDiscovery = useCallback(async () => {
    setLoading(true);
    setSelected(null);
    try {
      let refs: CreatorAssetRef[] = [];
      if (mode === 'search') refs = query.trim() ? await searchAssets(query.trim()) : await getRecentAssets(30);
      else if (mode === 'tags') refs = tags.trim() ? await getAssetsByTags(tags.split(',').map((t) => t.trim()).filter(Boolean)) : [];
      else if (mode === 'type' && assetType) refs = await getAssetsByType(assetType);
      else refs = await getRecentAssets(30);

      if (platform.trim()) {
        const allowed = new Set((await filterAssets({ platform: platform.trim() })).map((r) => r.assetId));
        refs = refs.filter((r) => allowed.has(r.assetId));
      }

      const out: Row[] = [];
      for (const ref of refs.slice(0, 60)) {
        out.push({ ref, metadata: await resolveCreatorAssetCatalogMetadata(ref) }); // metadata only
      }
      setRows(out);
    } finally {
      setLoading(false);
    }
  }, [mode, query, tags, platform, assetType]);

  useEffect(() => { void runDiscovery(); }, [runDiscovery]);

  // Selection → resolve the PAYLOAD now (not during search), for preview.
  const selectRow = async (ref: CreatorAssetRef) => {
    const payload = await resolveCreatorAsset(ref);
    if (!payload) return;
    const preview = await resolveCreatorAssetPreviewUrl(ref);
    setSelected({ ref, payload, preview });
  };

  // Attach an existing asset = a NEW Usage Graph edge (no duplicate, no new ID).
  const attach = async () => {
    if (!selected) return;
    setAttaching(true);
    try {
      await attachUsage(selected.ref, consumer, { role: 'attachment' });
      onAttached();
      onClose();
    } finally {
      setAttaching(false);
    }
  };

  const tab = (m: Mode, label: string) => (
    <button type="button" onClick={() => setMode(m)}
      style={{ fontSize: 12.5, fontWeight: 600, cursor: 'pointer', borderRadius: 999, padding: '4px 12px', border: `1px solid ${mode === m ? '#2563eb' : '#e5e7eb'}`, background: mode === m ? '#eff6ff' : '#fff', color: mode === m ? '#2563eb' : '#475569' }}>{label}</button>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 20, zIndex: 60 }} onClick={onClose}>
      <div style={{ maxWidth: 920, width: '100%', maxHeight: '88vh', overflow: 'hidden', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, color: '#0f172a', margin: 0 }}>Reuse existing asset{assetType ? ` · ${assetType}` : ''}</h2>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={18} /></button>
        </div>

        {/* Filters — all via the Catalog */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          {assetType ? tab('type', `This type`) : null}
          {tab('recent', 'Recent')}
          {tab('search', 'Search')}
          {tab('tags', 'Tags')}
          <input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="platform (e.g. linkedin)"
            style={{ marginLeft: 'auto', fontSize: 12.5, border: '1px solid #d1d5db', borderRadius: 8, padding: '5px 10px', color: '#0f172a' }} />
        </div>
        {mode === 'search' ? (
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <SearchIcon size={14} style={{ position: 'absolute', left: 10, top: 9, color: '#94a3b8' }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search assets by type / template / campaign / tags…"
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px 8px 30px', color: '#0f172a' }} />
          </div>
        ) : null}
        {mode === 'tags' ? (
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma-separated (e.g. promo, q3)"
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', color: '#0f172a', marginBottom: 10 }} />
        ) : null}

        {/* Two-pane: metadata list + resolved preview */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 14, flex: 1, minHeight: 0 }}>
          <div style={{ overflowY: 'auto', border: '1px solid #eef2f7', borderRadius: 10 }}>
            {loading ? <div style={{ padding: 16, fontSize: 13, color: '#94a3b8' }}>Loading…</div>
              : rows.length === 0 ? <div style={{ padding: 16, fontSize: 13, color: '#94a3b8' }}>No matching assets.</div>
              : rows.map((row) => {
                const m = row.metadata;
                const isSel = selected?.ref.assetId === row.ref.assetId;
                return (
                  <button key={row.ref.assetId} type="button" onClick={() => void selectRow(row.ref)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', padding: '9px 12px', border: 'none', borderBottom: '1px solid #f1f5f9', background: isSel ? '#eff6ff' : '#fff' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{m?.assetType ?? 'asset'}{m?.platform ? ` · ${m.platform}` : ''}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      {m?.createdAt ? new Date(m.createdAt).toLocaleDateString() : ''}{m?.templateId ? ` · ${m.templateId}` : ''}{m?.tags?.length ? ` · ${m.tags.slice(0, 3).join(', ')}` : ''}
                    </div>
                  </button>
                );
              })}
          </div>

          <div style={{ border: '1px solid #eef2f7', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Preview</div>
            {selected ? (
              <>
                {selected.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selected.preview} alt={selected.payload.title} style={{ width: '100%', maxHeight: 180, objectFit: 'contain', borderRadius: 8, border: '1px solid #e5e7eb' }} />
                ) : <div style={{ width: '100%', height: 120, borderRadius: 8, border: '1px solid #e5e7eb', background: '#f8fafc' }} />}
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginTop: 8 }}>{selected.payload.title}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>v{selected.ref.version} · reused, not regenerated</div>
                <button type="button" onClick={() => void attach()} disabled={attaching}
                  style={{ marginTop: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 13px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                  <Check size={15} /> {attaching ? 'Attaching…' : 'Attach to post'}
                </button>
              </>
            ) : <div style={{ fontSize: 12.5, color: '#94a3b8' }}>Select an asset to preview and attach.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

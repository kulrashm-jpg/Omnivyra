import React from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, Layers, CheckCircle2, AlertTriangle, ArrowUpCircle, Link2Off } from 'lucide-react';
import { useCompanyContext } from '../../../components/CompanyContext';
import PageLoader from '../../../components/PageLoader';
import type { CampaignDesignSystem, CampaignDesignHealth, CollectionVersionDiff } from '../../../lib/creator-templates/campaignDesignSystem';
import type { TemplateCollection } from '../../../lib/creator-templates/collection';

interface DesignRecommendation { collection: TemplateCollection; score: number; reasons: string[]; matchedFamilies: string[] }
interface ScoredRollup { key: string; assetCount: number; performance: { score: number; explanation: string }; ctr: number; engagementRate: number; byPlatform: { platform: string; ctr: number }[] }
interface CampaignPerf { assetCount: number; templates: ScoredRollup[]; collections: ScoredRollup[]; campaignDesign: ScoredRollup | null; weakFamilies: string[]; recommendations: string[] }
interface EvoRec { id: string; type: string; title: string; evidence: string[]; impactedMetrics: string[]; expectedBenefit: string; confidence: { level: string; value: number } }
interface EvoAnalysis { collectionId: string; strengths: string[]; weaknesses: string[]; recommendations: EvoRec[] }

/**
 * Campaign Design System dashboard — attach a Collection to a Campaign, view
 * health + version pinning, and upgrade (with a deterministic comparison).
 * Reuses the collection + recommendation architecture; no rendering changes.
 */
export default function CampaignDesignSystemPage() {
  const router = useRouter();
  const { selectedCompanyId, isLoading } = useCompanyContext();
  const campaignId = typeof router.query.campaign_id === 'string' ? router.query.campaign_id : '';
  const [ds, setDs] = React.useState<CampaignDesignSystem | null>(null);
  const [health, setHealth] = React.useState<CampaignDesignHealth | null>(null);
  const [upgrade, setUpgrade] = React.useState<CollectionVersionDiff | null>(null);
  const [collections, setCollections] = React.useState<TemplateCollection[]>([]);
  const [recs, setRecs] = React.useState<DesignRecommendation[]>([]);
  const [perf, setPerf] = React.useState<CampaignPerf | null>(null);
  const [evo, setEvo] = React.useState<EvoAnalysis | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!campaignId) return;
    fetch(`/api/creator-templates/campaign-design-system/${encodeURIComponent(campaignId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setDs(d?.designSystem ?? null); setHealth(d?.health ?? null); setUpgrade(d?.upgrade ?? null); })
      .catch(() => { /* none attached */ })
      .finally(() => setLoaded(true));
  }, [campaignId]);
  React.useEffect(() => { load(); }, [load]);

  // Performance intelligence (deterministic) — measured analytics rolled up to
  // templates / collections / campaign design system.
  React.useEffect(() => {
    if (!campaignId) return;
    fetch(`/api/creator-templates/design-performance/${encodeURIComponent(campaignId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.performance) setPerf(d.performance); })
      .catch(() => { /* best-effort */ });
  }, [campaignId, ds]);

  // Evolution analysis (deterministic, read-only) — strengths / weaknesses /
  // recommendations from measured performance + diagnostics.
  React.useEffect(() => {
    if (!campaignId || !ds) return;
    fetch(`/api/creator-templates/design-evolution/${encodeURIComponent(campaignId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.analysis) setEvo(d.analysis); })
      .catch(() => { /* best-effort */ });
  }, [campaignId, ds]);

  React.useEffect(() => {
    if (!selectedCompanyId) return;
    fetch(`/api/creator-templates/collections?company_id=${encodeURIComponent(selectedCompanyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.collections)) setCollections(d.collections); })
      .catch(() => { /* best-effort */ });
  }, [selectedCompanyId]);

  // Design System Strategist — deterministic recommendations from the campaign
  // strategy params carried in the URL (objective/audience/platform/industry…).
  React.useEffect(() => {
    if (!selectedCompanyId) return;
    const q = router.query;
    fetch('/api/creator-templates/design-system-strategist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: selectedCompanyId,
        objective: typeof q.objective === 'string' ? q.objective : undefined,
        campaign_type: typeof q.campaign_type === 'string' ? q.campaign_type : undefined,
        audience: typeof q.audience === 'string' ? q.audience : undefined,
        industry: typeof q.industry === 'string' ? q.industry : undefined,
        platform_mix: typeof q.platform_mix === 'string' ? q.platform_mix.split(',').filter(Boolean) : undefined,
        visual_style: typeof q.visual_style === 'string' ? q.visual_style : undefined,
      }),
    }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (Array.isArray(d?.recommendations)) setRecs(d.recommendations); }).catch(() => { /* best-effort */ });
  }, [selectedCompanyId, router.query]);

  async function attach(collectionId: string) {
    if (busy) return; setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/creator-templates/campaign-design-system/${encodeURIComponent(campaignId)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: selectedCompanyId, collection_id: collectionId }),
      });
      const d = await res.json();
      if (!res.ok) setError((d?.validation?.errors || [d?.error]).filter(Boolean).join(' '));
      else load();
    } catch { setError('Attach failed.'); } finally { setBusy(false); }
  }
  async function doUpgrade() {
    if (busy) return; setBusy(true);
    try {
      const res = await fetch(`/api/creator-templates/campaign-design-system/${encodeURIComponent(campaignId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company_id: selectedCompanyId, op: 'upgrade' }),
      });
      if (res.ok) load();
    } catch { /* ignore */ } finally { setBusy(false); }
  }
  async function detach() {
    if (busy) return; setBusy(true);
    try {
      await fetch(`/api/creator-templates/campaign-design-system/${encodeURIComponent(campaignId)}`, { method: 'DELETE' });
      setDs(null); setHealth(null); setUpgrade(null);
    } catch { /* ignore */ } finally { setBusy(false); }
  }

  if (isLoading) return <PageLoader />;
  if (!campaignId) return <div style={{ padding: 28, color: '#94a3b8' }}>Provide ?campaign_id= to manage a campaign design system.</div>;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 28, color: '#e5e7eb' }}>
      <button type="button" onClick={() => router.back()} style={linkBtn}><ArrowLeft size={15} /> Back</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
        <Layers size={22} color="#60a5fa" />
        <h1 style={{ fontSize: 21, fontWeight: 800, color: '#f8fafc', margin: 0 }}>Campaign Design System</h1>
      </div>

      {error ? <div style={errBox}>{error}</div> : null}

      {ds ? (
        <>
          {/* Active collection */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#f8fafc' }}>{ds.pinnedSnapshot.name}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{ds.pinnedSnapshot.category} · pinned to v{ds.pinnedVersion}</div>
              </div>
              <button type="button" onClick={detach} disabled={busy} style={{ ...linkBtn, color: '#fca5a5' }}><Link2Off size={14} /> Detach</button>
            </div>

            {/* Health */}
            {health ? (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: health.ok ? '#86efac' : '#fca5a5' }}>
                  {health.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                  Collection health: {health.ok ? 'All referenced templates valid' : 'Issues found'}
                </div>
                <div style={{ fontSize: 12.5, color: '#94a3b8' }}>Covers: {health.presentFamilies.join(', ') || '—'}</div>
                {health.missingFamilies.length ? <div style={{ fontSize: 12.5, color: '#fbbf24' }}>Missing families: {health.missingFamilies.join(', ')}</div> : null}
                {health.brokenRefs.length ? <div style={{ fontSize: 12.5, color: '#fca5a5' }}>Broken references: {health.brokenRefs.length}</div> : null}
                <div style={{ fontSize: 12.5, color: '#64748b' }}>{ds.pinnedSnapshot.templateIds.length} template(s) in this design system.</div>
              </div>
            ) : null}
          </div>

          {/* Upgrade (deterministic comparison) */}
          {upgrade?.upgradeAvailable ? (
            <div style={{ ...card, borderColor: '#1e3a8a' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: '#93c5fd', fontWeight: 700, fontSize: 14 }}>
                <ArrowUpCircle size={16} /> New version available: v{upgrade.fromVersion} → v{upgrade.toVersion}
              </div>
              <ul style={{ fontSize: 12.5, color: '#cbd5e1', marginTop: 8, paddingLeft: 18, lineHeight: 1.7 }}>
                {upgrade.addedTemplateIds.length ? <li>{upgrade.addedTemplateIds.length} template(s) added</li> : null}
                {upgrade.removedTemplateIds.length ? <li>{upgrade.removedTemplateIds.length} template(s) removed</li> : null}
                {upgrade.addedFamilies.length ? <li>New families: {upgrade.addedFamilies.join(', ')}</li> : null}
                {upgrade.removedFamilies.length ? <li>Removed families: {upgrade.removedFamilies.join(', ')}</li> : null}
                {upgrade.reordered ? <li>Template order changed</li> : null}
                {upgrade.coverChanged ? <li>Cover changed</li> : null}
              </ul>
              <button type="button" onClick={doUpgrade} disabled={busy} style={{ ...primaryBtn, marginTop: 6 }}>Upgrade campaign to v{upgrade.toVersion}</button>
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 12 }}>Campaign is pinned to the latest collection version.</div>
          )}

          {/* Performance intelligence */}
          {perf ? (
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 0.4 }}>Performance intelligence</div>
              {perf.assetCount === 0 ? (
                <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 8 }}>No measured performance yet — publish assets to build intelligence.</div>
              ) : (
                <>
                  <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 6 }}>{perf.assetCount} measured asset(s)</div>
                  {perf.campaignDesign ? (
                    <div style={{ fontSize: 13, color: '#e5e7eb', marginTop: 8 }}>Design-system performance: <strong style={{ color: perf.campaignDesign.performance.score >= 60 ? '#86efac' : '#fbbf24' }}>{perf.campaignDesign.performance.score}/100</strong></div>
                  ) : null}

                  {perf.templates.length ? (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 4 }}>Top templates</div>
                      {perf.templates.slice(0, 3).map((t) => (
                        <div key={t.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: '#cbd5e1', padding: '3px 0' }}>
                          <span>{t.key.slice(0, 10)}… · {t.assetCount} asset(s)</span>
                          <span style={{ color: t.performance.score >= 60 ? '#86efac' : '#fca5a5' }}>{t.performance.score}/100</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {perf.weakFamilies.length ? (
                    <div style={{ fontSize: 12.5, color: '#fbbf24', marginTop: 10 }}>Weak families: {perf.weakFamilies.join(', ')}</div>
                  ) : null}

                  {perf.recommendations.length ? (
                    <ul style={{ fontSize: 12.5, color: '#cbd5e1', marginTop: 8, paddingLeft: 18, lineHeight: 1.7 }}>
                      {perf.recommendations.map((r) => <li key={r}>{r}</li>)}
                    </ul>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {/* Evolution — deterministic recommendations (read-only; approve via versioning) */}
          {evo && (evo.strengths.length || evo.weaknesses.length || evo.recommendations.length) ? (
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 0.4 }}>Evolution</div>
              {evo.strengths.length ? (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11.5, color: '#86efac', fontWeight: 700 }}>Strengths</div>
                  <ul style={{ fontSize: 12, color: '#cbd5e1', margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>{evo.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
                </div>
              ) : null}
              {evo.weaknesses.length ? (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11.5, color: '#fbbf24', fontWeight: 700 }}>Weaknesses</div>
                  <ul style={{ fontSize: 12, color: '#cbd5e1', margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>{evo.weaknesses.map((w) => <li key={w}>{w}</li>)}</ul>
                </div>
              ) : null}
              {evo.recommendations.length ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11.5, color: '#93c5fd', fontWeight: 700, marginBottom: 6 }}>Recommendations</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {evo.recommendations.map((r) => (
                      <div key={r.id} style={{ border: '1px solid #1f2937', borderRadius: 10, padding: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#f8fafc' }}>{r.title}</span>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: r.confidence.level === 'high' ? '#86efac' : r.confidence.level === 'medium' ? '#fbbf24' : '#94a3b8' }}>{r.confidence.level} confidence</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 4 }}>{r.evidence.join(' · ')}</div>
                        <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 3 }}>Expected: {r.expectedBenefit} · Metrics: {r.impactedMetrics.join(', ')}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>Approve changes in the Collection editor — each accepted change creates a new collection version (existing versioning).</div>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : loaded ? (
        /* Attach — strategist recommendations + manual selection */
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>Recommended design systems</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 4 }}>Every asset generated in this campaign will inherit the collection's visual system. Manual selection is always available.</div>
          {(() => {
            const list: DesignRecommendation[] = recs.length ? recs : collections.map((c) => ({ collection: c, score: 0, reasons: [], matchedFamilies: [] }));
            if (!list.length) return <div style={{ fontSize: 13, color: '#64748b', marginTop: 12 }}>No collections yet. Create one in Collections first.</div>;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {list.map(({ collection: c, score, reasons }) => (
                  <div key={c.id} style={{ border: `1px solid ${score > 0 ? '#1e3a8a' : '#1f2937'}`, borderRadius: 10, padding: 11 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {c.preview.coverUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.preview.coverUrl} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', border: '1px solid #1f2937' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
                        ) : <div style={{ width: 44, height: 44, borderRadius: 8, background: '#020617', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Layers size={18} color="#1e3a8a" /></div>}
                        <div>
                          <div style={{ color: '#f8fafc', fontSize: 13.5, fontWeight: 600 }}>{c.name}{score > 0 ? <span style={{ marginLeft: 8, fontSize: 11, color: '#86efac' }}>★ {score}</span> : null}</div>
                          <div style={{ fontSize: 11.5, color: '#64748b' }}>{c.category} · v{c.version} · {c.templateIds.length} template(s)</div>
                        </div>
                      </div>
                      <button type="button" onClick={() => attach(c.id)} disabled={busy} style={primaryBtn}>Use collection</button>
                    </div>
                    {reasons.length ? (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                        {reasons.map((r) => <span key={r} style={{ fontSize: 10.5, color: '#bfdbfe', border: '1px solid #1e3a8a', background: '#1e3a8a22', borderRadius: 999, padding: '2px 8px' }}>{r}</span>)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}

const linkBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: '#93c5fd', fontSize: 13, cursor: 'pointer', padding: 0 };
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' };
const card: React.CSSProperties = { border: '1px solid #1f2937', borderRadius: 14, padding: 16, background: '#0b1220', marginTop: 14 };
const errBox: React.CSSProperties = { marginTop: 14, color: '#fca5a5', fontSize: 13, border: '1px solid #7f1d1d', background: '#7f1d1d22', borderRadius: 8, padding: 10 };

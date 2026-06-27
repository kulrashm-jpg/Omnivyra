import React from 'react';
import { useRouter } from 'next/router';
import { Sparkles, ArrowLeft, Wand2 } from 'lucide-react';
import { useCompanyContext } from '../../../components/CompanyContext';
import PageLoader from '../../../components/PageLoader';

const EXAMPLES = [
  'Create a luxury product announcement template.',
  'I want a bold LinkedIn hiring template.',
  'Create a minimal thought leadership carousel.',
  'Design an infographic for SaaS metrics.',
];

/**
 * AI Template Creator — natural-language prompt → Template Intent (AI) →
 * deterministic compiler → CreatorTemplate → opens in the EXISTING editor where
 * the preview/validation/Quality-Inspector pipeline runs and the user edits
 * before saving. No new template model, no new rendering path.
 */
export default function AiTemplateCreatorPage() {
  const router = useRouter();
  const { selectedCompanyId, isLoading } = useCompanyContext();
  const [prompt, setPrompt] = React.useState('');
  const [family, setFamily] = React.useState<'' | 'image' | 'carousel' | 'infographic'>('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function generate() {
    const p = prompt.trim();
    if (!p || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/creator-templates/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: p, company_id: selectedCompanyId, family: family || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data?.template?.id) { setError(data?.error || 'Generation failed.'); setBusy(false); return; }
      // Open the generated draft in the existing editor (preview renders there).
      router.push(`/command-center/creator-content/templates-editor?id=${encodeURIComponent(data.template.id)}`);
    } catch {
      setError('Generation failed. Please try again.');
      setBusy(false);
    }
  }

  if (isLoading) return <PageLoader />;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 28, color: '#e5e7eb' }}>
      <button type="button" onClick={() => router.back()} style={linkBtn}><ArrowLeft size={15} /> Back</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
        <Sparkles size={22} color="#a78bfa" />
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#f8fafc', margin: 0 }}>Create a template with AI</h1>
      </div>
      <p style={{ color: '#94a3b8', fontSize: 13.5, marginTop: 8 }}>
        Describe the template you want. AI proposes the design; a deterministic compiler builds the real
        template, then it opens in the editor with a live preview for you to refine before saving.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => setPrompt(ex)} disabled={busy}
            style={{ fontSize: 12, color: '#cbd5e1', background: '#020617', border: '1px solid #1f2937', borderRadius: 999, padding: '6px 11px', cursor: 'pointer' }}>
            {ex}
          </button>
        ))}
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. Create a minimal thought leadership carousel for B2B founders."
        rows={4}
        style={{ width: '100%', marginTop: 14, background: '#020617', border: '1px solid #334155', borderRadius: 12, padding: 14, color: '#f8fafc', fontSize: 14, resize: 'vertical' }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12.5, color: '#94a3b8' }}>Asset type</label>
        <select value={family} onChange={(e) => setFamily(e.target.value as typeof family)} disabled={busy}
          style={{ background: '#020617', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', color: family ? '#f8fafc' : '#64748b', fontSize: 13 }}>
          <option value="">Let AI decide</option>
          <option value="image">Image</option>
          <option value="carousel">Carousel</option>
          <option value="infographic">Infographic</option>
        </select>
        <button type="button" onClick={generate} disabled={busy || !prompt.trim()}
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, background: busy || !prompt.trim() ? '#1e293b' : '#7c3aed', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 700, fontSize: 14, cursor: busy || !prompt.trim() ? 'default' : 'pointer' }}>
          <Wand2 size={16} /> {busy ? 'Generating…' : 'Generate template'}
        </button>
      </div>

      {error ? <div style={{ marginTop: 14, color: '#fca5a5', fontSize: 13, border: '1px solid #7f1d1d', background: '#7f1d1d22', borderRadius: 8, padding: 10 }}>{error}</div> : null}
    </div>
  );
}

const linkBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', color: '#93c5fd', fontSize: 13, cursor: 'pointer', padding: 0 };

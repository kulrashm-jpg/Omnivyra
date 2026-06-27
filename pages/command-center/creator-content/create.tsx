import React from 'react';
import { useRouter } from 'next/router';
import { Image as ImageIcon, LayoutGrid, BarChart3 } from 'lucide-react';
import { useCompanyContext } from '../../../components/CompanyContext';
import PageLoader from '../../../components/PageLoader';
import type { TemplateAssetFamily } from '../../../lib/creator-templates';

/**
 * Creator Content → Create → Select Asset Type.
 *
 * Entry screen for the template-first flow. Picking a family routes to that
 * family's template gallery. No content is collected here.
 */

const FAMILIES: Array<{ key: TemplateAssetFamily; label: string; blurb: string; icon: React.ReactNode }> = [
  { key: 'image', label: 'Image', blurb: 'Single visual — headline, quote, promo, or a clean branded image.', icon: <ImageIcon size={28} /> },
  { key: 'carousel', label: 'Carousel', blurb: 'Multi-slide stories, lessons, and checklists.', icon: <LayoutGrid size={28} /> },
  { key: 'infographic', label: 'Infographic', blurb: 'Structured data — stats, process, timeline, comparison.', icon: <BarChart3 size={28} /> },
];

export default function CreatorCreatePage() {
  const router = useRouter();
  const { user, authChecked, isLoading } = useCompanyContext();

  React.useEffect(() => {
    if (authChecked && !isLoading && !user?.userId) router.replace('/login');
  }, [authChecked, isLoading, user?.userId, router]);

  if (!authChecked || isLoading) return <PageLoader />;

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '32px 20px', color: '#e5e7eb' }}>
      <div style={{ fontSize: 13, color: '#93c5fd', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Creator Content</div>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: '6px 0 6px', color: '#f8fafc' }}>Create — choose an asset type</h1>
      <p style={{ color: '#9ca3af', marginBottom: 28 }}>Pick a type to browse its templates. You’ll choose a template before adding any content.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        {FAMILIES.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => router.push(`/command-center/creator-content/${f.key}/templates`)}
            style={{
              textAlign: 'left', cursor: 'pointer', background: '#0b1220', border: '1px solid #1f2937',
              borderRadius: 14, padding: 20, color: '#e5e7eb', transition: 'border-color 120ms',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#2563eb'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#1f2937'; }}
          >
            <div style={{ color: '#60a5fa', marginBottom: 12 }}>{f.icon}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#f8fafc', marginBottom: 6 }}>{f.label}</div>
            <div style={{ fontSize: 13, color: '#9ca3af' }}>{f.blurb}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

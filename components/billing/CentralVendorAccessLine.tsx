/**
 * Public pricing page: the ONE mode-B addition (owner, 2026-11-10).
 *
 * "Centralized Apollo access: N Omnivyra credits = 1 Apollo credit", with N
 * from the same pricing function that charges, at the platform's standard
 * credit rate (a public visitor has no organisation). Renders nothing for a
 * vendor whose cost is not yet configured, so it never advertises an
 * unavailable option.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';

interface Quote { vendor: string; unit: string; creditsPerUnit: number | null; available: boolean }

const VENDOR_LABEL: Record<string, string> = { apollo: 'Apollo' };

export default function CentralVendorAccessLine() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  useEffect(() => {
    let live = true;
    apiFetch('/api/billing/vendor-access-quote')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => { if (live && body && Array.isArray(body.vendors)) setQuotes(body.vendors); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  const shown = quotes.filter((q) => q.available && q.creditsPerUnit != null);
  if (!shown.length) return null;
  return (
    <div className="mt-5 rounded-2xl border border-[#D8E3F0] bg-[#F7FBFF] px-5 py-4 text-sm text-[#071D3A]" data-testid="central-vendor-access">
      {shown.map((q) => {
        const label = VENDOR_LABEL[q.vendor] ?? q.vendor;
        return (
          <p key={q.vendor}>
            <strong>Centralized {label} access:</strong> {q.creditsPerUnit} Omnivyra credits = 1 {label} {q.unit}.{' '}
            <span className="text-[#5D6F83]">Optional. Or use your own {label} key at no Omnivyra cost.</span>
          </p>
        );
      })}
    </div>
  );
}

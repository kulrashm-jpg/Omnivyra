// W5-2 (audit B-29): the analytics dashboard statically pulled recharts
// (~90–130 KB gz incl. d3) into the route's initial JS via this barrel.
// dynamic() defers the chart bundle to mount; ssr:false (charts are
// client-measured anyway) with a layout-preserving fallback.
import dynamic from 'next/dynamic';
const SystemStateDashboard = dynamic(
  () => import('../components/analytics/SystemStateDashboard'),
  { ssr: false, loading: () => <div aria-busy="true" className="min-h-[480px] w-full animate-pulse rounded-md bg-gray-50" /> },
);
import { useCompanyContext } from '../components/CompanyContext';

export default function AnalyticsPage() {
  const { selectedCompanyId } = useCompanyContext();

  if (!selectedCompanyId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f7fb] px-6">
        <div className="rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
          <h1 className="text-xl font-semibold text-slate-900">Analytics</h1>
          <p className="mt-2 text-sm text-slate-500">Select a company to view current system state.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f7fb] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SystemStateDashboard companyId={selectedCompanyId} variant="page" />
      </div>
    </div>
  );
}

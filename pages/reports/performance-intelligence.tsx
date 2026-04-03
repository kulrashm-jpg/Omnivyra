import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { ArrowRight, CheckCircle2, Lock, Upload, Zap } from 'lucide-react';
import { useRouter } from 'next/router';
import ReportFormModal from '@/components/ReportFormModal';
import { useCompanyContext } from '@/components/CompanyContext';

export default function PerformanceIntelligencePage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [dataTab, setDataTab] = useState<'integrations' | 'upload' | 'manual'>('integrations');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [manualData, setManualData] = useState({ monthlyVisitors: '', topChannels: '', conversionRate: '' });
  const [readiness, setReadiness] = useState<any>(null);

  useEffect(() => {
    let active = true;

    async function loadReadiness() {
      if (!selectedCompanyId) {
        if (active) setReadiness(null);
        return;
      }

      const res = await fetch(`/api/reports/readiness?companyId=${encodeURIComponent(selectedCompanyId)}`, {
        credentials: 'include',
      }).catch(() => null);

      if (!active || !res?.ok) return;
      const body = await res.json().catch(() => null);
      if (active) setReadiness(body);
    }

    void loadReadiness();
    return () => {
      active = false;
    };
  }, [selectedCompanyId]);

  const hasManualData = useMemo(
    () => Object.values(manualData).some((value) => String(value || '').trim().length > 0),
    [manualData],
  );
  const integrationsConnected =
    (dataTab === 'upload' && Boolean(uploadedFile)) ||
    (dataTab === 'manual' && hasManualData) ||
    Boolean(readiness?.reports?.performance?.ready);
  const readinessLabel = integrationsConnected
    ? 'Ready to generate'
    : (readiness?.reports?.performance?.missing_requirements?.[0] as string | undefined) || 'Connect integrations below to proceed';

  return (
    <>
      <Head>
        <title>Performance Intelligence Report | Omniware</title>
        <meta
          name="description"
          content="Understand what's actually working in your digital presence. Get detailed performance analysis, funnel drop-off insights, and channel performance metrics."
        />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
        {/* Back Nav */}
        <div className="border-b border-gray-200 bg-white sticky top-0 z-40">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
            <button onClick={() => router.push('/reports')} className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 text-sm transition-colors">
              ← Back to Reports
            </button>
            <span className="bg-purple-100 text-purple-700 text-xs font-bold px-3 py-1 rounded-full">40–80 Credits</span>
          </div>
        </div>

        {/* Hero Section */}
        <section className="relative px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-6 inline-block">
              <span className="rounded-full bg-blue-100 px-4 py-2 text-sm font-semibold text-blue-700">
                Premium Intelligence
              </span>
            </div>

            <h1 className="mb-4 text-5xl font-bold tracking-tight text-gray-900 sm:text-6xl">
              Performance Intelligence Report
            </h1>

            <p className="mx-auto mb-8 max-w-2xl text-xl text-gray-600">
              Understand what's actually working — and what's costing you conversions. Get detailed insights into traffic quality, funnel performance, and conversion gaps.
            </p>

            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:justify-center sm:gap-4">
              <button
                onClick={() => setIsModalOpen(true)}
                disabled={!integrationsConnected}
                className={`inline-flex items-center justify-center gap-2 rounded-lg px-8 py-4 font-bold transition-all ${
                  integrationsConnected
                    ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-700 hover:to-blue-800 shadow-lg hover:shadow-xl'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                }`}
              >
                Generate Report
                <ArrowRight className="h-5 w-5" />
              </button>
            </div>

            <p className="text-sm text-gray-500 mb-2">
              {integrationsConnected ? (
                <span className="flex items-center justify-center gap-1">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  Ready to generate
                </span>
              ) : (
                <span className="flex items-center justify-center gap-1">
                  <Lock className="h-4 w-4" />
                  {readinessLabel}
                </span>
              )}
            </p>
            <p className="text-xs text-gray-400">Takes 3–5 minutes to generate • PDF download included</p>
          </div>
        </section>

        {/* When to Use This */}
        <section className="px-4 py-12 sm:px-6 lg:px-8 bg-blue-50">
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-6 text-2xl font-bold text-gray-900">When to Use This Report</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg bg-white p-4 border border-blue-200">
                <p className="text-sm text-gray-700">✓ You're getting traffic but conversions are flat</p>
              </div>
              <div className="rounded-lg bg-white p-4 border border-blue-200">
                <p className="text-sm text-gray-700">✓ You're unsure which channels are actually working</p>
              </div>
              <div className="rounded-lg bg-white p-4 border border-blue-200">
                <p className="text-sm text-gray-700">✓ You need to justify budget allocation to leadership</p>
              </div>
              <div className="rounded-lg bg-white p-4 border border-blue-200">
                <p className="text-sm text-gray-700">✓ You suspect your funnel has critical drop-off points</p>
              </div>
            </div>
          </div>
        </section>

        {/* What This Report Does */}
        <section className="px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl">
            <div className="mb-12 rounded-2xl bg-white p-8 shadow-sm border border-gray-100">
              <h2 className="mb-4 flex items-center gap-3 text-2xl font-bold text-gray-900">
                <Zap className="h-8 w-8 text-blue-600" />
                What This Report Analyzes
              </h2>

              <p className="mb-6 text-gray-600 leading-relaxed">
                We connect to your analytics and ads platforms to reveal the true performance of your digital presence. This isn't a generic web audit — it's a detailed analysis of your actual user behavior, conversions, and traffic quality.
              </p>

              <div className="space-y-3 text-gray-700">
                <p className="flex gap-3">
                  <span className="text-blue-600 font-bold">→</span>
                  <span>Analyzes real traffic data across channels</span>
                </p>
                <p className="flex gap-3">
                  <span className="text-blue-600 font-bold">→</span>
                  <span>Identifies conversion funnel drop-offs and bottlenecks</span>
                </p>
                <p className="flex gap-3">
                  <span className="text-blue-600 font-bold">→</span>
                  <span>Compares channel performance and ROI</span>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* What You Will Get */}
        <section className="px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-12 text-center text-3xl font-bold text-gray-900">What You'll Get in This Report</h2>

            <div className="grid gap-6 md:grid-cols-2">
              {/* Card 1 */}
              <div className="rounded-xl bg-white p-8 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100">
                  <span className="text-2xl">📊</span>
                </div>
                <h3 className="mb-3 font-bold text-gray-900">Traffic Quality Analysis</h3>
                <p className="text-sm text-gray-600">
                  Understand where your visitors come from, how engaged they are, and whether you're attracting the right audience.
                </p>
              </div>

              {/* Card 2 */}
              <div className="rounded-xl bg-white p-8 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100">
                  <span className="text-2xl">🔄</span>
                </div>
                <h3 className="mb-3 font-bold text-gray-900">Funnel Drop-Off Map</h3>
                <p className="text-sm text-gray-600">
                  See exactly where users leave your funnel and why. Pinpoint the highest-impact optimization opportunities.
                </p>
              </div>

              {/* Card 3 */}
              <div className="rounded-xl bg-white p-8 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100">
                  <span className="text-2xl">📈</span>
                </div>
                <h3 className="mb-3 font-bold text-gray-900">Conversion Gap Analysis</h3>
                <p className="text-sm text-gray-600">
                  See how your conversion rates compare to benchmarks. Identify gaps between sections of your audience.
                </p>
              </div>

              {/* Card 4 */}
              <div className="rounded-xl bg-white p-8 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100">
                  <span className="text-2xl">📡</span>
                </div>
                <h3 className="mb-3 font-bold text-gray-900">Channel Performance Breakdown</h3>
                <p className="text-sm text-gray-600">
                  Detailed metrics per channel (organic, paid, direct) so you know where to invest budget.
                </p>
              </div>

              {/* Card 5 */}
              <div className="rounded-xl bg-white p-8 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100">
                  <span className="text-2xl">💡</span>
                </div>
                <h3 className="mb-3 font-bold text-gray-900">Actionable Recommendations</h3>
                <p className="text-sm text-gray-600">
                  Clear next steps prioritized by impact. Know exactly what to fix and why it matters.
                </p>
              </div>

              {/* Card 6 */}
              <div className="rounded-xl bg-white p-8 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100">
                  <span className="text-2xl">📋</span>
                </div>
                <h3 className="mb-3 font-bold text-gray-900">Custom PDF Report</h3>
                <p className="text-sm text-gray-600">
                  Professional report you can share with your team. Includes visuals, data, and strategic insights.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Required Integrations */}
        <section className="px-4 py-16 sm:px-6 lg:px-8 bg-gray-50">
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-12 text-center text-3xl font-bold text-gray-900">Required Integrations</h2>

            <div className="mb-8 rounded-xl bg-white p-8 shadow-sm border border-gray-200">
              <p className="mb-4 text-gray-600">
                To generate this report, we need access to your performance data. All integrations are read-only and secure.
              </p>
              <p className="mb-6 text-sm text-gray-500 italic">
                These integrations are read-only and used only to analyze your data. We never modify or store your account data.
              </p>


        {/* ===== DATA COLLECTION SECTION ===== */}
        <section className="px-4 py-16 sm:px-6 lg:px-8 bg-white border-t border-b border-gray-100">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-3xl font-bold text-gray-900 mb-3 text-center">Connect Your Data Sources</h2>
            <p className="text-center text-gray-600 mb-8 max-w-xl mx-auto">
              We need access to your performance data to generate accurate insights. Choose how you'd like to provide it:
            </p>

            {/* Tabs */}
            <div className="flex rounded-xl bg-gray-100 p-1 mb-8 max-w-md mx-auto">
              {(['integrations', 'upload', 'manual'] as const).map((tab) => {
                const labels = { integrations: '🔗 Integrations', upload: '📁 Upload File', manual: '✏️ Manual Entry' };
                return (
                  <button
                    key={tab}
                    onClick={() => setDataTab(tab)}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                      dataTab === tab ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {labels[tab]}
                  </button>
                );
              })}
            </div>

            {/* Tab: Integrations */}
            {dataTab === 'integrations' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500 text-center mb-4">Connect read-only integrations so we can pull your live performance data.</p>
                {[
                  { icon: '📊', name: 'Google Analytics', desc: 'Traffic, sessions, bounce rate, and user behavior', required: true },
                  { icon: '🔍', name: 'Google Search Console', desc: 'Organic keywords, impressions, and click-through rates', required: true },
                  { icon: '💼', name: 'LinkedIn Ads', desc: 'Campaign performance and audience engagement', required: false },
                  { icon: '🟦', name: 'Facebook / Meta Ads', desc: 'Ad spend, reach, and conversion tracking', required: false },
                  { icon: '🛒', name: 'Shopify / WooCommerce', desc: 'Revenue, conversion funnel, and product performance', required: false },
                ].map((item) => (
                  <div key={item.name} className="flex items-center gap-4 rounded-xl bg-gray-50 p-4 border border-gray-200">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white border border-gray-200 text-2xl flex-shrink-0">
                      {item.icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-gray-900 text-sm">{item.name}</h3>
                        {item.required && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Required</span>}
                        {!item.required && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Optional</span>}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                    </div>
                    <button
                      onClick={() => router.push('/integrations')}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                        readiness?.integration_state?.[
                          item.name === 'Google Analytics'
                            ? 'google_analytics'
                            : item.name === 'Google Search Console'
                              ? 'google_search_console'
                              : item.name === 'LinkedIn Ads'
                                ? 'linkedin_ads'
                                : item.name === 'Facebook / Meta Ads'
                                  ? 'meta_ads'
                                  : 'shopify'
                        ]?.connected
                          ? 'bg-green-100 text-green-700 cursor-default'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      {readiness?.integration_state?.[
                        item.name === 'Google Analytics'
                          ? 'google_analytics'
                          : item.name === 'Google Search Console'
                            ? 'google_search_console'
                            : item.name === 'LinkedIn Ads'
                              ? 'linkedin_ads'
                              : item.name === 'Facebook / Meta Ads'
                                ? 'meta_ads'
                                : 'shopify'
                      ]?.connected ? '✓ Connected' : 'Manage'}
                    </button>
                  </div>
                ))}
                <p className="text-xs text-center text-gray-400 mt-4">
                  🔒 All integrations are read-only. We never modify or store your account data.
                </p>
              </div>
            )}

            {/* Tab: Upload */}
            {dataTab === 'upload' && (
              <div>
                <p className="text-sm text-gray-500 text-center mb-6">Don't want to connect integrations? Upload your exported data files instead.</p>
                <div
                  className="border-2 border-dashed border-blue-300 rounded-xl p-10 text-center bg-blue-50 hover:bg-blue-100 transition-colors cursor-pointer"
                  onClick={() => document.getElementById('perf-file-input')?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file) { setUploadedFile(file); }
                  }}
                >
                  <Upload className="w-10 h-10 text-blue-400 mx-auto mb-3" />
                  <p className="font-semibold text-gray-700 mb-1">
                    {uploadedFile ? `✓ ${uploadedFile.name}` : 'Drop your file here or click to browse'}
                  </p>
                  <p className="text-xs text-gray-500">Supports CSV, XLSX, JSON exports from GA4, Search Console, HubSpot, or ad platforms</p>
                  <input
                    id="perf-file-input"
                    type="file"
                    accept=".csv,.xlsx,.xls,.json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) { setUploadedFile(file); }
                    }}
                  />
                </div>
                {uploadedFile && (
                  <div className="mt-4 flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                    <span className="text-sm text-green-800 font-medium">✓ {uploadedFile.name} ready to analyze</span>
                    <button onClick={() => { setUploadedFile(null); }} className="text-xs text-gray-500 hover:text-red-600 transition-colors">Remove</button>
                  </div>
                )}
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { icon: '📊', name: 'Google Analytics 4', hint: 'Export → Explore → Download CSV' },
                    { icon: '🔍', name: 'Search Console', hint: 'Performance → Export → CSV' },
                    { icon: '📈', name: 'Ad Platform Export', hint: 'Campaign summary in CSV/XLSX format' },
                  ].map((item) => (
                    <div key={item.name} className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                      <div className="text-2xl mb-1">{item.icon}</div>
                      <p className="text-xs font-semibold text-gray-800 mb-0.5">{item.name}</p>
                      <p className="text-xs text-gray-400">{item.hint}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab: Manual Entry */}
            {dataTab === 'manual' && (
              <div className="max-w-xl mx-auto">
                <p className="text-sm text-gray-500 text-center mb-6">Enter your key performance numbers manually for a lighter-weight analysis.</p>
                <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Monthly Website Visitors</label>
                    <input type="number" min="0" placeholder="e.g. 50000"
                      value={manualData.monthlyVisitors}
                      onChange={(e) => setManualData((p) => ({ ...p, monthlyVisitors: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Top Traffic Channels</label>
                    <input type="text" placeholder="e.g. Organic 40%, Paid 30%, Direct 20%, Social 10%"
                      value={manualData.topChannels}
                      onChange={(e) => setManualData((p) => ({ ...p, topChannels: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Overall Conversion Rate (%)</label>
                    <input type="text" placeholder="e.g. 2.5"
                      value={manualData.conversionRate}
                      onChange={(e) => setManualData((p) => ({ ...p, conversionRate: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent" />
                  </div>
                  <button
                    onClick={() => undefined}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors text-sm"
                  >
                    Save Data &amp; Enable Report Generation
                  </button>
                </div>
                <p className="text-xs text-center text-gray-400 mt-3">Manual entry produces a lighter analysis. For full insights, connect integrations or upload data files.</p>
              </div>
            )}
          </div>
        </section>
              <div className="space-y-4">
                <div className="flex items-center gap-4 rounded-lg bg-gray-50 p-4 border border-gray-200">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                    <span className="text-xl">📊</span>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-gray-900">Google Analytics</h3>
                    <p className="text-sm text-gray-600">Traffic data, user behavior, conversions</p>
                  </div>
                  <div className={`px-3 py-1 rounded text-sm font-medium ${integrationsConnected ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                    {integrationsConnected ? '✓ Connected' : 'Required'}
                  </div>
                </div>

                <div className="flex items-center gap-4 rounded-lg bg-gray-50 p-4 border border-gray-200">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                    <span className="text-xl">🔍</span>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-gray-900">Google Search Console</h3>
                    <p className="text-sm text-gray-600">Organic search performance and keywords</p>
                  </div>
                  <div className={`px-3 py-1 rounded text-sm font-medium ${integrationsConnected ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                    {integrationsConnected ? '✓ Connected' : 'Required'}
                  </div>
                </div>
              </div>
            </div>

            {/* Integration Toggle */}
            <div className="flex items-center justify-between rounded-lg bg-blue-50 p-6 border border-blue-200">
              <div>
                <h3 className="font-bold text-gray-900">Readiness Status</h3>
                <p className="text-sm text-gray-600">{readinessLabel}</p>
              </div>
              <div className={`px-3 py-1 rounded text-sm font-medium ${integrationsConnected ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                {integrationsConnected ? 'Ready' : 'Needs data'}
              </div>
            </div>
          </div>
        </section>

        {/* Expected Output Preview */}
        <section className="px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-12 text-center text-3xl font-bold text-gray-900">What Your Report Will Include</h2>

            <div className="rounded-xl bg-white p-8 shadow-sm border border-gray-200">
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold flex-shrink-0">1</div>
                  <div>
                    <h3 className="font-bold text-gray-900 mb-1">Executive Summary</h3>
                    <p className="text-sm text-gray-600">Key findings and performance overview with your strongest and weakest areas highlighted</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold flex-shrink-0">2</div>
                  <div>
                    <h3 className="font-bold text-gray-900 mb-1">Detailed Performance Analysis</h3>
                    <p className="text-sm text-gray-600">Channel breakdowns, funnel drop-offs, and conversion metrics with visual charts and comparisons</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold flex-shrink-0">3</div>
                  <div>
                    <h3 className="font-bold text-gray-900 mb-1">Clear Gaps & Opportunities</h3>
                    <p className="text-sm text-gray-600">Specific, prioritized opportunities ranked by impact and ease of implementation</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold flex-shrink-0">4</div>
                  <div>
                    <h3 className="font-bold text-gray-900 mb-1">Actionable Next Steps</h3>
                    <p className="text-sm text-gray-600">Concrete recommendations you can implement immediately to improve performance</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Expected Outcome */}
        <section className="px-4 py-16 sm:px-6 lg:px-8 bg-blue-50">
          <div className="mx-auto max-w-4xl">
            <div className="rounded-xl bg-white p-8 shadow-sm border border-blue-200">
              <h2 className="mb-4 text-2xl font-bold text-gray-900">Expected Outcome</h2>
              <p className="text-lg text-gray-700 leading-relaxed">
                Clear visibility into what's actually driving your results and what's holding you back. You'll leave with specific, prioritized actions that have the highest impact on your business.
              </p>
            </div>
          </div>
        </section>

        {/* Pricing & CTA */}
        <section className="px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 p-12 text-center text-white">
            <h2 className="mb-4 text-3xl font-bold">Ready to Understand Your Performance?</h2>

            <p className="mb-8 text-lg text-blue-100">
              40–80 credits per report. Deducted only after your final confirmation.
            </p>

            <p className="mb-8 text-sm text-blue-200">
              ✓ Read-only integrations • ✓ Secure & encrypted • ✓ Results in 3–5 minutes
            </p>

            <button
              onClick={() => setIsModalOpen(true)}
              disabled={!integrationsConnected}
              className={`inline-flex items-center justify-center gap-2 rounded-lg px-10 py-4 font-bold text-lg transition-all ${
                integrationsConnected
                  ? 'bg-white text-blue-700 hover:bg-gray-100 shadow-lg'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              Generate Report
              <ArrowRight className="h-5 w-5" />
            </button>

            <p className="mt-3 text-xs text-blue-100">
              You'll review and confirm before any credits are used
            </p>

            <p className="mt-4 text-xs text-blue-100 border-t border-blue-500 pt-4">
              Your report will be ready within a few minutes
            </p>

            <p className="mt-6 text-xs text-blue-200">
              {integrationsConnected ? (
                '✓ Integrations connected. Ready to proceed.'
              ) : (
                'Toggle integrations above to enable this button'
              )}
            </p>
          </div>
        </section>
      </div>

      {/* Modal */}
      <ReportFormModal
        isOpen={isModalOpen}
        reportType="performance"
        isFreeReport={false}
        reportCategory="performance"
        generationContext={{
          source: dataTab,
          integrationsConnected,
          companyId: selectedCompanyId,
          uploadedFileName: uploadedFile?.name || null,
          manualData,
        }}
        onClose={() => setIsModalOpen(false)}
        onSubmitSuccess={() => {}}
      />
    </>
  );
}

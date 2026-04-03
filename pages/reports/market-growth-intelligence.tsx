import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { ArrowRight, CheckCircle2, Lock, Upload, Zap } from 'lucide-react';
import { useRouter } from 'next/router';
import ReportFormModal from '@/components/ReportFormModal';
import { useCompanyContext } from '@/components/CompanyContext';

export default function MarketGrowthIntelligencePage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [dataTab, setDataTab] = useState<'integrations' | 'upload' | 'manual'>('integrations');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [manualData, setManualData] = useState({ competitors: '', marketSize: '', topChannels: '' });
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
    Boolean(readiness?.reports?.growth?.ready);
  const readinessLabel = integrationsConnected
    ? 'Ready to generate'
    : (readiness?.reports?.growth?.missing_requirements?.[0] as string | undefined) || 'Connect integrations below to proceed';

  return (
    <>
      <Head>
        <title>Market & Growth Intelligence Report | Omniware</title>
        <meta
          name="description"
          content="Competitive positioning, budget direction, and growth opportunities. Learn where the market is moving and how to capitalize on it."
        />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50">
        {/* Back Nav */}
        <div className="border-b border-gray-200 bg-white sticky top-0 z-40">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
            <button onClick={() => router.push('/reports')} className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 text-sm transition-colors">
              ← Back to Reports
            </button>
            <span className="bg-red-100 text-red-700 text-xs font-bold px-3 py-1 rounded-full">80–150 Credits</span>
          </div>
        </div>

        {/* Hero Section */}
        <section className="relative px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-6 inline-block">
              <span className="rounded-full bg-emerald-100 px-4 py-2 text-sm font-semibold text-emerald-700">
                Premium Intelligence
              </span>
            </div>

            <h1 className="mb-4 text-5xl font-bold tracking-tight text-gray-900 sm:text-6xl">
              Market & Growth Intelligence Report
            </h1>

            <p className="mx-auto mb-8 max-w-2xl text-xl text-gray-600">
              See where the market is moving — and where you're falling behind. Understand competitive positioning, budget direction, and your biggest growth opportunities.
            </p>

            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:justify-center sm:gap-4">
              <button
                onClick={() => setIsModalOpen(true)}
                disabled={!integrationsConnected}
                className={`inline-flex items-center justify-center gap-2 rounded-lg px-8 py-4 font-bold transition-all ${
                  integrationsConnected
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-700 hover:to-teal-700 shadow-lg hover:shadow-xl'
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
        <section className="px-4 py-12 sm:px-6 lg:px-8 bg-emerald-50">
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-6 text-2xl font-bold text-gray-900">When to Use This Report</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg bg-white p-4 border border-emerald-200">
                <p className="text-sm text-gray-700">✓ You're planning campaigns or scaling your business</p>
              </div>
              <div className="rounded-lg bg-white p-4 border border-emerald-200">
                <p className="text-sm text-gray-700">✓ You're unsure where to invest your next marketing dollar</p>
              </div>
              <div className="rounded-lg bg-white p-4 border border-emerald-200">
                <p className="text-sm text-gray-700">✓ You need to understand your competitive position</p>
              </div>
              <div className="rounded-lg bg-white p-4 border border-emerald-200">
                <p className="text-sm text-gray-700">✓ You want to identify untapped growth opportunities</p>
              </div>
            </div>
          </div>
        </section>
        {/* What This Report Does */}
        <section className="px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl">
            <div className="mb-12 rounded-2xl bg-white p-8 shadow-sm border border-gray-100">
              <h2 className="mb-4 flex items-center gap-3 text-2xl font-bold text-gray-900">
                <Zap className="h-8 w-8 text-emerald-600" />
                What This Report Analyzes
              </h2>

              <p className="mb-6 text-gray-600 leading-relaxed">
                We analyze market trends, competitive landscapes, and your growth potential by examining analytics, ad platform data, and industry patterns. This reveals where budget should flow and what opportunities exist in your market.
              </p>

              <div className="space-y-3 text-gray-700">
                <p className="flex gap-3">
                  <span className="text-emerald-600 font-bold">→</span>
                  <span>Benchmarks your performance against market standards</span>
                </p>
                <p className="flex gap-3">
                  <span className="text-emerald-600 font-bold">→</span>
                  <span>Identifies untapped growth opportunities and market gaps</span>
                </p>
                <p className="flex gap-3">
                  <span className="text-emerald-600 font-bold">→</span>
                  <span>Analyzes competitor positioning and campaign timing</span>
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
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-100">
                  <span className="text-2xl">🎯</span>
                </div>
                <h3 className="mb-3 font-bold text-gray-900">Competitive Positioning</h3>
                <p className="text-sm text-gray-600">
                  Understand where you stand in your market. Know your strengths, weaknesses, and competitive advantages.
                </p>
              </div>

              {/* Card 2 */}
              <div className="rounded-xl bg-white p-8 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-100">
                  <span className="text-2xl">💰</span>
                </div>
                <h3 className="mb-3 font-bold text-gray-900">Budget Direction Strategy</h3>
                <p className="text-sm text-gray-600">
                  Clear recommendations on where to invest next. Maximize ROI by understanding which channels and markets matter most.
                </p>
              </div>

              {/* Card 3 */}
              <div className="rounded-xl bg-white p-8 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-100">
                  <span className="text-2xl">📅</span>
                </div>
                <h3 className="mb-3 font-bold text-gray-900">Campaign Timing Insights</h3>
                <p className="text-sm text-gray-600">
                  Know when competitors are active, when seasonality matters, and optimal windows for your campaigns.
                </p>
              </div>

              {/* Card 4 */}
              <div className="rounded-xl bg-white p-8 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-100">
                  <span className="text-2xl">🚀</span>
                </div>
                <h3 className="mb-3 font-bold text-gray-900">Growth Opportunity Map</h3>
                <p className="text-sm text-gray-600">
                  Discover untapped markets, audience segments, and channels where you can accelerate growth.
                </p>
              </div>

              {/* Card 5 */}
              <div className="rounded-xl bg-white p-8 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-100">
                  <span className="text-2xl">📊</span>
                </div>
                <h3 className="mb-3 font-bold text-gray-900">Market Trend Analysis</h3>
                <p className="text-sm text-gray-600">
                  Understand emerging trends in your industry and get ahead of market shifts before competitors.
                </p>
              </div>

              {/* Card 6 */}
              <div className="rounded-xl bg-white p-8 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-100">
                  <span className="text-2xl">📋</span>
                </div>
                <h3 className="mb-3 font-bold text-gray-900">Strategic Growth Plan</h3>
                <p className="text-sm text-gray-600">
                  Comprehensive roadmap with prioritized initiatives. Know exactly how to capitalize on every opportunity.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Required Integrations */}
        {/* ===== DATA COLLECTION SECTION ===== */}
        <section className="px-4 py-16 sm:px-6 lg:px-8 bg-white border-t border-b border-gray-100">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-3xl font-bold text-gray-900 mb-3 text-center">Connect Your Data Sources</h2>
            <p className="text-center text-gray-600 mb-8 max-w-xl mx-auto">
              For a full market and competitive analysis we need data context. Choose how to provide it:
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
                      dataTab === tab ? 'bg-white shadow text-emerald-700' : 'text-gray-500 hover:text-gray-700'
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
                <p className="text-sm text-gray-500 text-center mb-4">Connect read-only integrations so we can pull live market and competitive data.</p>
                {[
                  { icon: '📊', name: 'Google Analytics', desc: 'Traffic trends, audience profiles, and behavioral data', required: true },
                  { icon: '🔍', name: 'Google Search Console', desc: 'Organic keywords, market visibility, and impression share', required: true },
                  { icon: '💻', name: 'Google Ads', desc: 'Auction insights and competitive ad landscape', required: false },
                  { icon: '💼', name: 'LinkedIn Ads', desc: 'B2B audience data and market segment insights', required: false },
                  { icon: '🟦', name: 'Facebook / Meta Ads', desc: 'Market reach and audience size benchmarks', required: false },
                  { icon: '🌐', name: 'Website Crawl', desc: 'Competitor site analysis via your domain — no integration needed', required: false },
                ].map((item) => (
                  <div key={item.name} className="flex items-center gap-4 rounded-xl bg-gray-50 p-4 border border-gray-200">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white border border-gray-200 text-2xl flex-shrink-0">
                      {item.icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-gray-900 text-sm">{item.name}</h3>
                        {item.required && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Required</span>}
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
                              : item.name === 'Google Ads'
                                ? 'google_ads'
                                : item.name === 'LinkedIn Ads'
                                  ? 'linkedin_ads'
                                  : item.name === 'Facebook / Meta Ads'
                                    ? 'meta_ads'
                                    : 'website_crawl'
                        ]?.connected
                          ? 'bg-green-100 text-green-700 cursor-default'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      }`}
                    >
                      {readiness?.integration_state?.[
                        item.name === 'Google Analytics'
                          ? 'google_analytics'
                          : item.name === 'Google Search Console'
                            ? 'google_search_console'
                            : item.name === 'Google Ads'
                              ? 'google_ads'
                              : item.name === 'LinkedIn Ads'
                                ? 'linkedin_ads'
                                : item.name === 'Facebook / Meta Ads'
                                  ? 'meta_ads'
                                  : 'website_crawl'
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
                <p className="text-sm text-gray-500 text-center mb-6">Upload exported data files from your analytics and ad platforms.</p>
                <div
                  className="border-2 border-dashed border-emerald-300 rounded-xl p-10 text-center bg-emerald-50 hover:bg-emerald-100 transition-colors cursor-pointer"
                  onClick={() => document.getElementById('market-file-input')?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file) { setUploadedFile(file); }
                  }}
                >
                  <Upload className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
                  <p className="font-semibold text-gray-700 mb-1">
                    {uploadedFile ? `✓ ${uploadedFile.name}` : 'Drop your file here or click to browse'}
                  </p>
                  <p className="text-xs text-gray-500">Supports CSV, XLSX, JSON from GA4, Google Ads, LinkedIn, Facebook, or HubSpot</p>
                  <input
                    id="market-file-input"
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
                    { icon: '📊', name: 'GA4 Export', hint: 'Audience & acquisition reports as CSV' },
                    { icon: '💻', name: 'Google Ads Export', hint: 'Auction insights + campaign summary' },
                    { icon: '💼', name: 'CRM Export', hint: 'Lead source & pipeline data (CSV/XLSX)' },
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
                <p className="text-sm text-gray-500 text-center mb-6">Enter key market facts manually for a lighter competitive analysis.</p>
                <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Top 3 Competitors</label>
                    <input type="text" placeholder="e.g. competitor1.com, competitor2.com, competitor3.com"
                      value={manualData.competitors}
                      onChange={(e) => setManualData((p) => ({ ...p, competitors: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Estimated Market Size</label>
                    <input type="text" placeholder="e.g. $50M TAM, 200,000 potential customers"
                      value={manualData.marketSize}
                      onChange={(e) => setManualData((p) => ({ ...p, marketSize: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Current Marketing Channels</label>
                    <input type="text" placeholder="e.g. SEO 50%, LinkedIn 20%, Email 20%, Events 10%"
                      value={manualData.topChannels}
                      onChange={(e) => setManualData((p) => ({ ...p, topChannels: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent" />
                  </div>
                  <button
                    onClick={() => undefined}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-colors text-sm"
                  >
                    Save Data &amp; Enable Report Generation
                  </button>
                </div>
                <p className="text-xs text-center text-gray-400 mt-3">Manual entry produces a lighter analysis. For full insights, connect integrations or upload data files.</p>
              </div>
            )}
          </div>
        </section>

        {/* Expected Output Preview */}
        <section className="px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-12 text-center text-3xl font-bold text-gray-900">What Your Report Will Include</h2>

            <div className="rounded-xl bg-white p-8 shadow-sm border border-gray-200">
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 font-bold flex-shrink-0">1</div>
                  <div>
                    <h3 className="font-bold text-gray-900 mb-1">Competitive Positioning Analysis</h3>
                    <p className="text-sm text-gray-600">Where you stand relative to competitors, with strengths and vulnerabilities clearly identified</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 font-bold flex-shrink-0">2</div>
                  <div>
                    <h3 className="font-bold text-gray-900 mb-1">Market Trend Insights</h3>
                    <p className="text-sm text-gray-600">Emerging opportunities and market shifts that affect your business, with timing and budget recommendations</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 font-bold flex-shrink-0">3</div>
                  <div>
                    <h3 className="font-bold text-gray-900 mb-1">Growth Opportunity Map</h3>
                    <p className="text-sm text-gray-600">Untapped segments and channels ranked by potential impact, with ease of entry for each</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 font-bold flex-shrink-0">4</div>
                  <div>
                    <h3 className="font-bold text-gray-900 mb-1">Budget & Strategy Roadmap</h3>
                    <p className="text-sm text-gray-600">Specific recommendations on where to invest, when to invest, and what to expect from each initiative</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Expected Outcome */}
        <section className="px-4 py-16 sm:px-6 lg:px-8 bg-emerald-50">
          <div className="mx-auto max-w-4xl">
            <div className="rounded-xl bg-white p-8 shadow-sm border border-emerald-200">
              <h2 className="mb-4 text-2xl font-bold text-gray-900">Expected Outcome</h2>
              <p className="text-lg text-gray-700 leading-relaxed">
                A clear direction on where to invest your next marketing dollar and how to scale confidently. You'll have a prioritized roadmap that cuts through uncertainty and helps you compete effectively.
              </p>
            </div>
          </div>
        </section>

        {/* Pricing & CTA */}
        <section className="px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 p-12 text-center text-white">
            <h2 className="mb-4 text-3xl font-bold">Ready to Unlock Your Growth Potential?</h2>

            <p className="mb-8 text-lg text-emerald-100">
              80–150 credits per report. Deducted only after your final confirmation.
            </p>

            <p className="mb-8 text-sm text-emerald-200">
              ✓ Read-only integrations • ✓ Secure & encrypted • ✓ Results in 3–5 minutes
            </p>

            <button
              onClick={() => setIsModalOpen(true)}
              disabled={!integrationsConnected}
              className={`inline-flex items-center justify-center gap-2 rounded-lg px-10 py-4 font-bold text-lg transition-all ${
                integrationsConnected
                  ? 'bg-white text-emerald-700 hover:bg-gray-100 shadow-lg'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              Generate Report
              <ArrowRight className="h-5 w-5" />
            </button>

            <p className="mt-3 text-xs text-emerald-100">
              You'll review and confirm before any credits are used
            </p>

            <p className="mt-4 text-xs text-emerald-100 border-t border-emerald-500 pt-4">
              Your report will be ready within a few minutes
            </p>

            <p className="mt-6 text-xs text-emerald-200">
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
        reportType="market"
        isFreeReport={false}
        reportCategory="growth"
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

import React, { useState } from 'react';
import { X, Zap, CheckCircle2, ArrowRight, TrendingUp, Activity, Target } from 'lucide-react';

interface ReportGenerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportName: string;
  hasFreeReportUsed: boolean;
  onSelectReport: (reportType: 'snapshot' | 'refresh' | 'performance' | 'growth') => void;
}

// Report card configuration
interface Report {
  id: string;
  title: string;
  type: 'free' | 'paid' | 'premium';
  credits: string | null;
  hook: string;
  icon: React.ReactNode;
  visual: React.ReactNode;
  values: string[];
  ctas: { label: string; action: string }[];
  badge: string;
  highlight: boolean;
  show: boolean;
}

export default function ReportGenerationModal({
  isOpen,
  onClose,
  reportName,
  hasFreeReportUsed,
  onSelectReport,
}: ReportGenerationModalProps) {
  const [selectedTier, setSelectedTier] = useState<string | null>(null);

  if (!isOpen) return null;

  // Define all 4 report cards
  const reports: Report[] = [
    // CARD 1: FREE Digital Authority Snapshot
    {
      id: 'snapshot',
      title: 'Digital Authority Snapshot',
      type: 'free',
      credits: null,
      hook: 'Do you actually know how strong your digital presence is?',
      icon: '📊',
      visual: (
        <div className="flex justify-center mb-6">
          <div className="relative w-32 h-32 rounded-full bg-gradient-to-br from-green-100 to-green-50 border-4 border-green-200 flex items-center justify-center shadow-md">
            <div className="text-center">
              <div className="text-3xl font-bold text-green-700">?</div>
              <div className="text-xs text-green-600 mt-1">Score locked</div>
            </div>
          </div>
        </div>
      ),
      values: [
        'See how visible you are in your market',
        'Identify gaps in content and authority',
        'Understand where you stand vs competitors',
      ],
      ctas: [{ label: 'Generate Report', action: 'snapshot' }],
      badge: '🟢 Free for First Use',
      highlight: !hasFreeReportUsed, // Highlight if free hasn't been used
      show: !hasFreeReportUsed, // Only show if not used
    },
    // CARD 2: PAID Digital Authority Snapshot Refresh
    {
      id: 'refresh',
      title: 'Digital Authority Snapshot',
      type: 'paid',
      credits: '20–40',
      hook: 'Your last snapshot is outdated — do you know what\'s changed?',
      icon: '📊',
      visual: (
        <div className="flex justify-center mb-6">
          <div className="flex flex-col items-center gap-2">
            <div className="text-4xl">📈</div>
            <div className="text-xs text-blue-600 font-semibold">Trend since last report</div>
          </div>
        </div>
      ),
      values: [
        'Track changes in your visibility',
        'See new gaps and missed opportunities',
        'Stay aligned with market shifts',
      ],
      ctas: [
        { label: 'View Report', action: 'refresh' },
        { label: 'Generate Fresh Snapshot', action: 'refresh' },
      ],
      badge: '💳 20–40 Credits',
      highlight: false,
      show: hasFreeReportUsed, // Only show if free has been used
    },
    // CARD 3: Performance Intelligence Report
    {
      id: 'performance',
      title: 'Performance Intelligence Report',
      type: 'paid',
      credits: '40–80',
      hook: 'You\'re getting traffic — but do you know what\'s actually working?',
      icon: '📈',
      visual: (
        <div className="flex justify-center mb-6">
          <div className="flex flex-col items-center gap-2">
            <div className="text-4xl">⤵️</div>
            <div className="text-xs text-purple-600 font-semibold">Funnel analysis</div>
          </div>
        </div>
      ),
      values: [
        'Identify where users drop off',
        'Understand what drives conversions',
        'Uncover hidden performance leaks',
      ],
      ctas: [{ label: 'Generate Report', action: 'performance' }],
      badge: '💳 40–80 Credits',
      highlight: false,
      show: true,
    },
    // CARD 4: Market & Growth Intelligence Report
    {
      id: 'growth',
      title: 'Market & Growth Intelligence Report',
      type: 'premium',
      credits: '80–150',
      hook: 'Know exactly where to invest, what to fix, and how to outgrow your competition.',
      icon: '🎯',
      visual: (
        <div className="flex justify-center mb-6">
          <div className="flex flex-col items-center gap-2">
            <div className="text-4xl">📍</div>
            <div className="text-xs text-red-600 font-semibold">Competitive positioning</div>
          </div>
        </div>
      ),
      values: [
        'Benchmark against competitors',
        'Get budget and campaign direction',
        'Identify growth opportunities across channels',
      ],
      ctas: [{ label: 'Generate Report', action: 'growth' }],
      badge: '👑 80–150 Credits',
      highlight: hasFreeReportUsed, // Highlight if free has been used
      show: true,
    },
  ];

  const visibleReports = reports.filter((r) => r.show);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-purple-600 px-8 py-6 flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-bold text-white">Intelligence Reports</h2>
              <p className="text-white/80 text-sm mt-1">Choose the insights you need</p>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:bg-white/20 p-2 rounded-lg transition-colors"
            >
              <X size={24} />
            </button>
          </div>

          {/* Content */}
          <div className="px-8 py-8">
            {/* Cards Grid - 2x2 Layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {visibleReports.map((report) => (
                <div
                  key={report.id}
                  onClick={() => {
                    setSelectedTier(report.id);
                    onSelectReport(report.id as any);
                  }}
                  className={`relative rounded-xl border-2 p-6 cursor-pointer transition-all transform hover:scale-102 ${
                    report.highlight
                      ? 'min-h-[520px] border-blue-600 bg-gradient-to-br from-blue-50 to-white shadow-lg ring-2 ring-blue-200 md:col-span-2'
                      : 'border-gray-200 bg-white hover:border-gray-400 hover:shadow-md'
                  } ${selectedTier === report.id ? 'ring-2 ring-blue-500' : ''}`}
                >
                  {/* Badge - Top Right */}
                  <div className="absolute -top-3 right-6 bg-gradient-to-r from-blue-600 to-blue-700 text-white px-3 py-1 rounded-full text-xs font-bold shadow-md">
                    {report.badge}
                  </div>

                  {/* Icon + Title */}
                  <div className="mb-4">
                    <div className="text-5xl mb-3">{report.icon}</div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">{report.title}</h3>
                  </div>

                  {/* Hook - The compelling question */}
                  <p className="text-sm font-semibold text-blue-700 italic mb-5">{report.hook}</p>

                  {/* Visual Element */}
                  <div className="my-6 py-4 border-y border-gray-100">
                    {report.visual}
                  </div>

                  {/* Value Bullets */}
                  <div className="space-y-2 mb-6">
                    {report.values.map((value, idx) => (
                      <div key={idx} className="flex gap-3">
                        <span className={`text-lg font-bold flex-shrink-0 ${
                          report.type === 'free' ? 'text-green-600' :
                          report.type === 'premium' ? 'text-red-600' :
                          'text-blue-600'
                        }`}>
                          ✓
                        </span>
                        <span className="text-sm text-gray-700">{value}</span>
                      </div>
                    ))}
                  </div>

                  {/* Credits Info */}
                  {report.credits && (
                    <div className={`mb-6 p-3 rounded-lg border ${
                      report.type === 'premium'
                        ? 'bg-red-50 border-red-200'
                        : 'bg-blue-50 border-blue-200'
                    }`}>
                      <p className={`text-xs font-semibold ${
                        report.type === 'premium' ? 'text-red-700' : 'text-blue-700'
                      }`}>
                        💳 {report.credits} credits
                      </p>
                      <p className="text-xs text-gray-600 mt-1">ⓘ Based on analysis depth and integrations</p>
                    </div>
                  )}

                  {/* CTAs */}
                  <div className={`mt-auto space-y-3 ${report.highlight ? 'pt-3' : ''}`}>
                    {report.ctas.map((cta, idx) => (
                      <button
                        key={idx}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTier(report.id);
                          onSelectReport(report.id as any);
                        }}
                        className={`w-full px-4 py-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 group ${
                          idx === 0
                            ? `text-white ${
                                report.type === 'free'
                                  ? 'bg-green-600 hover:bg-green-700 shadow-md'
                                  : report.type === 'premium'
                                    ? 'bg-red-600 hover:bg-red-700 shadow-md'
                                    : 'bg-blue-600 hover:bg-blue-700 shadow-md'
                              }`
                            : 'text-gray-700 bg-gray-100 hover:bg-gray-200 border border-gray-300'
                        }`}
                      >
                        {cta.label}
                        <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer Info */}
            <div className="mt-8 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-xs text-gray-600">
                <strong>Credits:</strong> Cost varies based on website size, depth of analysis, integrations, and region.{' '}
                <button className="text-blue-600 hover:underline">Learn more →</button>
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

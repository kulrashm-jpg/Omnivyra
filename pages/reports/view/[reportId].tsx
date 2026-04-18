import Head from 'next/head';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Download, RefreshCw } from 'lucide-react';
import { getAuthToken } from '@/utils/getAuthToken';
import {
  type ReportData,
  getFilenameFromContentDisposition,
} from './reportView.types';
import ReportPageContent from '@/components/reports/view/ReportPageContent';

export default function ReportViewPage() {
  const router = useRouter();
  const { reportId, type } = router.query;

  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [snapshotHtmlMarkup, setSnapshotHtmlMarkup] = useState<string | null>(null);
  const [snapshotHtmlStyles, setSnapshotHtmlStyles] = useState<string>('');
  const [snapshotHtmlLoading, setSnapshotHtmlLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [generationMessage, setGenerationMessage] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [activeSection, setActiveSection] = useState('summary');

  useEffect(() => {
    if (!router.isReady || !reportId) return;

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const maxAttempts = 24;

    async function fetchReport() {
      try {
        const token = await getAuthToken().catch(() => null);
        const res = await fetch(`/api/reports/${reportId}?type=${type ?? 'snapshot'}`, {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (cancelled) return;

        if (res.status === 401) {
          setFetchError('Your session expired. Please sign in again to load this report.');
          setIsGenerating(false);
          return;
        }

        if (!res.ok) {
          setFetchError('Failed to load report. Please try again.');
          setIsGenerating(false);
          return;
        }

        const data: ReportData = await res.json();

        if (data.status === 'generating') {
          setGenerationMessage(
            attempts >= maxAttempts
              ? 'This report is taking longer than usual. We are still processing it for you.'
              : null,
          );
          if (attempts < maxAttempts) {
            attempts += 1;
          }
          pollTimer = setTimeout(fetchReport, 5000);
          return;
        }

        setGenerationMessage(null);
        setReportData(data);
        if (data.reportType === 'snapshot') {
          setSnapshotHtmlLoading(true);
          setSnapshotHtmlMarkup(null);
          setSnapshotHtmlStyles('');
          try {
            const htmlRes = await fetch(
              `/api/reports/${reportId}?type=${data.reportType}&format=html`,
              {
                credentials: 'include',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
              },
            );
            if (!cancelled && htmlRes.ok) {
              const rawHtml = await htmlRes.text();
              const styleMatch = rawHtml.match(/<style>([\s\S]*?)<\/style>/i);
              const pageMatch = rawHtml.match(/<div class="report-page">([\s\S]*?)<\/div>\s*<\/body>/i);
              setSnapshotHtmlStyles(styleMatch?.[1] ?? '');
              setSnapshotHtmlMarkup(pageMatch?.[1] ?? rawHtml);
            }
          } catch {
            if (!cancelled) {
              setSnapshotHtmlMarkup(null);
              setSnapshotHtmlStyles('');
            }
          } finally {
            if (!cancelled) {
              setSnapshotHtmlLoading(false);
            }
          }
        } else {
          setSnapshotHtmlMarkup(null);
          setSnapshotHtmlStyles('');
          setSnapshotHtmlLoading(false);
        }
        setIsGenerating(false);
      } catch {
        if (!cancelled) {
          setFetchError('Could not connect to report service.');
          setIsGenerating(false);
        }
      }
    }

    fetchReport();
    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
    };
  }, [router.isReady, reportId, type]);

  const handleDownloadPDF = async () => {
    if (typeof window === 'undefined' || !reportData) return;

    setIsDownloading(true);
    try {
      const token = await getAuthToken().catch(() => null);
      const res = await fetch(
        `/api/reports/${reportData.reportId}?type=${reportData.reportType}&format=pdf`,
        {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );

      if (!res.ok) {
        throw new Error('Failed to generate PDF export.');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const serverFilename = getFilenameFromContentDisposition(
        res.headers.get('Content-Disposition'),
      );
      const safeDomain = reportData.domain.replace(/[^a-z0-9.-]+/gi, '-');
      const fallbackFilename =
        reportData.reportType === 'snapshot'
          ? `Digital Snapshot - ${safeDomain}.pdf`
          : reportData.reportType === 'performance'
            ? `Performance Report - ${safeDomain}.pdf`
            : `Growth Report - ${safeDomain}.pdf`;
      link.href = url;
      link.download = serverFilename || fallbackFilename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : 'Failed to download PDF.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleRegenerate = async () => {
    if (!reportData) return;

    setIsRegenerating(true);
    setFetchError(null);

    try {
      const token = await getAuthToken().catch(() => null);
      const reportCategory =
        reportData.reportType === 'growth'
          ? 'growth'
          : reportData.reportType === 'performance'
            ? 'performance'
            : 'snapshot';

      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          companyId: reportData.companyId,
          domain: reportData.domain,
          type: 'premium',
          reportCategory,
          generationContext: {
            source: 'report-regenerate',
            previousReportId: reportData.reportId,
            detailLevel: 'enhanced',
          },
        }),
      });

      const data = (await res.json().catch(() => ({}))) as { reportId?: string; error?: string };
      if (!res.ok || !data.reportId) {
        throw new Error(data.error || 'Failed to regenerate report');
      }

      await router.push(`/reports/view/${data.reportId}?type=${reportData.reportType}`);
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : 'Failed to regenerate report.');
    } finally {
      setIsRegenerating(false);
    }
  };

  if (isGenerating) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="mx-auto mb-6 w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Generating Your Report</h2>
          <p className="text-gray-600 mb-2">Our AI is analysing your data and composing insights.</p>
          <p className="text-sm text-gray-400">This usually takes 2-5 minutes. You can safely close this tab.</p>
          {generationMessage ? (
            <p className="mt-3 text-sm text-amber-600">{generationMessage}</p>
          ) : null}
        </div>
      </div>
    );
  }

  if (fetchError || !reportData) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Report Unavailable</h2>
          <p className="text-gray-600 mb-6">{fetchError ?? 'No report data found.'}</p>
          <button
            onClick={() => router.push('/reports')}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            Back to Reports
          </button>
        </div>
      </div>
    );
  }

  if (reportData.reportType === 'snapshot') {
    return (
      <>
        <Head>
          <title>
            {(reportData.companyContext?.companyName || reportData.domain)} - {reportData.title}
          </title>
          <meta name="robots" content="noindex" />
          {snapshotHtmlStyles ? (
            <style>{`
              .snapshot-report-shell {
                min-height: 100vh;
                background: #F0F3F7;
              }

              .snapshot-report-frame {
                width: 100%;
                overflow-x: auto;
              }

              .snapshot-report-frame .report-page {
                width: 100%;
                max-width: 100%;
                padding: 0;
              }

              .snapshot-report-frame #pdf-report {
                width: 100%;
                max-width: 1180px;
                margin: 0 auto;
              }

              .snapshot-report-frame #completed-report {
                margin-bottom: 24px;
              }

              .snapshot-report-frame #incomplete-report {
                opacity: 0.85;
              }
            `}</style>
          ) : null}
          {snapshotHtmlStyles ? <style>{snapshotHtmlStyles}</style> : null}
        </Head>

        <div className="snapshot-report-shell">
          {/* ── McKinsey-style report header ── */}
          <div className="border-b-2 border-[#051C2C] bg-white shadow-sm">
            <div className="mx-auto max-w-6xl px-6 py-5">
              {/* Top bar: kicker + actions */}
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8C9DAB]">
                  Digital Authority Snapshot
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleDownloadPDF}
                    disabled={isDownloading}
                    className="inline-flex items-center gap-2 rounded border border-[#D4DDE6] bg-white px-4 py-2 text-sm font-semibold text-[#1A3A50] transition hover:bg-[#F5F7FA] disabled:opacity-50"
                  >
                    <Download size={16} />
                    <span>{isDownloading ? 'Downloading...' : 'Download PDF'}</span>
                  </button>
                  <button
                    onClick={handleRegenerate}
                    disabled={isRegenerating}
                    className="inline-flex items-center gap-2 rounded bg-[#0077B6] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#005f8f] disabled:opacity-50"
                  >
                    <RefreshCw size={16} />
                    <span>{isRegenerating ? 'Regenerating...' : 'Regenerate'}</span>
                  </button>
                </div>
              </div>

              {/* Company identity row */}
              <div className="flex items-start gap-6 mb-4">
                {/* Score circle */}
                <div className="flex-shrink-0 flex flex-col items-center">
                  <div className="relative w-[72px] h-[72px]">
                    <svg width="72" height="72" viewBox="0 0 72 72">
                      <circle cx="36" cy="36" r="30" fill="none" stroke="#E8EFF6" strokeWidth="6" />
                      <circle
                        cx="36" cy="36" r="30" fill="none"
                        stroke={reportData.overallScore >= 50 ? '#1B7340' : reportData.overallScore >= 30 ? '#B45309' : '#991B1B'}
                        strokeWidth="6"
                        strokeDasharray={`${2 * Math.PI * 30}`}
                        strokeDashoffset={`${2 * Math.PI * 30 - (Math.min(100, reportData.overallScore) / 100) * 2 * Math.PI * 30}`}
                        strokeLinecap="round"
                        transform="rotate(-90 36 36)"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="font-serif text-2xl font-bold text-[#051C2C]">{reportData.overallScore}</span>
                    </div>
                  </div>
                  <span className="mt-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#8C9DAB]">Score</span>
                </div>
                {/* Company info */}
                <div className="flex-1">
                  <h1 className="font-serif text-2xl font-bold text-[#051C2C] leading-tight">
                    {reportData.companyContext?.companyName || reportData.domain}
                  </h1>
                  <p className="mt-0.5 text-sm text-[#4A6274]">{reportData.domain}</p>
                  <div className="mt-2 flex gap-2 flex-wrap">
                    <span className="inline-flex text-[10px] font-bold uppercase tracking-[0.08em] px-2.5 py-1 rounded bg-[#FEF4E4] text-[#B45309]">
                      {reportData.overallScore <= 44 ? 'Early-Stage' : reportData.overallScore <= 74 ? 'Growing' : 'Leader'}
                    </span>
                    <span className="inline-flex text-[10px] font-bold uppercase tracking-[0.08em] px-2.5 py-1 rounded bg-[#E6F4EC] text-[#1B7340]">
                      {reportData.confidenceSource ? 'Medium Confidence' : 'Assessed'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Metric cards row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded border border-[#D4DDE6] bg-[#F5F7FA] px-4 py-3">
                  <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#8C9DAB] mb-1">Overall Score</p>
                  <p className="font-serif text-xl font-bold text-[#051C2C]">{reportData.overallScore}<span className="text-sm font-normal text-[#8C9DAB]">/100</span></p>
                </div>
                <div className="rounded border border-[#D4DDE6] bg-[#F5F7FA] px-4 py-3">
                  <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#8C9DAB] mb-1">Primary Diagnosis</p>
                  <p className="text-xs font-medium text-[#1A3A50] leading-snug line-clamp-3">{reportData.diagnosis}</p>
                </div>
                <div className="rounded border border-[#D4DDE6] bg-[#F5F7FA] px-4 py-3">
                  <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#8C9DAB] mb-1">Confidence</p>
                  <p className="text-xs font-medium text-[#1A3A50] leading-snug line-clamp-3">{reportData.confidenceSource || 'Composed from available intelligence sections.'}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
            {fetchError ? (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {fetchError}
              </div>
            ) : null}

            {snapshotHtmlLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                <div className="mb-4 h-6 w-48 animate-pulse rounded bg-slate-200" />
                <div className="space-y-3">
                  <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
                  <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
                  <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
                </div>
              </div>
            ) : snapshotHtmlMarkup ? (
              <div className="snapshot-report-frame rounded-3xl border border-slate-200 bg-white/70 p-3 shadow-sm sm:p-5">
                <div dangerouslySetInnerHTML={{ __html: `<div class="report-page">${snapshotHtmlMarkup}</div>` }} />
              </div>
            ) : (
              <ReportPageContent
                reportData={reportData}
                fetchError={fetchError}
                isDownloading={isDownloading}
                isRegenerating={isRegenerating}
                activeSection={activeSection}
                setActiveSection={setActiveSection}
                onDownloadPDF={handleDownloadPDF}
                onRegenerate={handleRegenerate}
              />
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>
          {(reportData.companyContext?.companyName || reportData.domain)} - {reportData.title}
        </title>
        <meta name="robots" content="noindex" />
      </Head>

      <ReportPageContent
        reportData={reportData}
        fetchError={fetchError}
        isDownloading={isDownloading}
        isRegenerating={isRegenerating}
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        onDownloadPDF={handleDownloadPDF}
        onRegenerate={handleRegenerate}
      />
    </>
  );
}

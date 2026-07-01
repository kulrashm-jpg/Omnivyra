import Head from 'next/head';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { apiFetch } from '@/lib/apiFetch';
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
  const [performanceHtmlDocument, setPerformanceHtmlDocument] = useState<string | null>(null);
  const [performanceHtmlLoading, setPerformanceHtmlLoading] = useState(false);
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
        const res = await apiFetch(`/api/reports/${reportId}?type=${type ?? 'snapshot'}`);

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
          setPerformanceHtmlDocument(null);
          setPerformanceHtmlLoading(false);
          try {
            const htmlRes = await apiFetch(
              `/api/reports/${reportId}?type=${data.reportType}&format=html`,
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
        } else if (data.reportType === 'performance') {
          setPerformanceHtmlLoading(true);
          setPerformanceHtmlDocument(null);
          setSnapshotHtmlMarkup(null);
          setSnapshotHtmlStyles('');
          setSnapshotHtmlLoading(false);
          try {
            const htmlRes = await apiFetch(
              `/api/reports/${reportId}?type=performance&format=html`,
            );
            if (!cancelled && htmlRes.ok) {
              setPerformanceHtmlDocument(await htmlRes.text());
            }
          } catch {
            if (!cancelled) {
              setPerformanceHtmlDocument(null);
            }
          } finally {
            if (!cancelled) {
              setPerformanceHtmlLoading(false);
            }
          }
        } else {
          setSnapshotHtmlMarkup(null);
          setSnapshotHtmlStyles('');
          setSnapshotHtmlLoading(false);
          setPerformanceHtmlDocument(null);
          setPerformanceHtmlLoading(false);
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
      const res = await apiFetch(
        `/api/reports/${reportData.reportId}?type=${reportData.reportType}&format=pdf`,
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
      // A download hiccup must NOT replace the whole report view (was setFetchError →
      // full-page "Report Unavailable"). Surface it inline; the report stays visible.
      alert(error instanceof Error ? error.message : 'Failed to download PDF. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleRegenerate = async () => {
    if (!reportData) return;

    setIsRegenerating(true);
    setFetchError(null);

    try {
      const reportCategory =
        reportData.reportType === 'growth'
          ? 'growth'
          : reportData.reportType === 'performance'
            ? 'performance'
            : 'snapshot';

      const res = await apiFetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
            <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Report Actions
                </p>
                <h1 className="mt-1 text-xl font-semibold text-slate-900">
                  {reportData.title}
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  Download the latest PDF snapshot or regenerate this report with fresh data.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleDownloadPDF}
                  disabled={isDownloading}
                  className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isDownloading ? 'Preparing PDF…' : 'Download PDF'}
                </button>
                <button
                  onClick={handleRegenerate}
                  disabled={isRegenerating}
                  className="inline-flex items-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRegenerating ? 'Regenerating…' : 'Regenerate'}
                </button>
              </div>
            </div>

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
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800 shadow-sm">
                <div className="font-semibold text-amber-900">Snapshot HTML unavailable</div>
                <p className="mt-1">
                  The new snapshot report could not be rendered right now, so the page is not
                  falling back to the old template. Please regenerate the report or refresh after a
                  moment.
                </p>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  if (reportData.reportType === 'performance') {
    return (
      <>
        <Head>
          <title>
            {(reportData.companyContext?.companyName || reportData.domain)} - {reportData.title || 'Performance Intelligence Report'}
          </title>
          <meta name="robots" content="noindex" />
        </Head>

        <div className="min-h-screen bg-slate-950">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
            <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/95 px-4 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">
                  Performance Intelligence
                </p>
                <h1 className="mt-1 text-xl font-semibold text-white">
                  {reportData.title || 'Performance Intelligence Report'}
                </h1>
                <p className="mt-1 text-sm text-slate-300">
                  Review the interactive HTML report first. PDF export is available separately.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleDownloadPDF}
                  disabled={isDownloading}
                  className="inline-flex items-center rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-sky-400 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isDownloading ? 'Preparing PDF...' : 'Export PDF'}
                </button>
                <button
                  onClick={handleRegenerate}
                  disabled={isRegenerating}
                  className="inline-flex items-center rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRegenerating ? 'Regenerating...' : 'Regenerate'}
                </button>
              </div>
            </div>

            {fetchError ? (
              <div className="mb-4 rounded-lg border border-red-900/70 bg-red-950 px-4 py-3 text-sm text-red-100">
                {fetchError}
              </div>
            ) : null}

            {performanceHtmlLoading ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-sm">
                <div className="mb-4 h-6 w-56 animate-pulse rounded bg-slate-800" />
                <div className="space-y-3">
                  <div className="h-28 animate-pulse rounded-xl bg-slate-800" />
                  <div className="h-28 animate-pulse rounded-xl bg-slate-800" />
                  <div className="h-28 animate-pulse rounded-xl bg-slate-800" />
                </div>
              </div>
            ) : performanceHtmlDocument ? (
              <iframe
                title="Performance Intelligence Report"
                srcDoc={performanceHtmlDocument}
                className="h-[calc(100vh-140px)] min-h-[720px] w-full rounded-3xl border border-slate-800 bg-white shadow-2xl"
              />
            ) : (
              <div className="rounded-2xl border border-amber-700 bg-amber-950 px-5 py-4 text-sm text-amber-100 shadow-sm">
                <div className="font-semibold text-amber-50">Performance HTML unavailable</div>
                <p className="mt-1">
                  The report completed, but the interactive HTML view could not be loaded. PDF export
                  remains separate, so refresh this page or regenerate the report if the HTML does not
                  appear after a moment.
                </p>
              </div>
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

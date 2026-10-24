import Head from 'next/head';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { apiFetch } from '@/lib/apiFetch';
import {
  type ReportData,
  getFilenameFromContentDisposition,
} from './reportView.types';
import ReportPageContent from '@/components/reports/view/ReportPageContent';
import PublicAdvertisingSection from '@/components/reports/advertising/PublicAdvertisingSection';
import { sanitizeHtml } from '@/lib/security/htmlSanitizer';
import { fetchSnapshotHtml, resolveRegenerateOutcome } from '@/lib/reports/snapshotViewClient';

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
  // Regenerate failures are shown inline: routing them through `fetchError`
  // replaced the whole loaded report with the full-page "Report Unavailable".
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState('summary');
  const regenerateInFlight = useRef(false);
  const htmlLoadSeq = useRef(0);

  // The snapshot HTML is a second request after the JSON payload. It is retried
  // on transient failures (fetchSnapshotHtml) and can be retried by hand from
  // the "unavailable" panel without reloading the page.
  const loadSnapshotHtml = useCallback(async (id: string, reportType: string) => {
    const seq = ++htmlLoadSeq.current;
    const stale = () => seq !== htmlLoadSeq.current;
    setSnapshotHtmlLoading(true);
    setSnapshotHtmlMarkup(null);
    setSnapshotHtmlStyles('');
    const result = await fetchSnapshotHtml(
      (url) => apiFetch(url),
      `/api/reports/${id}?type=${reportType}&format=html`,
      { isCancelled: stale },
    );
    if (stale()) return;
    if (result.ok) {
      setSnapshotHtmlStyles(result.html.styles);
      setSnapshotHtmlMarkup(result.html.markup);
    }
    setSnapshotHtmlLoading(false);
  }, []);

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
          setPerformanceHtmlDocument(null);
          setPerformanceHtmlLoading(false);
          await loadSnapshotHtml(String(reportId), data.reportType);
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
      htmlLoadSeq.current += 1; // drop any in-flight snapshot HTML load
      clearTimeout(pollTimer);
    };
  }, [router.isReady, reportId, type, loadSnapshotHtml]);

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
    // Synchronous guard: `isRegenerating` only disables the button after a
    // re-render, so a fast double click could send two generate requests.
    if (regenerateInFlight.current) return;
    regenerateInFlight.current = true;

    setIsRegenerating(true);
    setRegenerateError(null);

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

      const data = (await res.json().catch(() => ({}))) as {
        reportId?: string;
        error?: string;
        code?: string;
      };
      // A 409 REPORT_IN_PROGRESS names the report already running for this
      // domain: open it (its view polls and shows progress) instead of
      // dead-ending on "Report already in progress".
      const outcome = resolveRegenerateOutcome(res, data, reportData.reportId);
      if (outcome.kind === 'error') {
        throw new Error(outcome.message);
      }

      await router.push(`/reports/view/${outcome.reportId}?type=${reportData.reportType}`);
    } catch (error) {
      setRegenerateError(error instanceof Error ? error.message : 'Failed to regenerate report.');
    } finally {
      regenerateInFlight.current = false;
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

            {regenerateError ? (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {regenerateError}
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
                {/* HARDEN-003: the snapshot is system-generated but embeds AI
                    text — 'document' profile keeps its layout CSS while
                    stripping anything executable before it joins OUR origin. */}
                <div dangerouslySetInnerHTML={{ __html: `<div class="report-page">${sanitizeHtml(snapshotHtmlMarkup, 'document')}</div>` }} />
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800 shadow-sm">
                  <div className="font-semibold text-amber-900">Snapshot HTML unavailable</div>
                  <p className="mt-1">
                    The report is saved, but its page could not be loaded just now (the connection
                    dropped or the server did not answer in time). Try again; regenerating is not
                    needed.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button
                      onClick={() => void loadSnapshotHtml(reportData.reportId, reportData.reportType)}
                      className="inline-flex items-center rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-700"
                    >
                      Try again
                    </button>
                    <button
                      onClick={handleDownloadPDF}
                      disabled={isDownloading}
                      className="inline-flex items-center rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isDownloading ? 'Preparing PDF…' : 'Download PDF instead'}
                    </button>
                  </div>
                </div>
                {/* WP-9 — the Report 1 snapshot is normally shown as the server-rendered export
                    embedded above, which already carries the public-advertising section. It is
                    deliberately NOT repeated beside that embed: one report, one statement of the
                    evidence. This React rendering stands in only when the embed could not be
                    fetched, so the advertising evidence the JSON payload already carries does not
                    vanish with it. It renders nothing at all when there is no observation. */}
                <PublicAdvertisingSection
                  advertising={reportData.advertising}
                  className="print-section mt-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                />
              </>
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

            {regenerateError ? (
              <div className="mb-4 rounded-lg border border-red-900/70 bg-red-950 px-4 py-3 text-sm text-red-100">
                {regenerateError}
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
                // HARDEN-003: the report document is static HTML/CSS — the
                // sandbox (no allow-scripts) makes any script that reached the
                // stored document inert while styles/images/links still work.
                sandbox="allow-popups allow-popups-to-escape-sandbox"
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
        fetchError={regenerateError}
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

import { escapeHtml } from './reportHtmlCoreUtils';

export function renderSnapshotMasterDocument(input: {
  companyName: string;
  completedMarkup: string;
  incompleteMarkup: string;
}): string {
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(input.companyName)} Digital Authority Snapshot</title>
    <style>
      /* ── Page & Print ─────────────────────────────────────── */
      @page { size: A4; margin: 10mm 12mm 12mm 12mm; }
      @media print {
        body { background: #fff !important; }
        .report-page { padding: 0 !important; width: 100% !important; max-width: 100% !important; }
        #pdf-report { width: 100% !important; max-width: 100% !important; }
        .report-section { box-shadow: none !important; border: 1px solid #D9E2EE !important; }
        .group-header { box-shadow: none !important; backdrop-filter: none !important; }
        .no-print { display: none !important; }
      }

      /* ── Reset & Foundation ───────────────────────────────── */
      * { box-sizing: border-box; margin: 0; padding: 0; }
      :root {
        /* McKinsey-inspired palette */
        --ink-strong: #051C2C;
        --ink: #1A3A50;
        --muted: #4A6274;
        --faint: #8C9DAB;
        --line: #D4DDE6;
        --line-strong: #B8C7D4;
        --paper: #FFFFFF;
        --surface: #F5F7FA;
        --surface-warm: #FAFBFC;
        --navy: #051C2C;
        --navy-soft: #E8EFF6;
        --blue: #0077B6;
        --blue-soft: #E3F0FA;
        --blue-accent: #0A5E91;
        --green: #1B7340;
        --green-soft: #E6F4EC;
        --amber: #B45309;
        --amber-soft: #FEF4E4;
        --red: #991B1B;
        --red-soft: #FEF1EF;
        --red-accent: #7F1D1D;
        --score-circle-bg: #E8EFF6;
        --score-circle-fill: #0077B6;
      }

      /* ── Typography — McKinsey-aligned ────────────────────── */
      body {
        font-family: 'Helvetica Neue', Helvetica, Arial, 'Segoe UI', sans-serif;
        font-size: 11.5px;
        line-height: 1.52;
        color: var(--ink-strong);
        background: #F0F3F7;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
      }
      h1 {
        font-family: Georgia, 'Times New Roman', 'Noto Serif', serif;
        font-size: 22px;
        font-weight: 700;
        color: var(--navy);
        margin-bottom: 6px;
        line-height: 1.15;
        letter-spacing: -0.025em;
      }
      h2 {
        font-family: Georgia, 'Times New Roman', 'Noto Serif', serif;
        font-size: 16px;
        font-weight: 700;
        color: var(--navy);
        margin-bottom: 6px;
        line-height: 1.2;
        letter-spacing: -0.015em;
      }
      h3 {
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 13px;
        font-weight: 700;
        color: var(--ink);
        margin-bottom: 6px;
        line-height: 1.3;
        letter-spacing: 0;
      }
      h4 {
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 12px;
        font-weight: 700;
        color: var(--ink);
        margin-bottom: 4px;
        letter-spacing: 0.01em;
      }
      p {
        line-height: 1.48;
        color: var(--muted);
        margin-bottom: 4px;
        text-align: left;
        orphans: 3;
        widows: 3;
      }
      p:last-child { margin-bottom: 0; }
      strong { color: var(--ink-strong); font-weight: 700; }
      em { color: var(--muted); font-style: italic; }
      ul, ol { color: var(--muted); line-height: 1.58; padding-left: 18px; margin-bottom: 6px; }
      li { margin-bottom: 3px; }
      hr.divider { border: none; border-top: 1px solid var(--line); margin: 12px 0; }

      /* ── Labels & Kickers (small caps) ────────────────────── */
      .label {
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 10px;
        font-weight: 700;
        color: var(--faint);
        letter-spacing: 0.14em;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      .group-kicker {
        font-size: 10px;
        font-weight: 700;
        color: var(--faint);
        letter-spacing: 0.14em;
        text-transform: uppercase;
        margin-bottom: 4px;
      }

      /* ── Layout ────────────────────────────────────────────── */
      .report-page { width: 210mm; max-width: 100%; margin: 0 auto; padding: 8px 6px; }
      #pdf-report { width: 100%; max-width: 196mm; margin: 0 auto; }

      /* ── Report Groups ────────────────────────────────────── */
      .report-group { margin-bottom: 14px; }
      .report-group-complete .group-header {
        border-color: #B8C7D4;
        background: var(--paper);
      }
      .group-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
        padding: 14px 16px;
        border: 1px solid var(--line);
        border-radius: 4px;
        background: var(--paper);
        margin-bottom: 10px;
        box-shadow: 0 1px 3px rgba(5, 28, 44, 0.06);
      }
      .group-header h2 { margin-bottom: 3px; }
      .group-header { break-after: avoid; page-break-after: avoid; }
      .group-header p { color: var(--muted); max-width: 680px; line-height: 1.45; font-size: 11.5px; }
      .group-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 80px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        border-radius: 3px;
        padding: 6px 10px;
      }
      .group-pill-complete { background: var(--green-soft); color: var(--green); }
      .group-pill-incomplete { background: var(--amber-soft); color: var(--amber); }

      /* ── Report Blocks ────────────────────────────────────── */
      .report-stack { display: grid; gap: 10px; }
      .completed-flow { display: grid; gap: 10px; width: 100%; }
      .narrative-group { display: grid; gap: 8px; width: 100%; }
      .narrative-flow-group { display: grid; gap: 8px; width: 100%; }
      /* Prevent section headings from being orphaned at page bottom */
      .section-heading-anchor {
        display: block;
        break-inside: avoid;
        page-break-inside: avoid;
        padding: 2px 0 0;
        margin-bottom: 4px;
      }
      .report-block {
        background: var(--paper);
        border: 1px solid var(--line);
        border-radius: 4px;
        padding: 14px 16px;
        box-shadow: 0 1px 3px rgba(5, 28, 44, 0.04);
        min-height: 0;
        height: auto;
      }
      .report-block-heading { background: transparent; border: none; box-shadow: none; padding: 4px 0 0; min-height: 0; }
      .report-block-subheading { background: var(--navy-soft); border-color: var(--line-strong); min-height: 0; }
      .report-block-compact { min-height: 0; padding: 10px 14px; }
      .report-block-hero { border: none; box-shadow: none; padding: 0; background: transparent; }
      .report-block-fill { border-style: dashed; border-color: var(--line); }
      /* keep-together only on small cards — NOT on large section wrappers */
      .keep-together { break-inside: avoid; page-break-inside: avoid; }
      /* no-break: only use on individual cards < ~200px tall, never on section wrappers */
      .card.no-break, article.no-break { break-inside: avoid; page-break-inside: avoid; }
      .report-block[data-type="action"] { padding: 0; border: none; box-shadow: none; background: transparent; min-height: 0; }
      .report-block[data-type="disclaimer"] { background: var(--surface); }
      .report-block[data-fill="true"] { border-style: dashed; }

      /* ── Pages & Print Headers ─────────────────────────────── */
      .pdf-page { display: grid; gap: 10px; margin-bottom: 10px; }
      .page-stack { display: grid; gap: 10px; }
      .page-print-header { display: none; }

      /* ── Report Sections ───────────────────────────────────── */
      .report-section {
        padding: 16px;
        border: 1px solid var(--line);
        border-radius: 4px;
        background: var(--paper);
        box-shadow: 0 1px 4px rgba(5, 28, 44, 0.05);
        min-height: auto;
        /* Do NOT use page-break-inside:avoid on sections — they span multiple pages */
      }
      .section-continue { padding-top: 8px; }
      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding-bottom: 10px;
        border-bottom: 2px solid var(--navy);
        margin-bottom: 14px;
        font-size: 10px;
        color: var(--faint);
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .section-header .company-name { font-weight: 700; color: var(--navy); }
      .section-header .report-title { color: var(--faint); }
      .section-header .report-date { color: var(--faint); }

      /* ── Cards ─────────────────────────────────────────────── */
      .card, .metric-card {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 4px;
        padding: 12px 14px;
        line-height: 1.45;
        height: auto;
      }
      .card-compact { padding: 10px 14px; }
      .card-accent-blue { border-left: 4px solid var(--blue); background: var(--blue-soft); }
      .card-accent-green { border-left: 4px solid var(--green); background: var(--green-soft); }
      .card-accent-amber { border-left: 4px solid var(--amber); background: var(--amber-soft); }
      .card-accent-red { border-left: 4px solid var(--red); background: var(--red-soft); }
      .card-pending { padding: 14px; border: 1px dashed var(--line); border-radius: 4px; color: var(--faint); font-style: italic; }
      .chart-card h3 { font-size: 12px; margin-bottom: 6px; }

      /* ── Grids ─────────────────────────────────────────────── */
      .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
      .grid-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
      .stack-10 { display: grid; gap: 8px; }
      .stack-12 { display: grid; gap: 10px; }
      .stats-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; text-align: center; }

      /* ── Scores ────────────────────────────────────────────── */
      .score-big { font-family: Georgia, 'Times New Roman', serif; font-size: 36px; font-weight: 700; color: var(--navy); line-height: 1; letter-spacing: -0.03em; }
      .score-med { font-family: Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: var(--navy); line-height: 1.1; }
      .score-missing { font-family: Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: var(--faint); line-height: 1.1; }
      .cover-score-big { font-size: 42px; }

      /* ── Score Circle (SVG donut) ──────────────────────────── */
      .score-circle-wrap { display: inline-flex; align-items: center; justify-content: center; position: relative; }
      .score-circle-wrap svg { display: block; }
      .score-circle-label { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-family: Georgia, serif; font-weight: 700; color: var(--navy); }
      .score-circle-label-lg { font-size: 28px; letter-spacing: -0.03em; }
      .score-circle-label-sm { font-size: 16px; }

      /* ── Bar Tracks ────────────────────────────────────────── */
      .bar-track { height: 6px; background: var(--line); border-radius: 3px; overflow: hidden; margin-top: 4px; }
      .bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s ease; }
      .bar-fill-green { background: var(--green); }
      .bar-fill-amber { background: var(--amber); }
      .bar-fill-red { background: var(--red); }
      .bar { height: 6px; background: var(--line); border-radius: 3px; overflow: hidden; }
      .bar span { display: block; height: 100%; border-radius: 3px; background: var(--blue); }

      /* ── Badges & Tags ─────────────────────────────────────── */
      .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
      .badge {
        display: inline-flex;
        align-items: center;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 4px 8px;
        border-radius: 3px;
        line-height: 1.2;
      }
      .badge-blue { background: var(--blue-soft); color: var(--blue-accent); }
      .badge-green { background: var(--green-soft); color: var(--green); }
      .badge-amber { background: var(--amber-soft); color: var(--amber); }
      .badge-red { background: var(--red-soft); color: var(--red); }
      .badge-gray { background: var(--surface); color: var(--faint); border: 1px solid var(--line); }
      .tag { display: inline-flex; align-items: center; font-size: 10px; font-weight: 600; padding: 3px 8px; border-radius: 3px; }
      .tag.impact { background: var(--blue-soft); color: var(--blue-accent); }
      .tag.effort { background: var(--surface); color: var(--muted); border: 1px solid var(--line); }

      /* ── Executive Insights ────────────────────────────────── */
      .executive-insights { display: grid; gap: 10px; }
      .insight-card {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 4px;
        padding: 10px 12px;
        line-height: 1.45;
        height: auto;
      }
      .insight-card.high-impact {
        border-left: 4px solid var(--red);
        background: var(--red-soft);
      }
      .insight-title { font-size: 13px; font-weight: 700; color: var(--ink-strong); margin-bottom: 4px; }
      .insight-impact { font-size: 11.5px; color: var(--muted); line-height: 1.5; }

      /* ── Before/After, Score Comparison ────────────────────── */
      .before-after { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      .before-after-col h4 { font-size: 12px; font-weight: 700; color: var(--ink); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.08em; }
      .before-after-col ul { padding-left: 16px; }
      .before-after-col li { margin-bottom: 4px; color: var(--muted); font-size: 12px; }
      .score-comparison { display: grid; gap: 8px; }
      .score-comparison-title { font-weight: 700; color: var(--ink); font-size: 13px; }
      .score-comparison-values { display: flex; gap: 20px; font-size: 12px; color: var(--muted); }
      .priority-engine { display: grid; gap: 10px; }

      /* ── Transformation Table ──────────────────────────────── */
      .transformation-table { width: 100%; border-collapse: collapse; page-break-inside: avoid; break-inside: avoid-page; }
      .transformation-table td { vertical-align: top; padding: 10px; }
      .transformation-table .arrow { width: 40px; text-align: center; font-weight: 700; color: var(--faint); font-size: 18px; }
      .state-card { border: 1px solid var(--line); border-radius: 4px; padding: 14px; background: var(--surface); page-break-inside: avoid; }
      .state-card.current { border-left: 4px solid var(--red); background: var(--red-soft); }
      .state-card.future { border-left: 4px solid var(--green); background: var(--green-soft); }

      /* ── Priority Cards ────────────────────────────────────── */
      .priority-card { border: 1px solid var(--line); border-radius: 4px; padding: 14px; background: var(--surface); }
      .priority-card.top-priority { border-left: 4px solid var(--blue); background: var(--blue-soft); }
      .priority-label { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); margin-bottom: 4px; }
      .priority-title { font-size: 14px; font-weight: 700; color: var(--ink-strong); margin-bottom: 4px; }
      .priority-meta { font-size: 12px; color: var(--muted); }

      /* ── Mini Metrics ──────────────────────────────────────── */
      .mini-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .mini-metric { padding: 10px 12px; background: var(--surface); border: 1px solid var(--line); border-radius: 4px; }
      .mini-metric span { display: block; font-size: 10px; font-weight: 700; color: var(--faint); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 2px; }
      .mini-metric strong { font-family: Georgia, serif; font-size: 18px; color: var(--navy); }
      .metric-grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }

      /* ── Metric Row Card ───────────────────────────────────── */
      .metric-row { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
      .metric-row-card { padding: 12px 14px; }
      .metric-row-card-label { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
      .metric-row-card-note p { font-size: 11px; color: var(--faint); margin-top: 4px; }
      .metric-meta { display: flex; justify-content: space-between; font-size: 10px; color: var(--faint); margin-top: 4px; letter-spacing: 0.02em; }

      /* ── Visual Metric Block ───────────────────────────────── */
      .visual-metric { padding: 14px; }
      .visual-metric .label { margin-bottom: 6px; }

      /* ── Callout Box ───────────────────────────────────────── */
      .callout-box {
        border: 1px solid var(--blue);
        background: var(--blue-soft);
        border-radius: 4px;
        padding: 12px 14px;
        color: var(--blue-accent);
        line-height: 1.5;
        font-size: 12px;
      }
      .inline-summary { color: var(--ink); line-height: 1.65; font-weight: 500; }

      /* ── Inline Disclaimers ────────────────────────────────── */
      .inline-disclaimer {
        padding: 10px 14px;
        border-radius: 4px;
        margin-bottom: 12px;
        font-size: 12px;
        line-height: 1.5;
      }
      .inline-disclaimer-missing { background: var(--amber-soft); border: 1px solid #E5C07B; }
      .inline-disclaimer-partial { background: var(--blue-soft); border: 1px solid #A3C9E8; }
      .inline-disclaimer p { color: var(--ink); margin: 0; }
      .inline-disclaimer .badge { margin-bottom: 6px; }

      /* ── Pending Note ──────────────────────────────────────── */
      .pending-note { font-size: 11px; color: var(--faint); font-style: italic; padding: 6px 0; }

      /* ── Fill Quote ────────────────────────────────────────── */
      .fill-quote { padding: 10px 14px; border-left: 3px solid var(--line); }
      .fill-quote blockquote { font-style: italic; color: var(--muted); font-size: 12px; margin: 4px 0; }

      /* ── Decomposition Rows ────────────────────────────────── */
      .decomposition-stack { display: grid; gap: 10px; }
      .decomposition-row { }
      .decomposition-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 3px; }
      .decomposition-head span { font-size: 12px; font-weight: 600; color: var(--ink); }
      .decomposition-head strong { font-family: Georgia, serif; font-size: 15px; color: var(--navy); }

      /* ── Action Cards ──────────────────────────────────────── */
      .action-card {
        background: var(--paper);
        border: 1px solid var(--line);
        border-radius: 4px;
        padding: 14px;
        margin-bottom: 8px;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .action-header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 8px; }
      .action-number {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: var(--navy);
        color: var(--paper);
        font-family: Georgia, serif;
        font-size: 14px;
        font-weight: 700;
        flex-shrink: 0;
      }
      .action-title { font-size: 14px; font-weight: 700; color: var(--ink-strong); line-height: 1.3; }
      .action-tags { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
      .action-body { margin-bottom: 8px; }
      .action-body p { font-size: 12px; margin-bottom: 4px; }
      .action-body .problem strong, .action-body .impact strong, .action-body .solution strong { font-size: 12px; }
      .tactics { padding-left: 18px; font-size: 12px; color: var(--muted); }
      .tactics li { margin-bottom: 3px; }

      /* ── Timeline ──────────────────────────────────────────── */
      .timeline { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 8px; }
      .timeline-item {
        padding: 8px 10px;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 4px;
        font-size: 11px;
        color: var(--muted);
        line-height: 1.4;
      }
      .timeline-item strong { display: block; font-size: 10px; font-weight: 700; color: var(--ink); margin-bottom: 2px; letter-spacing: 0.02em; }

      /* ── Funnel ────────────────────────────────────────────── */
      .funnel-row { display: grid; grid-template-columns: repeat(7, auto); gap: 0; align-items: center; justify-content: center; }
      .funnel-stage { text-align: center; padding: 12px 10px; background: var(--surface); border: 1px solid var(--line); border-radius: 4px; min-width: 90px; }
      .funnel-stage-missing { opacity: 0.5; border-style: dashed; }
      .funnel-arrow { text-align: center; color: var(--faint); font-size: 16px; padding: 0 4px; }

      /* ── Trajectory ────────────────────────────────────────── */
      .trajectory-graph { display: flex; gap: 14px; align-items: flex-end; justify-content: center; padding: 14px 0; }
      .trajectory-col { display: flex; flex-direction: column; align-items: center; gap: 4px; }
      .trajectory-bar-wrap { display: flex; align-items: flex-end; height: 100px; }
      .trajectory-bar { width: 44px; border-radius: 4px 4px 0 0; transition: height 0.3s ease; }
      .trajectory-bar.red { background: var(--red); }
      .trajectory-bar.yellow { background: var(--amber); }
      .trajectory-bar.green { background: var(--green); }
      .trajectory-bar.gray { background: var(--faint); }
      .traj-row { display: flex; align-items: center; justify-content: center; gap: 16px; padding: 14px 0; }
      .traj-step { text-align: center; }
      .traj-step .lbl { font-size: 10px; font-weight: 700; color: var(--faint); text-transform: uppercase; letter-spacing: 0.1em; }
      .traj-step .num { font-family: Georgia, serif; font-size: 28px; font-weight: 700; color: var(--navy); }
      .traj-arrow { color: var(--faint); font-size: 18px; font-weight: 700; }

      /* ── Cover Grid ────────────────────────────────────────── */
      .page-hero-cover { }
      .page-hero-header { margin-bottom: 10px; }
      .page-hero-date { color: var(--faint); }
      .page-hero-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .cover-score-panel { text-align: center; padding: 14px 12px; }
      .cover-score-circle { margin: 8px 0 8px; }
      .cover-url { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
      .cover-url-strong { font-weight: 600; color: var(--ink); }
      .cover-tags { justify-content: center; }
      .cover-tags-strong { }
      .cover-context-panel { padding: 14px; }
      .cover-action-panel { padding: 12px 14px; }
      .cover-explainer { margin-top: 10px; display: grid; gap: 8px; }
      .cover-explainer-block { padding: 10px 12px; border-radius: 4px; border: 1px solid var(--line); background: var(--paper); }
      .meaning-block { }
      .competition-block { border-left: 4px solid var(--red); background: var(--red-soft); }
      .why-read-block { background: var(--surface); }
      .cover-statement { font-size: 13px; font-weight: 500; color: var(--ink); margin-top: 8px; line-height: 1.5; }
      .cover-grid { display: grid; grid-template-columns: auto 1fr; gap: 16px; align-items: flex-start; }
      .cover-grid-top { margin-bottom: 14px; }
      .cover-score { text-align: center; padding: 16px 20px; }
      .cover-identity h1 { margin-bottom: 4px; }
      .cover-identity .cover-url { margin-bottom: 8px; }
      .cover-tags .badge { }
      .intro-block { padding: 14px; text-align: center; }

      /* ── Competitor Rows ────────────────────────────────────── */
      .comp-row { display: grid; grid-template-columns: 140px 1fr 120px; gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--line); }
      .comp-row:last-child { border-bottom: none; }
      .comp-label { font-size: 12px; font-weight: 600; color: var(--ink); }
      .comp-bars { display: flex; gap: 4px; height: 8px; }
      .comp-bar-user { background: var(--blue); height: 100%; border-radius: 3px; }
      .comp-bar-comp { background: var(--amber); height: 100%; border-radius: 3px; }
      .comp-val { font-size: 11px; color: var(--faint); text-align: right; }

      /* ── Data Source Cards ──────────────────────────────────── */
      .data-source-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 10px; }
      .data-source-card { padding: 12px; }
      .data-source-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
      .coverage-summary-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 10px 0; }
      .coverage-summary-item { text-align: center; padding: 10px; background: var(--surface); border: 1px solid var(--line); border-radius: 4px; }
      .section-intro { margin-bottom: 10px; }
      .section-intro p { font-size: 12px; color: var(--muted); }

      /* ── Backlink Section ───────────────────────────────────── */
      .backlink-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      .backlink-meta { display: grid; gap: 12px; }

      /* ── Simple List ────────────────────────────────────────── */
      .simple-list { list-style: none; padding-left: 0; }
      .simple-list li { padding: 3px 0; font-size: 12px; color: var(--muted); position: relative; padding-left: 14px; }
      .simple-list li::before { content: '\\2022'; position: absolute; left: 0; color: var(--faint); }

      /* ── Charts ─────────────────────────────────────────────── */
      .svg-chart { width: 100%; max-width: 280px; height: auto; display: block; margin: 8px auto; }
      .chart-list { display: grid; gap: 6px; }
      .chart-row { display: grid; grid-template-columns: 120px minmax(0, 1fr) 36px; gap: 8px; align-items: center; }
      .chart-label { font-size: 11px; color: var(--ink); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .chart-track { height: 6px; background: var(--line); border-radius: 3px; overflow: hidden; }
      .chart-fill { height: 100%; border-radius: 3px; }
      .chart-value { font-size: 11px; font-weight: 700; color: var(--ink); text-align: right; }
      .svg-shell { height: 80px; }

      /* ── State Badge Helpers ────────────────────────────────── */
      .state-bar-green { background: var(--green); }
      .state-bar-yellow { background: var(--amber); }
      .state-bar-red { background: var(--red); }
      .state-badge-green { background: var(--green-soft); color: var(--green); }
      .state-badge-yellow { background: var(--amber-soft); color: var(--amber); }
      .state-badge-red { background: var(--red-soft); color: var(--red); }
      .state-badge-gray { background: var(--surface); color: var(--faint); }

      /* ── Section Dividers ─────────────────────────────────── */
      .section-divider {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 14px 0 6px;
      }
      .section-divider-line {
        flex: 1;
        height: 2px;
        background: var(--navy);
      }
      .section-divider-label {
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 9px;
        font-weight: 700;
        color: var(--navy);
        letter-spacing: 0.16em;
        text-transform: uppercase;
        white-space: nowrap;
        padding: 0 4px;
      }

      /* ── Bridge Notes & Filler Content ────────────────────── */
      .bridge-note {
        padding: 10px 14px;
        background: var(--surface);
        border-left: 3px solid var(--blue);
        border-radius: 0 4px 4px 0;
        margin: 6px 0;
        font-size: 11px;
        color: var(--muted);
        line-height: 1.5;
        font-style: italic;
        break-inside: avoid;
      }
      .bridge-note p { margin: 0; font-style: italic; color: var(--muted); font-size: 11px; }
      .section-break-rule {
        border: none;
        border-top: 1px solid var(--line);
        margin: 10px 0;
      }
      .context-note {
        padding: 10px 14px;
        background: var(--surface-warm);
        border: 1px solid var(--line);
        border-radius: 4px;
        margin: 6px 0;
        font-size: 10.5px;
        color: var(--muted);
        line-height: 1.45;
        break-inside: avoid;
      }
      .context-note-title {
        font-size: 10px;
        font-weight: 700;
        color: var(--faint);
        letter-spacing: 0.12em;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      .context-note p { margin-bottom: 3px; font-size: 10.5px; }
      .reading-guide {
        display: flex;
        align-items: baseline;
        gap: 8px;
        padding: 8px 14px;
        background: var(--navy-soft);
        border-radius: 4px;
        margin: 6px 0;
        font-size: 11px;
        color: var(--ink);
        line-height: 1.4;
        break-inside: avoid;
      }
      .reading-guide-label {
        font-size: 9px;
        font-weight: 700;
        color: var(--blue-accent);
        letter-spacing: 0.12em;
        text-transform: uppercase;
        white-space: nowrap;
        flex-shrink: 0;
      }

      /* ── Compact Bullets ────────────────────────────────────── */
      .compact-bullets { display: flex; gap: 8px; flex-wrap: wrap; font-size: 11px; color: var(--muted); }
      .compact-bullets span::after { content: ' \\00B7'; color: var(--faint); margin-left: 8px; }
      .compact-bullets span:last-child::after { content: ''; }
    </style>
  </head>
  <body>
    <div class="report-page">
      <div id="pdf-report">
        <!-- PDF-SEGMENT-START -->
        ${input.completedMarkup}
        <!-- PDF-SEGMENT-END -->
        ${input.incompleteMarkup}
      </div>
    </div>
  </body>
  </html>`;
}

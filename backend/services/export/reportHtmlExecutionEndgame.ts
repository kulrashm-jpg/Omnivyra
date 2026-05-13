import type { PdfReportPayload } from './reportPdfRenderer';
import { escapeHtml, hasContent, safeText } from './reportHtmlCoreUtils';

export function renderOmnivyraExecutionEndgameHtml(
  payload: PdfReportPayload,
  variables: Record<string, string>,
): { html: string; templateName: string } {
  const opportunities = [
    { title: safeText(variables.opportunity_1_title, 1), text: safeText(variables.opportunity_1_text, 2), tag: safeText(variables.opportunity_1_tag, 1), tone: 'warn' },
    { title: safeText(variables.opportunity_2_title, 1), text: safeText(variables.opportunity_2_text, 2), tag: safeText(variables.opportunity_2_tag, 1), tone: 'bad' },
    { title: safeText(variables.opportunity_3_title, 1), text: safeText(variables.opportunity_3_text, 2), tag: safeText(variables.opportunity_3_tag, 1), tone: 'bad' },
  ].filter((item) => item.title && item.text);

  const nextSteps = [
    {
      title: safeText(variables.next_step_1_title, 1),
      text: safeText(variables.next_step_1_text, 2),
      focusPage: safeText(variables.next_step_1_focus_page, 1),
      tactics: variables.next_step_1_tactics.split('\n').map((item) => safeText(item, 1)).filter(Boolean).slice(0, 3),
      timeline: {
        short: safeText(variables.next_step_1_timeline_short, 1),
        mid: safeText(variables.next_step_1_timeline_mid, 1),
        long: safeText(variables.next_step_1_timeline_long, 1),
      },
      highlight: safeText(variables.next_step_1_highlight, 1),
      meta: [variables.next_step_1_priority, variables.next_step_1_impact, variables.next_step_1_effort].filter(Boolean).map((value) => safeText(value, 1)),
    },
    {
      title: safeText(variables.next_step_2_title, 1),
      text: safeText(variables.next_step_2_text, 2),
      focusPage: safeText(variables.next_step_2_focus_page, 1),
      tactics: variables.next_step_2_tactics.split('\n').map((item) => safeText(item, 1)).filter(Boolean).slice(0, 3),
      timeline: {
        short: safeText(variables.next_step_2_timeline_short, 1),
        mid: safeText(variables.next_step_2_timeline_mid, 1),
        long: safeText(variables.next_step_2_timeline_long, 1),
      },
      highlight: safeText(variables.next_step_2_highlight, 1),
      meta: [variables.next_step_2_priority, variables.next_step_2_impact, variables.next_step_2_effort].filter(Boolean).map((value) => safeText(value, 1)),
    },
  ].filter((item) => item.title && item.text);

  const metricCards = [
    { label: 'Request Context', value: variables.metric_request, text: variables.metric_request_text },
    { label: 'Visibility', value: variables.metric_visibility, text: variables.metric_visibility_text },
    { label: 'Content Strength', value: variables.metric_content, text: variables.metric_content_text },
    { label: 'Authority', value: variables.metric_authority, text: variables.metric_authority_text },
  ];

  const html = `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Omnivyra Execution Endgame</title>
    <style>
      @page { size: A4; margin: 14mm; }
      * { box-sizing:border-box; margin:0; padding:0; }
      :root { --bg:#f1f6fd; --paper:#fff; --line:#d9e4f0; --ink:#0f172a; --muted:#61708a; --blue:#4f7cff; --blue-soft:#eef4ff; --green:#16a34a; --green-soft:#ecfdf3; --red:#ef4444; --red-soft:#fff1f2; --amber:#f59e0b; --amber-soft:#fff7e8; }
      html,body { background:var(--bg); color:var(--ink); font-family:"Segoe UI",Arial,sans-serif; line-height:1.42; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .report { width:760px; margin:0 auto; padding:18px 0 28px; }
      .panel,.metric,.step,.opportunity { break-inside:avoid-page; page-break-inside:avoid; }
      .panel { background:var(--paper); border:1px solid var(--line); border-radius:18px; box-shadow:0 8px 24px rgba(15,23,42,.05); padding:16px; margin-bottom:12px; }
      h1,h2 { font-size:20px; margin-bottom:10px; }
      .sub { font-size:12px; color:var(--muted); margin-bottom:10px; }
      .metric-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:12px; }
      .metric { border:1px solid var(--line); border-radius:12px; background:#fff; padding:12px; }
      .metric strong { display:block; font-size:11px; color:var(--muted); text-transform:uppercase; margin-bottom:8px; }
      .metric .value { font-size:28px; line-height:1; font-weight:800; color:var(--blue); margin-bottom:8px; }
      .metric .bar { height:7px; border-radius:999px; background:#e8edf5; overflow:hidden; margin-bottom:6px; }
      .metric .bar span { display:block; height:100%; border-radius:999px; background:linear-gradient(90deg,#67d36f 0%,#22c55e 100%); }
      .metric p { font-size:12px; color:var(--muted); }
      .opportunities,.steps { display:grid; gap:10px; }
      .opportunity { border:1px solid var(--line); border-radius:12px; padding:12px; background:#fff; }
      .opportunity.warn { background:var(--amber-soft); border-color:#f3d18a; }
      .opportunity.bad { background:var(--red-soft); border-color:#f1b0b8; }
      .opportunity h3,.step h3 { font-size:12px; margin-bottom:6px; }
      .opportunity p,.step p { font-size:12px; margin-bottom:6px; }
      .tag,.pill { display:inline-block; font-size:10px; font-weight:700; padding:5px 8px; border-radius:999px; border:1px solid var(--line); background:#fff; color:var(--muted); }
      .step { border:1px solid var(--line); border-radius:12px; background:white; padding:14px; display:grid; grid-template-columns:24px 1fr; gap:10px; }
      .step .index { width:20px; height:20px; border-radius:50%; background:var(--blue-soft); color:var(--blue); font-size:11px; display:flex; align-items:center; justify-content:center; font-weight:800; margin-top:2px; }
      .step .highlight { background:var(--green-soft); border-radius:8px; padding:8px 10px; color:#166534; font-size:11px; margin:6px 0; }
      .step .meta { display:flex; flex-wrap:wrap; gap:6px; margin:6px 0; }
      .detail-label { display:block; font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; margin:8px 0 4px; }
      .detail-list { margin:6px 0 0 18px; }
      .detail-list li { font-size:12px; margin-bottom:4px; }
      .timeline { display:grid; gap:4px; margin-top:8px; }
      .timeline p { font-size:11px; color:var(--muted); margin-bottom:0; }
      .pill.blue { background:var(--blue-soft); color:var(--blue); border-color:#ced8ff; }
      .pill.green { background:var(--green-soft); color:var(--green); border-color:#bbe8c6; }
      .pill.red { background:var(--red-soft); color:var(--red); border-color:#f1b0b8; }
      .cta { text-align:center; border:1px solid var(--line); border-radius:16px; background:#fbfdff; padding:18px; }
      .cta h3 { font-size:18px; margin-bottom:6px; }
      .cta p { font-size:12px; color:var(--muted); margin-bottom:10px; }
      .button { display:inline-block; background:var(--blue); color:white; border-radius:10px; padding:10px 14px; font-size:12px; font-weight:700; }
    </style>
  </head>
  <body>
    <div class="report">
      <section class="panel">
        <h1>${escapeHtml(variables.company_name)} Execution Endgame</h1>
        <div class="sub">${escapeHtml(variables.executive_summary)}</div>
        <div class="metric-grid">
          ${metricCards.map((item) => `
            <div class="metric">
              <strong>${escapeHtml(item.label)}</strong>
              <div class="value">${escapeHtml(item.value)}</div>
              <div class="bar"><span style="width: ${Math.max(0, Math.min(100, Number(item.value) || 0))}%"></span></div>
              <p>${escapeHtml(item.text)}</p>
            </div>
          `).join('')}
        </div>
      </section>
      ${opportunities.length ? `
        <section class="panel">
          <h2>Improvement Opportunities</h2>
          <div class="opportunities">
            ${opportunities.map((item) => `
              <div class="opportunity ${item.tone}">
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.text)}</p>
                <span class="tag">${escapeHtml(item.tag)}</span>
              </div>
            `).join('')}
          </div>
        </section>
      ` : ''}
      ${nextSteps.length ? `
        <section class="panel">
          <h2>Your Next Steps</h2>
          <div class="steps">
            ${nextSteps.map((item, index) => `
              <div class="step">
                <div class="index">${index + 1}</div>
                <div>
                  <h3>${escapeHtml(item.title)}</h3>
                  <p>${escapeHtml(item.text)}</p>
                  ${item.focusPage ? `<span class="detail-label">Start here:</span><p>${escapeHtml(item.focusPage)}</p>` : ''}
                  ${item.tactics.length ? `<span class="detail-label">Tactics</span><ol class="detail-list">${item.tactics.map((tactic) => `<li>${escapeHtml(tactic)}</li>`).join('')}</ol>` : ''}
                  ${(item.timeline.short || item.timeline.mid || item.timeline.long) ? `<div class="timeline">
                    ${item.timeline.short ? `<p><strong>2-4 weeks:</strong> ${escapeHtml(item.timeline.short)}</p>` : ''}
                    ${item.timeline.mid ? `<p><strong>1-3 months:</strong> ${escapeHtml(item.timeline.mid)}</p>` : ''}
                    ${item.timeline.long ? `<p><strong>3-6 months:</strong> ${escapeHtml(item.timeline.long)}</p>` : ''}
                  </div>` : ''}
                  ${item.highlight ? `<div class="highlight">${escapeHtml(item.highlight)}</div>` : ''}
                  <div class="meta">
                    ${item.meta.map((meta, metaIndex) => `<span class="pill ${metaIndex === 0 ? 'blue' : metaIndex === 1 ? 'green' : 'red'}">${escapeHtml(meta)}</span>`).join('')}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </section>
      ` : ''}
      <section class="panel"><div class="cta"><h3>Ready to execute?</h3><p>${escapeHtml(variables.cta_text)}</p>${hasContent(variables.cta_label) ? `<span class="button">${escapeHtml(variables.cta_label)}</span>` : ''}</div></section>
    </div>
  </body>
  </html>`;

  return {
    html,
    templateName: 'omnivyra_execution_endgame_report_template.html',
  };
}

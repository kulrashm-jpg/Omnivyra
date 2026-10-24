/** Dossier v2 — design system. Navy/white surfaces, one brand blue, semantic accents. */
import { PALETTE as P } from './charts';

export const DOSSIER_V2_CSS = `
@page { size: A4; margin: 16mm 15mm 18mm 15mm;
  @bottom-left { content: var(--v2-footer, ""); font: 7.5pt Inter, "Segoe UI", Arial, sans-serif; color: ${P.greyMid}; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5pt Inter, "Segoe UI", Arial, sans-serif; color: ${P.greyMid}; }
}
@page :first { margin: 0; @bottom-left { content: none; } @bottom-right { content: none; } }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: Inter, "Segoe UI", system-ui, -apple-system, Arial, sans-serif; color: ${P.ink};
  font-size: 9.6pt; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1, h2, h3, h4 { color: ${P.navy}; margin: 0; line-height: 1.2; }
p { margin: 0 0 2.5mm; }
a { color: ${P.blue}; text-decoration: none; }
small { color: ${P.grey}; }

/* Cover */
.v2-cover { height: 297mm; padding: 26mm 22mm 20mm; background: ${P.navy}; color: #fff; display: flex; flex-direction: column;
  page-break-after: always; break-after: page; }
.v2-cover-brand { display: flex; align-items: center; gap: 4mm; }
.v2-cover-brand img { height: 12mm; background: #fff; border-radius: 2mm; padding: 1.5mm 3mm; }
.v2-cover-eyebrow { font-size: 8pt; letter-spacing: .24em; text-transform: uppercase; color: #9FB6D6; font-weight: 600; }
.v2-cover h1 { color: #fff; font-size: 30pt; font-weight: 700; margin: 34mm 0 5mm; max-width: 150mm; letter-spacing: -.01em; }
.v2-cover-thesis { font-size: 12.5pt; color: #D6E2F2; max-width: 145mm; line-height: 1.55; }
.v2-cover-meta { margin-top: auto; display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; border-top: 1px solid #2B4466; padding-top: 6mm; }
.v2-cover-meta div { font-size: 8pt; color: #9FB6D6; }
.v2-cover-meta strong { display: block; color: #fff; font-size: 11pt; margin-top: 1mm; }

/* Sections */
.v2-section { break-before: page; page-break-before: always; }
.v2-section-head { border-bottom: 2px solid ${P.navy}; padding-bottom: 3mm; margin-bottom: 6mm; display: flex; align-items: baseline; gap: 4mm; }
.v2-section-num { font-size: 22pt; font-weight: 800; color: ${P.blue}; line-height: 1; }
.v2-section-head h2 { font-size: 19pt; font-weight: 700; }
.v2-section-head p { margin: 1mm 0 0; color: ${P.grey}; font-size: 9.4pt; }
.v2-block { margin: 0 0 7mm; break-inside: avoid; page-break-inside: avoid; }
.v2-block h3 { font-size: 11.5pt; margin-bottom: 1.5mm; break-after: avoid; page-break-after: avoid; }
.v2-block > .v2-sub { break-after: avoid; page-break-after: avoid; }
.v2-block > .v2-sub { color: ${P.grey}; font-size: 8.8pt; margin: 0 0 3mm; }
.v2-allow-break { break-inside: auto; page-break-inside: auto; }

/* KPI cards */
.v2-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin-bottom: 6mm; }
.v2-kpi { border: 1px solid ${P.line}; border-top: 3px solid ${P.blue}; border-radius: 2mm; padding: 3mm 3.5mm; background: #fff; }
.v2-kpi-label { font-size: 7.4pt; text-transform: uppercase; letter-spacing: .12em; color: ${P.grey}; font-weight: 600; }
.v2-kpi-value { font-size: 15pt; font-weight: 750; color: ${P.navy}; margin-top: 1mm; }
.v2-kpi-note { font-size: 8pt; color: ${P.grey}; margin-top: .5mm; }
.v2-hero { display: grid; grid-template-columns: 46mm 1fr; gap: 7mm; align-items: center; margin-bottom: 6mm; }
.v2-hero-text h3 { font-size: 13pt; margin-bottom: 2mm; }

/* Decision panel */
.v2-decision { background: ${P.navy}; color: #fff; border-radius: 2.5mm; padding: 5mm 6mm; }
.v2-decision h3 { color: #fff; font-size: 11pt; margin-bottom: 3mm; }
.v2-decision ol { margin: 0; padding-left: 5mm; }
.v2-decision li { margin-bottom: 2mm; color: #E3ECF8; }
.v2-decision li strong { color: #fff; }
.v2-decision .v2-id { color: #9FB6D6; }

/* Tables */
table { border-collapse: collapse; width: 100%; }
.v2-table th, .v2-table td { text-align: left; vertical-align: top; padding: 2mm 2.2mm; border-bottom: 1px solid ${P.line}; font-size: 8.6pt; }
.v2-table thead th { font-size: 7.4pt; text-transform: uppercase; letter-spacing: .08em; color: ${P.grey}; border-bottom: 1.5px solid ${P.navy}; }
.v2-table tr { break-inside: avoid; page-break-inside: avoid; }
.v2-table td.v2-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.v2-id { font-family: "JetBrains Mono", Consolas, monospace; font-size: 7.4pt; color: ${P.grey}; }

/* Heatmap */
.v2-heat th, .v2-heat td { border: 1.5px solid #fff; padding: 1.6mm 1.8mm; font-size: 8.2pt; text-align: center; }
.v2-heat thead th { font-size: 7.4pt; color: ${P.grey}; font-weight: 600; vertical-align: bottom; }
.v2-heat thead th span { display: inline-block; max-width: 24mm; overflow-wrap: normal; word-break: keep-all; }
.v2-heat tbody th { text-align: left; font-weight: 600; background: ${P.wash}; max-width: 48mm; }
.v2-heat tbody th small { display: block; font-weight: 400; font-size: 7pt; }
.v2-legend { display: flex; flex-wrap: wrap; gap: 4mm; margin-top: 2.5mm; font-size: 7.8pt; color: ${P.grey}; }
.v2-legend i { display: inline-block; width: 3.2mm; height: 3.2mm; border: 1px solid; border-radius: .6mm; margin-right: 1.2mm; vertical-align: -0.5mm; }

/* Pills */
.v2-pill { display: inline-block; padding: .4mm 2mm; border-radius: 3mm; font-size: 7.3pt; font-weight: 650; letter-spacing: .03em; white-space: nowrap; border: 1px solid; }
.v2-pill-good { color: ${P.green}; background: ${P.greenSoft}; border-color: ${P.greenSoft}; }
.v2-pill-warn { color: #8A5A0F; background: ${P.amberSoft}; border-color: ${P.amberSoft}; }
.v2-pill-bad { color: ${P.crimson}; background: ${P.crimsonSoft}; border-color: ${P.crimsonSoft}; }
.v2-pill-info { color: ${P.blue}; background: ${P.blueSoft}; border-color: ${P.blueSoft}; }
.v2-pill-neutral { color: ${P.grey}; background: #fff; border-color: ${P.line}; }

/* Evidence cards */
.v2-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
.v2-card { border: 1px solid ${P.line}; border-left: 3px solid ${P.blue}; border-radius: 2mm; padding: 3.5mm 4mm; break-inside: avoid; page-break-inside: avoid; }
.v2-card h4 { font-size: 10pt; margin-bottom: 1.5mm; }
.v2-card-metric { font-size: 12.5pt; font-weight: 750; color: ${P.navy}; margin: 1mm 0 1.5mm; }
.v2-card dl { margin: 0; display: grid; grid-template-columns: 22mm 1fr; gap: 1mm 2mm; font-size: 8.3pt; }
.v2-card dt { color: ${P.grey}; font-weight: 600; }
.v2-card dd { margin: 0; }
.v2-card.v2-tone-bad { border-left-color: ${P.crimson}; }
.v2-card.v2-tone-warn { border-left-color: ${P.amber}; }
.v2-card.v2-tone-neutral { border-left-color: ${P.greyMid}; }

/* Two columns */
.v2-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
.v2-panel { border: 1px solid ${P.line}; border-radius: 2mm; padding: 4mm; background: #fff; break-inside: avoid; }
.v2-panel h4 { font-size: 9.6pt; margin-bottom: 2mm; }
.v2-note { font-size: 8.2pt; color: ${P.grey}; border-left: 2px solid ${P.line}; padding-left: 3mm; margin-top: 2.5mm; }
.v2-callout { background: ${P.wash}; border-radius: 2mm; padding: 3.5mm 4.5mm; font-size: 9pt; }
.v2-callout strong { color: ${P.navy}; }
.v2-list { margin: 0; padding-left: 4.5mm; }
.v2-list li { margin-bottom: 1.2mm; }
.v2-chart { display: block; max-width: 100%; }

/* Plain-English layer */
.v2-plain { background: ${P.blueSoft}; border-left: 3px solid ${P.blue}; border-radius: 1.5mm; padding: 3mm 4mm; margin: 0 0 6mm; font-size: 9.6pt; color: ${P.navy}; }
.v2-kpi-meaning { font-size: 7.8pt; color: ${P.grey}; margin-top: 1.5mm; border-top: 1px solid ${P.line}; padding-top: 1.5mm; line-height: 1.35; }
.v2-card-plain { font-size: 8.8pt; color: ${P.navy}; background: ${P.wash}; border-radius: 1.5mm; padding: 1.8mm 2.5mm; margin: 0 0 2mm; }
.v2-compact td { padding: 1.4mm 2mm; }

/* Decision cards */
.v2-decisions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3.5mm; }
.v2-decision-card { background: ${P.navy}; color: #E3ECF8; border-radius: 2.5mm; padding: 4mm; break-inside: avoid; }
.v2-decision-card h4 { color: #fff; font-size: 9.8pt; margin: 1.5mm 0 2mm; line-height: 1.3; }
.v2-decision-card dl { margin: 0; font-size: 8.2pt; }
.v2-decision-card dt { color: #9FB6D6; font-weight: 700; font-size: 7.2pt; text-transform: uppercase; letter-spacing: .08em; margin-top: 1.5mm; }
.v2-decision-card dd { margin: .5mm 0 0; }
.v2-decision-card .v2-id { color: #9FB6D6; margin-top: 2.5mm; }
.v2-decision-num { width: 6mm; height: 6mm; border-radius: 50%; background: ${P.blue}; color: #fff; font-weight: 800; font-size: 9pt; display: flex; align-items: center; justify-content: center; }

/* Reading lenses */
.v2-lenses { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; }
.v2-lens { border: 1px solid ${P.line}; border-radius: 2mm; padding: 3mm; break-inside: avoid; }
.v2-lens h4 { font-size: 9pt; margin-bottom: 1.2mm; }
.v2-lens p { font-size: 8pt; color: ${P.grey}; margin-bottom: 2mm; }
.v2-lens small { display: block; margin-top: 1.5mm; font-size: 7.4pt; }
.v2-lens .v2-pill { white-space: normal; line-height: 1.3; }
.v2-ring { display: block; }

/* Cover tags */
.v2-cover-tags { margin-top: 8mm; display: flex; gap: 3mm; }
.v2-cover-tags span { border: 1px solid #2B4466; border-radius: 10mm; padding: 1.5mm 4mm; font-size: 8.5pt; color: #D6E2F2; }
.v2-cover-meta em { display: block; font-style: normal; color: #9FB6D6; font-size: 7.4pt; margin-top: .5mm; }

/* Summary pages: each is exactly one A4 page */
.v2-summary { break-before: page; page-break-before: always; break-after: page; page-break-after: always;
  height: 262mm; overflow: hidden; display: flex; flex-direction: column; }
.v2-summary + .v2-section { break-before: auto; page-break-before: auto; }
.v2-summary-head { border-bottom: 2px solid ${P.navy}; padding-bottom: 2.5mm; margin-bottom: 4mm; }
.v2-summary-head span { font-size: 7.4pt; letter-spacing: .2em; text-transform: uppercase; color: ${P.blue}; font-weight: 700; }
.v2-summary-head h2 { font-size: 20pt; font-weight: 750; margin: .5mm 0 1mm; }
.v2-summary-head p { margin: 0; color: ${P.grey}; font-size: 9.2pt; }
.v2-summary-h { font-size: 10.5pt; margin: 4.5mm 0 2.2mm; }
.v2-tiles4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; }
.v2-tile { border: 1px solid ${P.line}; border-top: 3px solid ${P.blue}; border-radius: 2mm; padding: 3mm; }
.v2-tile-value { font-size: 19pt; font-weight: 800; line-height: 1.1; }
.v2-tile-value small { font-size: 9pt; color: ${P.grey}; font-weight: 600; }
.v2-tile-label { font-size: 8.6pt; font-weight: 700; color: ${P.navy}; margin-top: 1mm; }
.v2-tile-note { font-size: 7.6pt; color: ${P.grey}; line-height: 1.3; margin-top: .5mm; }
.v2-vis3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; }
.v2-vis { display: flex; gap: 2.5mm; border: 1px solid ${P.line}; border-left: 3px solid ${P.greyMid}; border-radius: 2mm; padding: 3mm; break-inside: avoid; }
.v2-vis-good { border-left-color: ${P.green}; } .v2-vis-warn { border-left-color: ${P.amber}; } .v2-vis-bad { border-left-color: ${P.crimson}; } .v2-vis-info { border-left-color: ${P.blue}; }
.v2-vis-n { flex: none; width: 6mm; height: 6mm; border-radius: 50%; background: ${P.navy}; color: #fff; font-weight: 800; font-size: 8.5pt; display: flex; align-items: center; justify-content: center; }
.v2-vis h4 { font-size: 8.6pt; text-transform: uppercase; letter-spacing: .06em; color: ${P.grey}; margin-bottom: 1mm; }
.v2-vis-value { font-size: 9.6pt; font-weight: 700; color: ${P.navy}; line-height: 1.3; margin-bottom: 1mm; }
.v2-vis small { font-size: 7.4pt; line-height: 1.3; display: block; }
.v2-tight { gap: 3mm; }
.v2-tight .v2-panel { padding: 3mm; }
.v2-tight .v2-panel p { margin-bottom: 1.5mm; line-height: 1.9; }
.v2-tight small { font-size: 7.4pt; display: block; line-height: 1.3; }
.v2-mini-funnel { display: flex; align-items: stretch; gap: 1mm; margin-bottom: 2mm; }
.v2-mini-funnel span { flex: 1; background: ${P.wash}; border-radius: 1.5mm; padding: 1.5mm; font-size: 7.4pt; text-align: center; line-height: 1.25; }
.v2-mini-funnel b { display: block; font-size: 12pt; color: ${P.navy}; }
.v2-mini-funnel em { display: block; font-style: normal; color: ${P.amber}; font-weight: 600; }
.v2-mini-funnel i { align-self: center; color: ${P.greyMid}; font-style: normal; }
.v2-know { margin: 0; padding-left: 5mm; }
.v2-know li { margin-bottom: 2.2mm; font-size: 9.2pt; line-height: 1.45; }
.v2-where { font-size: 7.4pt; color: ${P.blue}; font-weight: 600; white-space: nowrap; }
.v2-next-list { display: flex; flex-direction: column; gap: 2.5mm; }
.v2-next { display: flex; gap: 3mm; border: 1px solid ${P.line}; border-left: 3px solid ${P.blue}; border-radius: 2mm; padding: 2.8mm 3.5mm; break-inside: avoid; }
.v2-next-n { flex: none; width: 7mm; height: 7mm; border-radius: 50%; background: ${P.navy}; color: #fff; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.v2-next-body { flex: 1; }
.v2-next h4 { font-size: 10pt; margin-bottom: 1mm; }
.v2-next dl { margin: 0; display: grid; grid-template-columns: 22mm 1fr; gap: .6mm 2mm; font-size: 8.4pt; }
.v2-next dt { color: ${P.grey}; font-weight: 700; font-size: 7.4pt; text-transform: uppercase; letter-spacing: .06em; padding-top: .4mm; }
.v2-next dd { margin: 0; line-height: 1.35; }
.v2-next-meta { display: flex; flex-wrap: wrap; gap: 1mm 4mm; margin-top: 1.5mm; font-size: 7.4pt; color: ${P.grey}; }
.v2-next-meta span:first-child { font-family: Consolas, monospace; color: ${P.blue}; }
.v2-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; }
.v2-strip-col { border: 1px solid ${P.line}; border-radius: 2mm; padding: 2.5mm 3mm; }
.v2-strip-head { font-size: 7.4pt; text-transform: uppercase; letter-spacing: .1em; color: ${P.blue}; font-weight: 700; }
.v2-strip-theme { font-size: 9.2pt; font-weight: 700; color: ${P.navy}; }
.v2-strip-count { font-size: 8pt; color: ${P.grey}; margin-bottom: 1mm; }
.v2-strip-col small { font-family: Consolas, monospace; font-size: 7pt; line-height: 1.4; display: block; }

/* Competitor pipeline */
.v2-pipe { display: flex; align-items: stretch; gap: 2mm; margin-bottom: 4mm; }
.v2-pipe i { align-self: center; color: ${P.greyMid}; font-style: normal; font-size: 14pt; }
.v2-pipe-stage { flex: 1; border: 1px solid; border-top-width: 3px; border-radius: 2mm; padding: 2.5mm; text-align: center; }
.v2-pipe-stage b { display: block; font-size: 16pt; color: ${P.navy}; }
.v2-pipe-stage span { display: block; font-size: 8.6pt; font-weight: 700; color: ${P.navy}; }
.v2-pipe-stage small { font-size: 7.2pt; }
.v2-muted { color: ${P.greyMid}; }

/* Page roles */
.v2-roles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2.5mm; }
.v2-role { background: ${P.wash}; border-radius: 1.5mm; padding: 2.5mm 3mm; }
.v2-role b { display: block; font-size: 8.8pt; color: ${P.navy}; }
.v2-role small { font-family: Consolas, monospace; font-size: 7.4pt; }
`;

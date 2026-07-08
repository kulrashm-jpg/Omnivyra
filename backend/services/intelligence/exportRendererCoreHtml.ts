/** Part of exportRenderer — the report STYLESHEET (giant CSS template literal; no imports needed). */
export const STYLESHEET = `
  /* Print-luxury margins. Slightly more generous on the outer edge so
     pages handle elegantly when bound or held; restrained enough that
     the body measure stays comfortable for a serif at 10.5pt. */
  @page {
    size: A4;
    margin: 26mm 24mm 22mm 24mm;
  }
  /* Cover page intentionally drops the running footer; the cover meta
     row carries its own date treatment. Interior pages run the page
     number + brand mark in the bottom margin. */
  @page :first { margin: 24mm 22mm 22mm 22mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #1a2332;
    font-family: "Source Serif 4", "Georgia", "Times New Roman", serif;
    font-size: 10.5pt;
    line-height: 1.65;
    text-rendering: optimizeLegibility;
    font-feature-settings: "kern", "liga", "calt";
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1, h2, h3, h4, h5, .ds-section-question, .ds-pill, .ds-eyebrow {
    font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
    font-weight: 580;
  }
  p { orphans: 3; widows: 3; }
  /* Tabular numerals on every quantitative element so scores align
     vertically across bars, pillars, and matrix cells. */
  .ds-vbar-value, .ds-vstrip-value, .ds-vbottleneck-value, .ds-vspectrum-meta,
  .ds-pillar-score, .ds-hero-score-value, .ds-ai-card-score, .ds-matrix td,
  .ds-weak-dim strong { font-variant-numeric: tabular-nums; }
  .ds-page { padding: 0; max-width: 720px; margin: 0 auto; }

  /* ── Cover ─────────────────────────────────────────────────────────────── */
  /* The cover is the one full-bleed surface that legitimately uses tint;
     everything inside the document body afterwards is composed in pure
     typography. */
  .ds-cover {
    padding: 18mm 0 14mm;
    page-break-after: always;
    break-after: page;
    display: block;
    position: relative;
  }
  .ds-cover:before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(115deg, rgba(2, 132, 199, 0.04), rgba(255,255,255,0) 42%),
      linear-gradient(180deg, rgba(15, 23, 42, 0.025), rgba(255,255,255,0) 34%);
  }
  .ds-cover-mark {
    width: 25mm;
    height: 0.6mm;
    border-radius: 999px;
    background: linear-gradient(90deg, #0f4c6b, rgba(15, 76, 107, 0.25));
    margin: 0 0 14mm;
  }
  .ds-cover-content { position: relative; z-index: 1; max-width: 150mm; }
  /* Identity cluster — logo (or H1 wordmark) + domain are tightly
     coupled so the eye reads them as one unit. The dossier title
     appears AFTER a larger break, signalling a hierarchy step. */
  .ds-cover-identity { margin: 0 0 12mm; }
  .ds-cover-company { font-size: 28pt; line-height: 1.06; margin: 0 0 3.5mm; color: #0f172a; font-weight: 600; letter-spacing: -0.018em; }
  .ds-cover-domain { font-size: 9pt; letter-spacing: 0.18em; text-transform: uppercase; color: #94a3b8; margin: 0; font-family: "Inter", system-ui, sans-serif; font-weight: 540; }
  .ds-cover-title { font-size: 11.5pt; letter-spacing: 0.2em; text-transform: uppercase; color: #475569; margin: 0 0 7mm; font-family: "Inter", system-ui, sans-serif; font-weight: 560; }

  /* Authority Shape cover identity block — the dominant strategic
     statement on the cover. Sits between the dossier title and the
     thesis. Sized to share weight with the company name rather than
     compete with it; the eye lands on company → shape → thesis in a
     calm vertical rhythm. */
  .ds-cover-shape { margin: 14mm 0 0; max-width: 150mm; }
  .ds-cover-shape-eyebrow { font-size: 7.6pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2.5mm; font-family: "Inter", system-ui, sans-serif; font-weight: 600; }
  .ds-cover-shape-name { font-size: 19pt; line-height: 1.22; margin: 0; color: #0f172a; font-weight: 580; letter-spacing: -0.014em; font-family: "Inter", system-ui, sans-serif; }

  .ds-cover-thesis { font-size: 14.5pt; line-height: 1.55; color: #1a2332; margin: 13mm 0 0; max-width: 138mm; font-family: "Inter", system-ui, sans-serif; font-weight: 400; }
  /* Meta row sits with intentional proximity to the thesis (16mm)
     rather than floating to the bottom of the cover via flex
     space-between. This eliminates the dead-zone the previous layout
     produced and matches the proximity rhythm of the identity cluster. */
  .ds-cover-meta-row {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8mm;
    margin-top: 16mm;
    padding-top: 6mm;
    border-top: 0.2mm solid #e8edf2;
    color: #64748b;
    font-size: 9pt;
    font-family: "Inter", system-ui, sans-serif;
  }
  .ds-cover-stage {
    display: inline-flex;
    align-items: baseline;
    gap: 2.5mm;
    color: #1a2332;
    font-size: 8.5pt;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    font-weight: 650;
  }
  .ds-cover-stage:before {
    content: "·";
    color: #64748b;
    font-weight: 400;
  }

  /* ── Snapshot (page 2) ─────────────────────────────────────────────────── */
  /* Every panel border/background here has been removed. Grouping is carried
     entirely by typographic eyebrow labels + vertical rhythm. */
  .ds-snapshot {
    min-height: 249mm;
    padding: 13mm 0 10mm;
    page-break-after: always;
    break-after: page;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .ds-snapshot-header { margin: 0 0 11mm; }
  .ds-snapshot-kicker { font-size: 8pt; letter-spacing: 0.24em; text-transform: uppercase; color: #64748b; margin: 0 0 4.5mm; font-family: "Inter", system-ui, sans-serif; font-weight: 600; }
  .ds-snapshot-title { font-size: 21pt; line-height: 1.18; margin: 0 0 5mm; color: #0f172a; font-weight: 620; letter-spacing: -0.014em; }
  .ds-authority-shape { font-size: 13.5pt; line-height: 1.55; margin: 0; color: #1a2332; font-family: "Inter", system-ui, sans-serif; font-weight: 420; max-width: 150mm; }

  /* Signal grid: borderless. Vertical rhythm + a faint typographic separator
     instead of a top rule. */
  .ds-signal-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 9mm 9mm; margin: 10mm 0 11mm; }
  .ds-signal { min-height: 30mm; padding: 0; page-break-inside: avoid; }
  .ds-signal-label { font-size: 7.2pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2.5mm; font-family: "Inter", system-ui, sans-serif; font-weight: 580; }
  .ds-signal-value { font-size: 10.8pt; line-height: 1.32; color: #0f172a; margin: 0 0 2.2mm; font-family: "Inter", system-ui, sans-serif; font-weight: 540; letter-spacing: -0.005em; }
  .ds-signal-detail { font-size: 9pt; line-height: 1.6; color: #475569; margin: 0; }

  .ds-direction { margin: 0 0 9mm; padding: 9mm 0 0; page-break-inside: avoid; }
  .ds-direction-label { font-size: 7.4pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 3.2mm; font-family: "Inter", system-ui, sans-serif; font-weight: 580; }
  .ds-direction-text { font-size: 11pt; line-height: 1.72; color: #1a2332; margin: 0; max-width: 152mm; }

  /* Evidence bar at the bottom of the snapshot — single thin hairline only,
     not a bordered footer. */
  .ds-evidence-bar {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 7mm;
    padding-top: 7mm;
    color: #64748b;
    font-family: "Inter", system-ui, sans-serif;
    page-break-inside: avoid;
    border-top: 0.2mm solid #eef1f5;
  }
  .ds-evidence-label { display: block; font-size: 6.8pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 580; margin-bottom: 1.4mm; }
  .ds-evidence-value { font-size: 8.4pt; line-height: 1.45; color: #475569; }

  /* ── Section frame ─────────────────────────────────────────────────────── */
  /* Sections separated by whitespace alone. The previous solid hairline
     between sections is removed; a generous top padding carries the rhythm. */
  .ds-section { padding: 16mm 0 6mm; page-break-inside: auto; }
  .ds-section + .ds-section { padding-top: 16mm; }
  .ds-section-eyebrow {
    font-size: 7.6pt;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: #94a3b8;
    margin: 0 0 4mm;
    font-weight: 600;
  }
  .ds-section-title { font-size: 17pt; line-height: 1.24; margin: 0 0 2.5mm; font-weight: 600; color: #0f172a; letter-spacing: -0.012em; }
  .ds-section-question {
    font-size: 10.6pt;
    color: #64748b;
    margin: 0 0 10mm;
    font-style: italic;
    font-weight: 400;
  }

  /* ── Hero score row (Executive Reality + Trust) ─────────────────────────
     Borderless. Typography is the focal point — the number is the visual
     hero, not a bordered card around the number. */
  .ds-hero-score-row { display: grid; grid-template-columns: 1fr 2fr; gap: 10mm; align-items: baseline; margin: 6mm 0 4mm; }
  .ds-hero-score { padding: 0; }
  .ds-hero-score-value { font-size: 48pt; line-height: 1; font-weight: 680; color: #0f172a; font-family: "Inter", system-ui, sans-serif; letter-spacing: -0.025em; }
  .ds-hero-score-of { font-size: 13pt; color: #cbd5e1; margin-left: 2.5mm; font-weight: 400; }
  .ds-hero-score-band { font-size: 8.5pt; letter-spacing: 0.22em; text-transform: uppercase; color: #64748b; margin: 3mm 0 0; font-family: "Inter", system-ui, sans-serif; font-weight: 600; }
  .ds-hero-priority { padding: 0; }
  .ds-hero-priority-label { font-size: 8pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2.5mm; font-weight: 650; }
  .ds-hero-priority-text { font-size: 11pt; line-height: 1.65; color: #1a2332; margin: 0; }

  /* ── Insight cards ─────────────────────────────────────────────────────
     Page-break wrapper preserved. Card border / background / radius removed.
     Tone is communicated by a single thin left rail (0.6mm) — quiet by
     comparison to a full panel. Internal blocks group through eyebrow
     labels alone, no shaded sub-panels. */
  .ds-insights { margin: 5mm 0 0; }
  .ds-insight {
    page-break-inside: avoid;
    padding: 3mm 0 4mm 5.5mm;
    margin: 0 0 9mm;
    border-left: 0.4mm solid #cbd5e1;
    background: transparent;
    border-radius: 0;
  }
  .ds-insight-tone-risk { border-left-color: #c2410c; }
  .ds-insight-tone-opportunity { border-left-color: #047857; }
  .ds-insight-tone-momentum { border-left-color: #1d4ed8; }
  .ds-insight-tone-context { border-left-color: #cbd5e1; }
  .ds-insight-eyebrow { font-size: 7.2pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 3.5mm; font-weight: 600; }
  .ds-insight-block + .ds-insight-block { margin-top: 4.5mm; }
  .ds-insight-block-label { font-size: 7pt; letter-spacing: 0.22em; text-transform: uppercase; color: #cbd5e1; margin: 0 0 1.4mm; font-weight: 600; }
  .ds-insight-block-text { font-size: 10pt; line-height: 1.65; color: #1a2332; margin: 0; }
  .ds-insight-block-text.is-observation { font-weight: 540; color: #0f172a; font-size: 10.4pt; letter-spacing: -0.002em; }

  /* ── Pillar grid ───────────────────────────────────────────────────────
     Dashed bottom border between rows replaced with whitespace. Each row
     now reads as a typographic pair (number + name) rather than a row
     between separator lines. */
  .ds-pillar-grid { margin: 7mm 0 0; }
  .ds-pillar { display: grid; grid-template-columns: 22mm 1fr; gap: 7mm; padding: 5.5mm 0; page-break-inside: avoid; }
  .ds-pillar-rail { padding-left: 0; border-left: 0; }
  .ds-pillar-score { font-size: 26pt; line-height: 1; font-weight: 620; color: #0f172a; font-family: "Inter", system-ui, sans-serif; letter-spacing: -0.024em; font-variant-numeric: tabular-nums; }
  .ds-pillar-score-of { font-size: 9pt; color: #cbd5e1; font-weight: 400; }
  .ds-pillar-band { font-size: 7.2pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; margin-top: 2.2mm; font-family: "Inter", system-ui, sans-serif; font-weight: 580; }
  .ds-pillar-name { font-size: 11.5pt; font-weight: 540; margin: 0 0 1mm; font-family: "Inter", system-ui, sans-serif; color: #0f172a; letter-spacing: -0.005em; }
  .ds-pillar-purpose { font-size: 8.8pt; color: #64748b; margin: 0 0 2.8mm; font-style: italic; }
  /* Inline score bar — adds analytical instrumentation to every pillar
     row so the page reads as evidence-rich within seconds, not just a
     stack of numbers + prose. */
  .ds-pillar-bar { width: 100%; height: 1.4mm; background: #f1f5f9; border-radius: 0.7mm; overflow: hidden; margin: 0 0 2.2mm; }
  .ds-pillar-bar-fill { height: 100%; border-radius: inherit; }
  .ds-pillar-signal { font-size: 9.6pt; color: #1a2332; margin: 1mm 0 0; line-height: 1.6; }

  /* ── AI hero ──────────────────────────────────────────────────────────
     The colored gradient panel is removed. The two AI sub-cards lose their
     borders + backgrounds — they're now typographic columns separated by
     whitespace. The matrix itself gains a single subtle top rule, which is
     the only "framing" element that survives. */
  .ds-ai-hero { padding: 0; background: transparent; border-radius: 0; margin: 4mm 0 0; }
  .ds-ai-positioning { font-size: 11.5pt; line-height: 1.7; color: #1a2332; margin: 0 0 9mm; font-style: italic; max-width: 155mm; }
  .ds-ai-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12mm; margin: 0 0 9mm; }
  .ds-ai-card { padding: 0; background: transparent; border: 0; border-radius: 0; }
  .ds-ai-card-label { font-size: 7.8pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 650; margin: 0 0 3mm; }
  .ds-ai-card-score { font-size: 26pt; line-height: 1; font-weight: 680; color: #0f172a; font-family: "Inter", system-ui, sans-serif; letter-spacing: -0.02em; }
  .ds-ai-card-detail { font-size: 9.5pt; color: #475569; margin: 3mm 0 0; line-height: 1.55; }

  /* ── Citation matrix ──────────────────────────────────────────────────
     The matrix is genuinely tabular data and stays gridded — but the grid
     lines are reduced to 0.2mm at low contrast, headers lose their fill,
     and only "strong cell" still uses tint to communicate the data. */
  .ds-matrix { width: 100%; border-collapse: collapse; margin: 6mm 0 0; font-size: 8pt; font-family: "Inter", system-ui, sans-serif; }
  .ds-matrix th, .ds-matrix td { border: 0.2mm solid #e8edf2; padding: 1.8mm 2mm; text-align: center; }
  .ds-matrix th { background: transparent; font-weight: 600; color: #94a3b8; letter-spacing: 0.06em; text-transform: uppercase; font-size: 7pt; }
  .ds-matrix td.label { text-align: left; background: transparent; font-weight: 600; color: #1a2332; }
  .ds-matrix-cell-measured { color: #1a2332; }
  .ds-matrix-cell-empty { color: #cbd5e1; }
  .ds-matrix-cell-strong { background: #ecfdf5; color: #047857; font-weight: 600; }
  .ds-matrix-cell-moderate { background: transparent; color: #b45309; }
  .ds-matrix-cell-weak { background: transparent; color: #b91c1c; }

  /* ── Maturity storyline ────────────────────────────────────────────────
     The bordered "card" containing the storyline is removed. Stage label
     becomes a heading; phases become typographic pairs separated by
     whitespace, not dashed rules. */
  .ds-maturity { margin: 6mm 0 0; padding: 0; border: 0; border-radius: 0; page-break-inside: avoid; }
  .ds-maturity-stage { font-size: 16pt; font-weight: 660; margin: 0 0 1.5mm; font-family: "Inter", system-ui, sans-serif; color: #0f172a; letter-spacing: -0.005em; }
  .ds-maturity-next { font-size: 9.5pt; color: #64748b; margin: 0 0 7mm; font-style: italic; }
  .ds-storyline { list-style: none; margin: 5mm 0 0; padding: 0; }
  .ds-storyline-item { padding: 4mm 0; border: 0; page-break-inside: avoid; }
  .ds-storyline-item:last-child { padding-bottom: 0; }
  .ds-storyline-phase { font-size: 7.6pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 650; margin: 0 0 1.8mm; }
  .ds-storyline-text { font-size: 10.2pt; line-height: 1.65; color: #1a2332; margin: 0; max-width: 155mm; }

  /* ── Action playbook ──────────────────────────────────────────────────
     Action card borders + backgrounds removed. Each action becomes a
     typographic block with a left rail tone (severity-driven) and an
     eyebrow row of pills. Group containers lose all framing. */
  .ds-playbook-group { margin: 9mm 0 0; page-break-inside: avoid; }
  .ds-playbook-group-header { padding: 0; margin: 0 0 5mm; }
  .ds-playbook-group-label { font-size: 11pt; font-weight: 600; margin: 0 0 1.5mm; font-family: "Inter", system-ui, sans-serif; color: #0f172a; letter-spacing: -0.005em; }
  .ds-playbook-group-desc { font-size: 9.5pt; line-height: 1.6; color: #64748b; margin: 0; max-width: 155mm; font-style: italic; }
  .ds-action {
    page-break-inside: avoid;
    border: 0;
    border-left: 0.4mm solid #e8edf2;
    border-radius: 0;
    background: transparent;
    padding: 2mm 0 4mm 5.5mm;
    margin: 0 0 7mm;
  }
  .ds-action-title { font-size: 10.6pt; font-weight: 560; margin: 0 0 2.2mm; font-family: "Inter", system-ui, sans-serif; color: #0f172a; letter-spacing: -0.005em; }
  .ds-action-rationale { font-size: 9pt; color: #94a3b8; line-height: 1.55; margin: 0 0 2.5mm; font-style: italic; }
  .ds-action-meta { display: flex; flex-wrap: wrap; gap: 2.2mm; margin-top: 3.5mm; }
  .ds-action-impacts { font-size: 9pt; color: #1a2332; margin: 2mm 0 0; }
  .ds-action-impacts dt { display: inline; font-weight: 600; color: #475569; }
  .ds-action-impacts dd { display: inline; margin: 0 4mm 0 0; }

  /* ── Pills ─────────────────────────────────────────────────────────────
     Flattened palette. Pillar pills retain their muted accent for
     wayfinding inside long action lists; everything else collapses to a
     single restrained grey so colour competition disappears. */
  .ds-pill {
    display: inline-block;
    padding: 0.7mm 2.2mm;
    font-size: 6.8pt;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    border-radius: 99px;
    background: #f5f7fa;
    color: #475569;
    font-weight: 540;
  }
  .ds-pill-pillar-foundation { background: #eff6ff; color: #1e40af; }
  .ds-pill-pillar-authority { background: #f5f3ff; color: #5b21b6; }
  .ds-pill-pillar-discoverability { background: #ecfdf5; color: #047857; }
  .ds-pill-pillar-trust { background: #fffbeb; color: #b45309; }
  .ds-pill-pillar-momentum { background: #fff1f2; color: #be123c; }
  .ds-pill-confidence-high { background: #ecfdf5; color: #047857; }
  .ds-pill-confidence-medium { background: #f1f5f9; color: #475569; }
  .ds-pill-confidence-low { background: #f8fafc; color: #94a3b8; }
  .ds-pill-severity-critical { background: #fee2e2; color: #b91c1c; }
  .ds-pill-severity-moderate { background: #f1f5f9; color: #475569; }
  .ds-pill-severity-low { background: #f8fafc; color: #94a3b8; }

  /* Sever the action's left rail tone with severity (so eye reads severity
     without needing the pill). */
  .ds-action.ds-action-severity-critical { border-left-color: #c2410c; border-left-width: 0.6mm; }
  .ds-action.ds-action-severity-moderate { border-left-color: #cbd5e1; }
  .ds-action.ds-action-severity-low { border-left-color: #e8edf2; }

  /* ── Framing sentence (section opener) ────────────────────────────────
     A single memorable sentence that opens each major section. The
     premium framing pairs a serif italic with a comfortable measure
     and generous lead-in space; the line carries by typography alone,
     never a panel or pull-quote widget. */
  .ds-framing { font-size: 13pt; line-height: 1.6; color: #0f172a; margin: 0 0 10mm; max-width: 148mm; font-style: italic; font-family: "Source Serif 4", Georgia, serif; font-weight: 420; letter-spacing: -0.002em; }

  /* ── Constraint narrative (4-part interpretive block) ─────────────────
     Strategic interpretation, NOT a recommendation card. Eyebrow + body
     pairs separated by whitespace. Page-break wrapper preserved. */
  .ds-constraint-narrative { margin: 4mm 0 7mm; padding: 0; page-break-inside: avoid; }
  .ds-constraint-narrative-row { margin: 0 0 4.5mm; max-width: 152mm; }
  .ds-constraint-narrative-row:last-child { margin-bottom: 0; }
  .ds-constraint-narrative-label { font-size: 7.2pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 1.8mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-constraint-narrative-text { font-size: 10.2pt; line-height: 1.7; color: #1a2332; margin: 0; }

  /* ── Maturity pattern ("What leaders typically do") ───────────────────
     Pattern observation paired with the storyline. No tint, no card. */
  .ds-pattern { margin: 7mm 0 0; padding: 0; page-break-inside: avoid; max-width: 155mm; }
  .ds-pattern-eyebrow { font-size: 7.6pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2.5mm; font-weight: 650; font-family: "Inter", system-ui, sans-serif; }
  .ds-pattern-row { margin: 0 0 3.5mm; }
  .ds-pattern-row:last-child { margin-bottom: 0; }
  .ds-pattern-row-label { font-size: 7.2pt; letter-spacing: 0.2em; text-transform: uppercase; color: #cbd5e1; margin: 0 0 1mm; font-weight: 650; font-family: "Inter", system-ui, sans-serif; }
  .ds-pattern-row-text { font-size: 10pt; line-height: 1.6; color: #1a2332; margin: 0; }

  /* ── Authority Shape (signature interpretation primitive) ─────────────
     Same typographic rhythm as constraint narrative — the shape is named
     as a sub-heading, then a single calm paragraph explains it. No tint,
     no rule, no panel. The shape's memorability comes from repetition
     across the cover, snapshot, authority position, and closing — not
     from visual weight. */
  .ds-authority-shape-block { margin: 9mm 0 0; padding: 0; page-break-inside: avoid; max-width: 152mm; }
  .ds-authority-shape-eyebrow { font-size: 7.2pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2.2mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-authority-shape-name { font-size: 12.8pt; line-height: 1.32; color: #0f172a; margin: 0 0 3mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; letter-spacing: -0.012em; }
  .ds-authority-shape-why { font-size: 9.4pt; line-height: 1.6; color: #64748b; margin: 0 0 3.2mm; font-style: italic; }
  .ds-authority-shape-body { font-size: 10.2pt; line-height: 1.7; color: #1a2332; margin: 0; }

  /* ── Maturity evolution (developmental story) ────────────────────────
     5-row eyebrow + body block. Replaces the older numbered-storyline
     visualisation. */
  .ds-maturity-evolution { margin: 8mm 0 0; padding: 0; page-break-inside: avoid; max-width: 152mm; }
  .ds-maturity-evolution-eyebrow { font-size: 7.2pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 4.5mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-maturity-evolution-row { margin: 0 0 4.5mm; }
  .ds-maturity-evolution-row:last-child { margin-bottom: 0; }
  .ds-maturity-evolution-row-label { font-size: 7pt; letter-spacing: 0.22em; text-transform: uppercase; color: #cbd5e1; margin: 0 0 0.6mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-maturity-evolution-row-caption { font-size: 8.4pt; line-height: 1.45; color: #94a3b8; margin: 0 0 1.8mm; font-style: italic; font-family: "Source Serif 4", Georgia, serif; }
  .ds-maturity-evolution-row-text { font-size: 10.2pt; line-height: 1.7; color: #1a2332; margin: 0; }

  /* ── Momentum shape ──────────────────────────────────────────────────
     Single short label + reading + interpretation, typographic only. */
  .ds-momentum-shape { margin: 7mm 0 0; padding: 0; page-break-inside: avoid; max-width: 155mm; }
  .ds-momentum-shape-eyebrow { font-size: 7.6pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2mm; font-weight: 650; font-family: "Inter", system-ui, sans-serif; }
  .ds-momentum-shape-label { font-size: 12pt; line-height: 1.4; color: #0f172a; margin: 0 0 2mm; font-weight: 620; font-family: "Inter", system-ui, sans-serif; letter-spacing: -0.005em; }
  .ds-momentum-shape-reading { font-size: 9.5pt; line-height: 1.55; color: #64748b; margin: 0 0 3mm; font-style: italic; }
  .ds-momentum-shape-body { font-size: 10.2pt; line-height: 1.65; color: #1a2332; margin: 0; }

  /* ── Methodology page (How These Numbers Are Calculated) ──────────────
     Final transparency block. Editorial dl-list, no card chrome.
     Renders before the closing interpretation so readers can see the
     derivation logic. */
  .ds-methodology { padding: 24mm 0 6mm; page-break-inside: avoid; }
  .ds-methodology-eyebrow { font-size: 7.6pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 4mm; font-weight: 600; font-family: "Inter", system-ui, sans-serif; }
  .ds-methodology-title { font-size: 17pt; line-height: 1.24; margin: 0 0 6mm; color: #0f172a; font-weight: 600; letter-spacing: -0.012em; max-width: 148mm; }
  .ds-methodology-lead { font-size: 10.6pt; line-height: 1.7; color: #1a2332; margin: 0 0 8mm; max-width: 152mm; font-style: italic; }
  .ds-methodology-list { margin: 0 0 8mm; padding: 0; }
  .ds-methodology-row { padding: 4mm 0; border-bottom: 0.15mm solid #f1f5f9; page-break-inside: avoid; display: grid; grid-template-columns: 42mm 1fr; gap: 6mm; }
  .ds-methodology-row:last-child { border-bottom: 0; }
  .ds-methodology-label { font-size: 9.4pt; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 580; letter-spacing: -0.005em; margin: 0; padding-top: 0.5mm; }
  .ds-methodology-body { font-size: 9.6pt; color: #1a2332; line-height: 1.65; margin: 0; }
  .ds-methodology-foot { font-size: 9.4pt; color: #64748b; line-height: 1.65; max-width: 152mm; font-style: italic; margin: 0; padding-top: 5mm; border-top: 0.2mm solid #e8edf2; }

  /* ── Closing strategic interpretation ────────────────────────────────
     The dossier's final block. A restrained, executive-grade summary —
     four eyebrow + body pairs and a serif headline above. Composed
     entirely in typography; sits on the final page after the action
     plan. No card, no rule, no tint. */
  .ds-closing { padding: 26mm 0 0; page-break-inside: avoid; }
  .ds-closing-eyebrow { font-size: 7.4pt; letter-spacing: 0.26em; text-transform: uppercase; color: #94a3b8; margin: 0 0 4.5mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-closing-title { font-size: 17pt; line-height: 1.24; margin: 0 0 11mm; color: #0f172a; font-weight: 600; letter-spacing: -0.014em; max-width: 144mm; }
  .ds-closing-row { margin: 0 0 7mm; max-width: 152mm; }
  .ds-closing-row:last-child { margin-bottom: 0; }
  .ds-closing-row-label { font-size: 7.2pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 0.8mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-closing-row-caption { font-size: 8.6pt; line-height: 1.45; color: #94a3b8; margin: 0 0 2.4mm; font-style: italic; font-family: "Source Serif 4", Georgia, serif; }
  .ds-closing-row-text { font-size: 10.4pt; line-height: 1.72; color: #1a2332; margin: 0; }

  /* ── Constraints ──────────────────────────────────────────────────────
     The two "warning" panels (yellow + red full-bleed) are eliminated.
     Each constraint is now an editorial block: small-caps eyebrow in tone
     colour, body in serif, hairline left rail. No background tint. */
  .ds-constraint {
    padding: 1mm 0 4mm 5mm;
    border-radius: 0;
    margin: 6mm 0 0;
    page-break-inside: avoid;
    background: transparent;
    border-left: 0.6mm solid #cbd5e1;
  }
  .ds-constraint-primary { border-left-color: #b45309; }
  .ds-constraint-risk { border-left-color: #b91c1c; }
  .ds-constraint-label { font-size: 7.6pt; letter-spacing: 0.22em; text-transform: uppercase; font-weight: 650; margin: 0 0 2.5mm; color: #94a3b8; }
  .ds-constraint-text { font-size: 10.5pt; line-height: 1.65; margin: 0; color: #1a2332; }

  .ds-weak-dims { margin: 7mm 0 0; padding: 0; list-style: none; }
  .ds-weak-dim {
    padding: 3mm 0;
    border: 0;
    display: flex;
    justify-content: space-between;
    gap: 6mm;
    font-size: 9.8pt;
    color: #1a2332;
  }
  .ds-weak-dim:last-child { padding-bottom: 0; }
  .ds-weak-dim strong { font-family: "Inter", system-ui, sans-serif; font-weight: 600; color: #0f172a; }

  /* ── Footer ───────────────────────────────────────────────────────────
     Single thin hairline, restrained body, no shouted brand colour. */
  .ds-footer { padding: 7mm 0 0; margin-top: 22mm; color: #94a3b8; font-size: 7.4pt; border-top: 0.2mm solid #eef1f5; font-family: "Inter", system-ui, sans-serif; letter-spacing: 0.06em; font-weight: 500; display: flex; align-items: center; gap: 3mm; }
  .ds-footer-mark { width: 4mm; height: 4mm; border-radius: 0.6mm; opacity: 0.8; flex-shrink: 0; object-fit: contain; }
  .ds-footer-text { flex: 1; }

  /* ── Executive visualisation primitives ───────────────────────────────
     Print-safe HTML visualisation set. Each block uses the existing
     restrained palette (slate, ink, soft accents). Emphasis is reserved
     for state-meaningful colour (amber for bottleneck; pillar accents
     for pillar identity). All bars are pure HTML/CSS — no SVG, no
     canvas, no JS. */

  /* Polish rule: every primitive thins its track, softens its markers,
     and reduces numerical bolding. The visuals now read as fine
     editorial bands rather than dashboard widgets. */

  /* Generic horizontal authority bar. Standard variant is hairline-thin
     for inline use; emphasis variant carries the cover/snapshot hero. */
  .ds-vbar { margin: 5mm 0 0; page-break-inside: avoid; }
  .ds-vbar-track { width: 100%; height: 2.4mm; background: #f1f5f9; border-radius: 1.2mm; overflow: hidden; }
  .ds-vbar-emphasis .ds-vbar-track { height: 3mm; border-radius: 1.5mm; }
  .ds-vbar-fill { height: 100%; border-radius: inherit; }
  .ds-vbar-value { font-size: 10.5pt; line-height: 1.2; color: #0f172a; margin: 2.8mm 0 0; font-family: "Inter", system-ui, sans-serif; font-weight: 580; letter-spacing: -0.008em; }
  .ds-vbar-of { font-size: 7.8pt; color: #cbd5e1; font-weight: 400; margin-left: 1mm; letter-spacing: 0; }
  .ds-vbar-label { font-size: 7.4pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 1.8mm 0 0; font-family: "Inter", system-ui, sans-serif; font-weight: 600; }

  /* Pillar balance strip — finer rows; label and value both read as
     editorial type, not dashboard chips. */
  .ds-vstrip { margin: 6mm 0 0; page-break-inside: avoid; max-width: 152mm; }
  .ds-vstrip-row { display: grid; grid-template-columns: 30mm 1fr 11mm; align-items: center; gap: 5mm; padding: 1.6mm 0; }
  .ds-vstrip-label { font-size: 8.6pt; font-family: "Inter", system-ui, sans-serif; font-weight: 540; letter-spacing: -0.002em; }
  .ds-vstrip-track { height: 1.6mm; background: #f1f5f9; border-radius: 0.8mm; overflow: hidden; }
  .ds-vstrip-fill { height: 100%; border-radius: inherit; }
  .ds-vstrip-value { font-size: 8.6pt; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 540; text-align: right; letter-spacing: -0.002em; }

  /* Maturity continuum — track halved, marker reduced; the stage
     labels now read as a typographic rhythm rather than chip badges. */
  .ds-vcontinuum { margin: 6mm 0 0; page-break-inside: avoid; max-width: 158mm; }
  .ds-vcontinuum-track { position: relative; height: 0.8mm; background: #e8edf2; border-radius: 0.4mm; overflow: visible; }
  .ds-vcontinuum-progress { height: 100%; background: #0f4c6b; border-radius: inherit; }
  .ds-vcontinuum-marker { position: absolute; top: 50%; transform: translate(-50%, -50%); width: 2.4mm; height: 2.4mm; background: #0f172a; border-radius: 50%; box-shadow: 0 0 0 1mm #fff; }
  .ds-vcontinuum-stages { display: grid; grid-template-columns: repeat(6, 1fr); gap: 1mm; margin: 4mm 0 0; }
  .ds-vcontinuum-stage { font-size: 6.8pt; letter-spacing: 0.08em; text-transform: uppercase; color: #cbd5e1; font-family: "Inter", system-ui, sans-serif; font-weight: 540; text-align: center; }
  .ds-vcontinuum-stage.is-passed { color: #94a3b8; }
  .ds-vcontinuum-stage.is-current { color: #0f172a; font-weight: 620; }

  /* AI surface spectrum — flatter band; the marker is a hair-thin rule
     rather than a heavy bar so the visual feels editorial. */
  .ds-vspectrum { margin: 5mm 0 6mm; page-break-inside: avoid; max-width: 158mm; }
  .ds-vspectrum-track { position: relative; display: grid; grid-template-columns: 1fr 1fr 1fr; height: 5.4mm; border-radius: 1mm; overflow: hidden; }
  .ds-vspectrum-zone { display: flex; align-items: center; justify-content: center; font-size: 6.8pt; letter-spacing: 0.18em; text-transform: uppercase; color: #475569; font-family: "Inter", system-ui, sans-serif; font-weight: 580; }
  .ds-vspectrum-zone.is-absent { background: #f5f7fa; }
  .ds-vspectrum-zone.is-retrievable { background: #e6edf3; }
  .ds-vspectrum-zone.is-cited { background: #dbe9dd; color: #047857; }
  .ds-vspectrum-marker { position: absolute; top: -1.2mm; bottom: -1.2mm; width: 0.5mm; background: #0f172a; transform: translateX(-50%); border-radius: 0.25mm; }
  .ds-vspectrum-meta { display: flex; justify-content: space-between; align-items: baseline; margin: 3mm 0 0; font-family: "Inter", system-ui, sans-serif; }
  .ds-vspectrum-meta span:first-child { font-size: 10.5pt; color: #0f172a; font-weight: 580; letter-spacing: -0.008em; }
  .ds-vspectrum-of { font-size: 7.8pt; color: #cbd5e1; font-weight: 400; margin-left: 1mm; }
  .ds-vspectrum-meta span:last-child { font-size: 7pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; font-weight: 600; }

  /* Bottleneck bar — emphasis preserved through the amber rate-limiter
     accent, but track height + score weight reduced so the block reads
     as editorial emphasis rather than alert UI. */
  .ds-vbottleneck { margin: 6mm 0 0; page-break-inside: avoid; max-width: 156mm; }
  .ds-vbottleneck-row { display: grid; grid-template-columns: 52mm 1fr 18mm; align-items: center; gap: 5mm; }
  .ds-vbottleneck-label { display: flex; flex-direction: column; gap: 0.8mm; }
  .ds-vbottleneck-eyebrow { font-size: 6.8pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; font-family: "Inter", system-ui, sans-serif; font-weight: 600; }
  .ds-vbottleneck-pillar { font-size: 10.8pt; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 580; letter-spacing: -0.008em; }
  .ds-vbottleneck-track { height: 3.2mm; background: #fdf6e3; border-radius: 1.6mm; overflow: hidden; }
  .ds-vbottleneck-fill { height: 100%; background: #b45309; border-radius: inherit; }
  .ds-vbottleneck-value { font-size: 12pt; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 600; text-align: right; letter-spacing: -0.012em; }
  .ds-vbottleneck-of { font-size: 7.6pt; color: #cbd5e1; font-weight: 400; margin-left: 0.8mm; }
  .ds-vbottleneck-note { font-size: 8.8pt; line-height: 1.55; color: #64748b; margin: 4mm 0 0; font-style: italic; max-width: 150mm; }

  /* Insufficient-signal hint — used when a visual primitive cannot resolve. */
  .ds-vinsufficient { font-size: 9pt; line-height: 1.55; color: #94a3b8; margin: 3mm 0 0; font-style: italic; }

  /* Evidence Anchor Row — compact horizontal strip used at the top of
     analytical sections so the reader registers density within seconds.
     Editorial: small eyebrow + tabular-num value pairs separated by
     intentional gutter, framed by hairline rules. */
  .ds-vanchor { display: flex; flex-wrap: wrap; gap: 4mm 8mm; margin: 4mm 0 0; padding: 3mm 0; border-top: 0.2mm solid #eef1f5; border-bottom: 0.2mm solid #eef1f5; page-break-inside: avoid; }
  .ds-vanchor-cell { display: flex; flex-direction: column; gap: 0.8mm; min-width: 22mm; font-family: "Inter", system-ui, sans-serif; }
  .ds-vanchor-label { font-size: 6.6pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; font-weight: 580; }
  .ds-vanchor-value { font-size: 11.5pt; color: #0f172a; font-weight: 580; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
  .ds-vanchor-cell.is-positive .ds-vanchor-value { color: #047857; }
  .ds-vanchor-cell.is-warn .ds-vanchor-value { color: #b45309; }
  .ds-vanchor-cell.is-risk .ds-vanchor-value { color: #b91c1c; }
  .ds-vanchor-cell.is-neutral .ds-vanchor-value { color: #475569; }

  /* Pillar deltas strip — compact movement row with directional arrows.
     Variation between sections: this strip introduces directional visual
     vocabulary that the editorial cadence otherwise lacks. */
  .ds-vdeltas { margin: 5mm 0 0; page-break-inside: avoid; max-width: 156mm; }
  .ds-vdeltas-eyebrow { font-size: 7pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 3mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-vdeltas-row { display: flex; flex-wrap: wrap; gap: 6mm 8mm; }
  .ds-vdeltas-pillar { display: flex; align-items: baseline; gap: 1.5mm; font-family: "Inter", system-ui, sans-serif; }
  .ds-vdeltas-name { font-size: 7.4pt; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600; }
  .ds-vdeltas-arrow { font-size: 11pt; line-height: 1; }
  .ds-vdeltas-pillar.is-up .ds-vdeltas-arrow { color: #047857; }
  .ds-vdeltas-pillar.is-down .ds-vdeltas-arrow { color: #b91c1c; }
  .ds-vdeltas-pillar.is-flat .ds-vdeltas-arrow { color: #94a3b8; }
  .ds-vdeltas-delta { font-size: 9pt; color: #0f172a; font-weight: 540; font-variant-numeric: tabular-nums; letter-spacing: -0.005em; }

  /* Editorial transition micro-line — used between Diagnosis and
     Execution. A single sentence in italics, centred-ish on the
     measure, framed by generous vertical breath. Replaces the visual
     gap between sections with a felt narrative beat. */
  .ds-transition { margin: 14mm 0 6mm; max-width: 138mm; padding: 0; page-break-inside: avoid; }
  .ds-transition-text { font-size: 11pt; line-height: 1.6; color: #475569; font-style: italic; margin: 0; font-family: "Source Serif 4", Georgia, serif; font-weight: 420; letter-spacing: -0.002em; }

  /* ── Brand Brief (snapshot identity texture) ──────────────────────────
     Surfaces canonical company-context fields: Offering / Positioning /
     Market / Differentiation. Editorial dl-list — labels in eyebrow
     style, values in serif body. No card chrome. */
  .ds-brandbrief { margin: 8mm 0 0; page-break-inside: avoid; max-width: 158mm; }
  .ds-brandbrief-eyebrow { font-size: 7.4pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 4mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-brandbrief-list { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm 8mm; margin: 0; padding: 0; }
  .ds-brandbrief-row { display: flex; flex-direction: column; gap: 1.2mm; min-width: 0; }
  .ds-brandbrief-label { font-size: 6.8pt; letter-spacing: 0.24em; text-transform: uppercase; color: #cbd5e1; font-weight: 580; font-family: "Inter", system-ui, sans-serif; margin: 0; }
  .ds-brandbrief-value { font-size: 9.6pt; line-height: 1.55; color: #1a2332; margin: 0; font-family: "Source Serif 4", Georgia, serif; }

  /* Strategic Posture — single-row labelled cells. */
  .ds-posture { margin: 6mm 0 0; page-break-inside: avoid; max-width: 158mm; }
  .ds-posture-eyebrow { font-size: 7.4pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 3mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-posture-row { display: flex; flex-wrap: wrap; gap: 5mm 9mm; }
  .ds-posture-cell { display: flex; flex-direction: column; gap: 0.8mm; min-width: 30mm; }
  .ds-posture-label { font-size: 6.8pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-posture-value { font-size: 9.4pt; line-height: 1.5; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 540; letter-spacing: -0.002em; }

  /* ── Strategic Position 4-State Cards (recovered from legacy) ─────────
     Four colored cards in a row carrying the strategic stance:
     What's Broken / Fix First / Delay / If Ignored. Visually punchy +
     state-meaningful colour without restoring SaaS dashboard chrome. */
  .ds-fourstate { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin: 6mm 0 0; page-break-inside: avoid; }
  .ds-fourstate-card { padding: 4mm 4mm 5mm 4mm; border-radius: 1mm; border-left: 0.6mm solid; min-height: 38mm; page-break-inside: avoid; }
  .ds-fourstate-card.is-broken { background: #eef4fb; border-left-color: #1e40af; }
  .ds-fourstate-card.is-fix { background: #ecf6ee; border-left-color: #047857; }
  .ds-fourstate-card.is-delay { background: #fdf6e3; border-left-color: #b45309; }
  .ds-fourstate-card.is-ignored { background: #fbeeee; border-left-color: #b91c1c; }
  .ds-fourstate-label { font-size: 7.4pt; letter-spacing: 0.22em; text-transform: uppercase; font-weight: 600; margin: 0 0 2.5mm; font-family: "Inter", system-ui, sans-serif; }
  .ds-fourstate-card.is-broken .ds-fourstate-label { color: #1e40af; }
  .ds-fourstate-card.is-fix .ds-fourstate-label { color: #047857; }
  .ds-fourstate-card.is-delay .ds-fourstate-label { color: #92400e; }
  .ds-fourstate-card.is-ignored .ds-fourstate-label { color: #991b1b; }
  .ds-fourstate-text { font-size: 9.4pt; line-height: 1.55; color: #1a2332; margin: 0; }

  /* ── Data Source Status Panels (6-panel grid, recovered from legacy) ───
     Replaces the thin 4-cell confidence matrix with rich per-source
     panels — each carrying state + current state + impact + what
     unlocks. State-tinted backgrounds keep it visual without becoming
     dashboard. */
  .ds-dsource-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin: 5mm 0 0; }
  .ds-dsource-panel { padding: 4mm 4mm 4.5mm 4mm; border-radius: 1mm; border-left: 0.5mm solid #cbd5e1; background: #f8fafc; page-break-inside: avoid; min-height: 36mm; }
  .ds-dsource-panel.is-connected { background: #ecf6ee; border-left-color: #047857; }
  .ds-dsource-panel.is-partial { background: #fdf6e3; border-left-color: #b45309; }
  .ds-dsource-panel.is-missing { background: #fbeeee; border-left-color: #b91c1c; }
  .ds-dsource-panel.is-disabled { background: #f5f7fa; border-left-color: #94a3b8; }
  .ds-dsource-header { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 2.5mm; gap: 3mm; }
  .ds-dsource-label { font-size: 7.4pt; letter-spacing: 0.22em; text-transform: uppercase; color: #475569; font-weight: 580; font-family: "Inter", system-ui, sans-serif; flex: 1; }
  .ds-dsource-status { font-size: 6.8pt; letter-spacing: 0.2em; text-transform: uppercase; padding: 0.6mm 2mm; border-radius: 99px; font-weight: 600; font-family: "Inter", system-ui, sans-serif; background: #fff; }
  .ds-dsource-panel.is-connected .ds-dsource-status { color: #047857; }
  .ds-dsource-panel.is-partial .ds-dsource-status { color: #92400e; }
  .ds-dsource-panel.is-missing .ds-dsource-status { color: #991b1b; }
  .ds-dsource-panel.is-disabled .ds-dsource-status { color: #475569; }
  .ds-dsource-row { margin: 1.6mm 0 0; }
  .ds-dsource-row-label { font-size: 6.4pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 580; margin: 0 0 0.6mm; font-family: "Inter", system-ui, sans-serif; }
  .ds-dsource-row-text { font-size: 8.6pt; line-height: 1.5; color: #1a2332; margin: 0; }
  .ds-dsource-summary { margin: 4mm 0 0; padding: 3mm 0 0; font-size: 8.4pt; color: #64748b; font-style: italic; border-top: 0.2mm solid #e8edf2; font-family: "Inter", system-ui, sans-serif; }

  /* ── Action Tactics list (recovered from legacy Action Plan) ──────────
     Each action card now carries a 2–3 bullet TACTICS list derived from
     the canonical action.timeline.short / .mid fields. Real data, more
     visual presence per action. */
  .ds-action-tactics { margin: 3mm 0 0; padding: 0; }
  .ds-action-tactics-label { font-size: 6.6pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 580; margin: 0 0 1.4mm; font-family: "Inter", system-ui, sans-serif; }
  .ds-action-tactics-list { list-style: none; margin: 0; padding: 0; }
  .ds-action-tactics-item { padding: 1.2mm 0 1.2mm 5mm; font-size: 8.8pt; line-height: 1.55; color: #475569; position: relative; }
  .ds-action-tactics-item:before { content: counter(tactic); counter-increment: tactic; position: absolute; left: 0; font-family: "Inter", system-ui, sans-serif; font-size: 7.4pt; color: #94a3b8; font-weight: 600; }
  .ds-action-tactics { counter-reset: tactic; }

  /* ── Competitor Matrix (recovered from legacy Digital Snapshot) ────────
     Editorial table — restrained hairlines, tabular numerals, peer/user
     row distinction via subtle weight, no SaaS admin chrome. */
  .ds-cmatrix { margin: 5mm 0 0; page-break-inside: avoid; max-width: 158mm; }
  .ds-cmatrix-table { width: 100%; border-collapse: collapse; font-family: "Inter", system-ui, sans-serif; }
  .ds-cmatrix-table th { font-size: 6.8pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 580; padding: 2.5mm 2mm; border-bottom: 0.2mm solid #e8edf2; text-align: right; }
  .ds-cmatrix-table th:first-child { text-align: left; }
  .ds-cmatrix-table td { font-size: 9pt; color: #1a2332; padding: 2.8mm 2mm; border-bottom: 0.15mm solid #f1f5f9; text-align: right; font-variant-numeric: tabular-nums; }
  .ds-cmatrix-table td:first-child { text-align: left; font-weight: 540; }
  .ds-cmatrix-table tr.is-user td { color: #0f4c6b; font-weight: 580; }
  .ds-cmatrix-table tr:last-child td { border-bottom: 0; }
  .ds-cmatrix-na { color: #cbd5e1; }

  /* Strongest Peer Gap callout — boxed strategic gap with Impact +
     Confidence chips, framed by amber left rail when peers ahead. */
  .ds-cgap { margin: 6mm 0 0; padding: 4mm 0 4mm 5mm; border-left: 0.6mm solid #b45309; page-break-inside: avoid; max-width: 156mm; }
  .ds-cgap.is-leading { border-left-color: #047857; }
  .ds-cgap-eyebrow { font-size: 7pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2.5mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-cgap-headline { font-size: 11.5pt; line-height: 1.4; color: #0f172a; margin: 0 0 3mm; font-weight: 580; letter-spacing: -0.005em; font-family: "Inter", system-ui, sans-serif; }
  .ds-cgap-why { font-size: 9.6pt; line-height: 1.65; color: #1a2332; margin: 0 0 3.5mm; }
  .ds-cgap-meta { display: flex; flex-wrap: wrap; gap: 2.5mm; align-items: baseline; font-family: "Inter", system-ui, sans-serif; }
  .ds-cgap-chip { display: inline-flex; gap: 1.2mm; align-items: baseline; font-size: 7.4pt; letter-spacing: 0.18em; text-transform: uppercase; padding: 0.8mm 2.2mm; border-radius: 99px; background: #f5f7fa; color: #475569; font-weight: 580; }
  .ds-cgap-chip strong { color: #0f172a; font-weight: 600; font-variant-numeric: tabular-nums; }
  .ds-cgap-led { font-size: 8.4pt; color: #64748b; margin-left: 2mm; }

  /* Competitor Benchmark bars — per-competitor average score row. */
  .ds-cbench { margin: 5mm 0 0; page-break-inside: avoid; max-width: 158mm; }
  .ds-cbench-row { display: grid; grid-template-columns: 30mm 1fr 12mm; align-items: center; gap: 4mm; padding: 2mm 0; border-bottom: 0.15mm solid #f1f5f9; }
  .ds-cbench-row:last-child { border-bottom: 0; }
  .ds-cbench-row.is-user { color: #0f4c6b; }
  .ds-cbench-name { font-size: 9pt; font-family: "Inter", system-ui, sans-serif; font-weight: 540; letter-spacing: -0.002em; }
  .ds-cbench-track { height: 1.6mm; background: #f1f5f9; border-radius: 0.8mm; overflow: hidden; }
  .ds-cbench-fill { height: 100%; background: #94a3b8; border-radius: inherit; }
  .ds-cbench-row.is-user .ds-cbench-fill { background: #0f4c6b; }
  .ds-cbench-value { font-size: 9pt; font-family: "Inter", system-ui, sans-serif; font-weight: 580; text-align: right; font-variant-numeric: tabular-nums; }

  /* Limiting Dimensions list — top-3 lowest dimensions with why. */
  .ds-vlimiting { margin: 6mm 0 0; page-break-inside: avoid; max-width: 156mm; }
  .ds-vlimiting-eyebrow { font-size: 7pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 3mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-vlimiting-row { display: grid; grid-template-columns: 50mm 1fr 14mm; align-items: baseline; gap: 4mm; padding: 2.4mm 0; border-bottom: 0.15mm solid #f1f5f9; }
  .ds-vlimiting-row:last-child { border-bottom: 0; }
  .ds-vlimiting-key { font-family: "Inter", system-ui, sans-serif; font-size: 9pt; color: #0f172a; font-weight: 540; }
  .ds-vlimiting-key small { font-size: 6.6pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 580; display: block; margin-bottom: 0.6mm; }
  .ds-vlimiting-why { font-size: 9pt; color: #475569; line-height: 1.55; }
  .ds-vlimiting-value { font-family: "Inter", system-ui, sans-serif; font-size: 11pt; color: #b45309; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; letter-spacing: -0.008em; }

  /* Fastest Lever callout — single editorial highlight. */
  .ds-vlever { margin: 7mm 0 0; padding: 4mm 5mm; background: #f0f8ff; border-left: 0.6mm solid #0f4c6b; page-break-inside: avoid; max-width: 156mm; }
  .ds-vlever-eyebrow { font-size: 7pt; letter-spacing: 0.24em; text-transform: uppercase; color: #0f4c6b; margin: 0 0 1.8mm; font-weight: 600; font-family: "Inter", system-ui, sans-serif; }
  .ds-vlever-text { font-size: 10pt; line-height: 1.65; color: #0f172a; margin: 0; font-family: "Inter", system-ui, sans-serif; font-weight: 460; }
  .ds-vlever-text strong { color: #0f4c6b; font-weight: 580; }

  /* Growth Path Directives — 3-line improvement map at maturity. */
  .ds-vgrowth { margin: 6mm 0 0; page-break-inside: avoid; max-width: 156mm; }
  .ds-vgrowth-eyebrow { font-size: 7pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2.5mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-vgrowth-bridge { font-size: 9.4pt; color: #475569; font-style: italic; margin: 0 0 3mm; font-family: "Inter", system-ui, sans-serif; }
  .ds-vgrowth-bridge strong { color: #0f172a; font-style: normal; font-weight: 580; }
  .ds-vgrowth-list { list-style: none; padding: 0; margin: 0; }
  .ds-vgrowth-item { padding: 2.2mm 0 2.2mm 5mm; border-left: 0.4mm solid #e8edf2; margin: 0 0 2mm; font-size: 9.6pt; line-height: 1.6; color: #1a2332; }
  .ds-vgrowth-item:last-child { margin-bottom: 0; }

  /* ── Execution Channel Mix (per-owner-area cards) ─────────────────────
     Restrained 2-column grid showing which canonical owner area carries
     which actions. Pillar pills retain their existing palette so the
     mix reads consistently with the rest of the dossier. */
  .ds-channelmix-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin: 6mm 0 0; }
  .ds-channelmix-card { padding: 4mm 4mm 5mm 4mm; border-radius: 1mm; background: #f8fafc; border-left: 0.5mm solid #cbd5e1; page-break-inside: avoid; min-height: 36mm; }
  .ds-channelmix-card.is-critical { border-left-color: #b45309; background: #fdf6e3; }
  .ds-channelmix-header { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 2.5mm; gap: 3mm; }
  .ds-channelmix-label { font-size: 9.6pt; color: #0f172a; font-weight: 580; letter-spacing: -0.005em; font-family: "Inter", system-ui, sans-serif; }
  .ds-channelmix-count { font-size: 7pt; letter-spacing: 0.22em; text-transform: uppercase; color: #64748b; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-channelmix-leading { font-size: 9pt; line-height: 1.55; color: #1a2332; margin: 0 0 2.5mm; font-family: "Inter", system-ui, sans-serif; font-weight: 540; }
  .ds-channelmix-unlocks { font-size: 8.6pt; line-height: 1.55; color: #475569; margin: 0 0 3mm; font-style: italic; }
  .ds-channelmix-pillars { display: flex; flex-wrap: wrap; gap: 1.5mm; }

  /* ── Snapshot Hero Score (recovered from legacy donut) ────────────────
     Big bold Authority Index number paired with stage / confidence /
     movement chips — gives the snapshot the visual anchor the legacy
     report carried. Editorial typography, no donut chrome. */
  .ds-herohead { display: grid; grid-template-columns: 60mm 1fr; gap: 8mm; align-items: center; margin: 4mm 0 9mm; padding: 6mm 0 7mm; border-top: 0.2mm solid #e8edf2; border-bottom: 0.2mm solid #e8edf2; page-break-inside: avoid; }
  .ds-herohead-score { display: flex; flex-direction: column; gap: 1mm; }
  .ds-herohead-value { font-size: 56pt; line-height: 1; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 660; letter-spacing: -0.032em; font-variant-numeric: tabular-nums; }
  .ds-herohead-of { font-size: 14pt; color: #cbd5e1; font-weight: 400; margin-left: 1.5mm; }
  .ds-herohead-label { font-size: 7.6pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; font-weight: 580; font-family: "Inter", system-ui, sans-serif; margin-top: 2mm; }
  .ds-herohead-meta { display: flex; flex-wrap: wrap; gap: 5mm 8mm; align-items: baseline; }
  .ds-herohead-cell { display: flex; flex-direction: column; gap: 0.6mm; font-family: "Inter", system-ui, sans-serif; min-width: 30mm; }
  .ds-herohead-cell-label { font-size: 6.6pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; font-weight: 580; }
  .ds-herohead-cell-value { font-size: 11pt; color: #0f172a; font-weight: 580; letter-spacing: -0.005em; }

  /* Competitor Pressure cards — recovered from legacy. Per-competitor
     pressure type with influence mix chips. */
  .ds-cpressure-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4mm; margin: 5mm 0 0; }
  .ds-cpressure-card { padding: 4mm 4mm 5mm 4mm; border-radius: 1mm; background: #f8fafc; border-left: 0.5mm solid #cbd5e1; page-break-inside: avoid; min-height: 50mm; }
  .ds-cpressure-card.is-authority { border-left-color: #4f46e5; background: #f5f3ff; }
  .ds-cpressure-card.is-discoverability { border-left-color: #047857; background: #ecfdf5; }
  .ds-cpressure-card.is-trust { border-left-color: #b45309; background: #fffbeb; }
  .ds-cpressure-card.is-foundation { border-left-color: #0369a1; background: #eff6ff; }
  .ds-cpressure-card.is-momentum { border-left-color: #be123c; background: #fff1f2; }
  .ds-cpressure-card.is-parity { border-left-color: #94a3b8; background: #f5f7fa; }
  .ds-cpressure-name { font-size: 11pt; color: #0f172a; font-weight: 600; letter-spacing: -0.008em; font-family: "Inter", system-ui, sans-serif; margin: 0 0 1.5mm; }
  .ds-cpressure-kind { font-size: 7pt; letter-spacing: 0.22em; text-transform: uppercase; font-weight: 600; margin: 0 0 3mm; font-family: "Inter", system-ui, sans-serif; }
  .ds-cpressure-card.is-authority .ds-cpressure-kind { color: #4f46e5; }
  .ds-cpressure-card.is-discoverability .ds-cpressure-kind { color: #047857; }
  .ds-cpressure-card.is-trust .ds-cpressure-kind { color: #b45309; }
  .ds-cpressure-card.is-foundation .ds-cpressure-kind { color: #0369a1; }
  .ds-cpressure-card.is-momentum .ds-cpressure-kind { color: #be123c; }
  .ds-cpressure-card.is-parity .ds-cpressure-kind { color: #475569; }
  .ds-cpressure-reading { font-size: 8.6pt; line-height: 1.55; color: #1a2332; margin: 0 0 3mm; }
  .ds-cpressure-mix { display: flex; flex-wrap: wrap; gap: 1.5mm; }
  .ds-cpressure-chip { font-size: 6.4pt; letter-spacing: 0.18em; text-transform: uppercase; padding: 0.5mm 1.8mm; border-radius: 99px; font-weight: 600; font-family: "Inter", system-ui, sans-serif; }
  .ds-cpressure-chip.is-high { background: #fff; color: #0f172a; }
  .ds-cpressure-chip.is-moderate { background: #f5f7fa; color: #475569; }
  .ds-cpressure-chip.is-low { background: #f8fafc; color: #94a3b8; }

  /* AI Trajectory directional headline. */
  .ds-aitrajectory { display: flex; align-items: baseline; gap: 3mm; font-family: "Inter", system-ui, sans-serif; margin: 4mm 0 0; }
  .ds-aitrajectory-arrow { font-size: 18pt; line-height: 1; }
  .ds-aitrajectory-delta { font-size: 16pt; color: #0f172a; font-weight: 600; letter-spacing: -0.018em; font-variant-numeric: tabular-nums; }
  .ds-aitrajectory-from { font-size: 8.6pt; color: #94a3b8; letter-spacing: 0.04em; }
  .ds-aitrajectory.is-up .ds-aitrajectory-arrow { color: #047857; }
  .ds-aitrajectory.is-down .ds-aitrajectory-arrow { color: #b91c1c; }
  .ds-aitrajectory.is-flat .ds-aitrajectory-arrow { color: #94a3b8; }

  /* ── AI Discoverability — 7-block narrative architecture ─────────────
     Block-level wrapper used to compose the rebuilt AI section into a
     felt narrative system rather than stacked sub-cards. Each block
     opens with a small block-number + block-title eyebrow line; the
     visualisations remain editorial (no dashboard chrome). */
  .ds-aiblock { margin: 11mm 0 0; page-break-inside: avoid; max-width: 158mm; }
  .ds-aiblock-eyebrow { font-size: 7.4pt; letter-spacing: 0.26em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-aiblock-title { font-size: 12.5pt; line-height: 1.3; color: #0f172a; margin: 0 0 4mm; font-weight: 580; letter-spacing: -0.012em; font-family: "Inter", system-ui, sans-serif; }
  .ds-aiblock-read { font-size: 10.4pt; line-height: 1.7; color: #1a2332; margin: 0; max-width: 152mm; }

  /* AI Visibility State diagnostic chips — three short readings inline. */
  .ds-aistate-chips { display: flex; flex-wrap: wrap; gap: 3mm 6mm; margin: 4mm 0 5mm; font-family: "Inter", system-ui, sans-serif; }
  .ds-aistate-chip { display: flex; flex-direction: column; gap: 1mm; min-width: 30mm; }
  .ds-aistate-chip-label { font-size: 6.8pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; font-weight: 580; }
  .ds-aistate-chip-value { font-size: 10.4pt; color: #0f172a; font-weight: 580; letter-spacing: -0.005em; }
  .ds-aistate-chip-detail { font-size: 8pt; color: #64748b; letter-spacing: 0; line-height: 1.3; }
  .ds-aistate-chip.is-on .ds-aistate-chip-value { color: #047857; }
  .ds-aistate-chip.is-warn .ds-aistate-chip-value { color: #b45309; }
  .ds-aistate-chip.is-off .ds-aistate-chip-value { color: #b91c1c; }

  /* AI Trust Coherence kind chip — single inline status word. */
  .ds-aitrust-row { display: flex; align-items: baseline; gap: 4mm; flex-wrap: wrap; margin: 3mm 0 4mm; font-family: "Inter", system-ui, sans-serif; }
  .ds-aitrust-kind { font-size: 11.5pt; color: #0f172a; font-weight: 600; letter-spacing: -0.008em; }
  .ds-aitrust-kind.is-consistent { color: #047857; }
  .ds-aitrust-kind.is-fragmented { color: #b91c1c; }
  .ds-aitrust-kind.is-sparse { color: #94a3b8; }
  .ds-aitrust-kind.is-weak { color: #b45309; }
  .ds-aitrust-signals { font-size: 8.6pt; color: #64748b; letter-spacing: 0.04em; }

  /* AI Retrieval Examples — compact provider × query class anchors with
     status indicators. Editorial list, not a table. */
  .ds-aiexamples { margin: 4mm 0 0; }
  .ds-aiexample { display: grid; grid-template-columns: 38mm 1fr 12mm; align-items: baseline; gap: 4mm; padding: 2.4mm 0; border-bottom: 0.15mm solid #f1f5f9; }
  .ds-aiexample:last-child { border-bottom: 0; }
  .ds-aiexample-key { font-family: "Inter", system-ui, sans-serif; font-size: 8.8pt; color: #0f172a; font-weight: 540; letter-spacing: -0.002em; }
  .ds-aiexample-key small { font-size: 6.6pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; font-weight: 580; display: block; margin-bottom: 0.6mm; }
  .ds-aiexample-note { font-size: 9pt; color: #1a2332; line-height: 1.55; }
  .ds-aiexample-rate { font-family: "Inter", system-ui, sans-serif; font-size: 9pt; color: #0f172a; font-weight: 580; text-align: right; font-variant-numeric: tabular-nums; }
  .ds-aiexample.is-cited .ds-aiexample-rate { color: #047857; }
  .ds-aiexample.is-absent .ds-aiexample-rate { color: #b91c1c; }
  .ds-aiexample.is-partial .ds-aiexample-rate { color: #b45309; }

  /* AI Strategic Unlock — the closing block of the AI section. Carries
     extra editorial weight via larger eyebrow + concept-named headline,
     anchoring one memorable sentence in the reader's mind. */
  .ds-aiunlock { margin: 14mm 0 0; padding: 8mm 0 0; border-top: 0.2mm solid #e8edf2; page-break-inside: avoid; max-width: 158mm; }
  .ds-aiunlock-eyebrow { font-size: 7.4pt; letter-spacing: 0.28em; text-transform: uppercase; color: #94a3b8; margin: 0 0 3mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-aiunlock-concept { font-size: 8pt; letter-spacing: 0.22em; text-transform: uppercase; color: #0f4c6b; margin: 0 0 3mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-aiunlock-headline { font-size: 14.5pt; line-height: 1.35; color: #0f172a; margin: 0 0 4mm; font-weight: 540; letter-spacing: -0.014em; font-family: "Source Serif 4", Georgia, serif; max-width: 148mm; }
  .ds-aiunlock-why { font-size: 9.8pt; line-height: 1.65; color: #475569; margin: 0; max-width: 148mm; }

  /* Positioning band — peer-comparison strip. Two ticks (median +
     top-quartile) and a brand marker on a single horizontal track. */
  .ds-vposition { margin: 5mm 0 0; page-break-inside: avoid; max-width: 156mm; }
  .ds-vposition-track { position: relative; height: 2mm; background: linear-gradient(90deg, #f1f5f9 0%, #e8edf2 50%, #dbe5ee 100%); border-radius: 1mm; overflow: visible; }
  .ds-vposition-tick { position: absolute; top: -1.5mm; bottom: -1.5mm; width: 0.4mm; background: #94a3b8; transform: translateX(-50%); border-radius: 0.2mm; }
  .ds-vposition-tick.is-top { background: #cbd5e1; }
  .ds-vposition-marker { position: absolute; top: 50%; transform: translate(-50%, -50%); width: 2.4mm; height: 2.4mm; background: #0f4c6b; border-radius: 50%; box-shadow: 0 0 0 0.8mm #fff; }
  .ds-vposition-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 1.5mm; margin: 4mm 0 0; font-family: "Inter", system-ui, sans-serif; }
  .ds-vposition-meta-label { font-size: 6.8pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 580; }
  .ds-vposition-meta-value { font-size: 9.5pt; color: #0f172a; font-weight: 580; letter-spacing: -0.005em; font-variant-numeric: tabular-nums; }
  .ds-vposition-meta-divider { color: #cbd5e1; font-size: 9pt; }
  .ds-vposition-note { font-size: 9pt; line-height: 1.6; color: #475569; margin: 4mm 0 0; max-width: 152mm; }

  /* Trajectory spark — vertical bars showing historical authority. */
  .ds-vspark { margin: 5mm 0 0; page-break-inside: avoid; max-width: 156mm; }
  .ds-vspark-track { display: flex; align-items: flex-end; gap: 1.2mm; height: 18mm; padding: 0; }
  .ds-vspark-bar { flex: 1; min-width: 0; max-width: 4mm; background: #cbd5e1; border-radius: 0.4mm 0.4mm 0 0; }
  .ds-vspark-bar.is-current { background: #0f4c6b; }
  .ds-vspark-note { font-size: 9pt; line-height: 1.55; color: #475569; margin: 3.5mm 0 0; font-style: italic; max-width: 150mm; }

  /* Confidence matrix — 4-cell summary of evidence states. Restrained
     palette; no heavy backgrounds; cell numbers carry the weight. */
  .ds-vconfidence { margin: 5mm 0 0; page-break-inside: avoid; max-width: 156mm; }
  .ds-vconfidence-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; }
  .ds-vconfidence-cell { padding: 4mm 4mm 4mm 0; border-left: 0.4mm solid #e8edf2; padding-left: 5mm; display: flex; flex-direction: column; gap: 1.5mm; }
  .ds-vconfidence-cell:first-child { border-left: 0; padding-left: 0; }
  .ds-vconfidence-value { font-size: 18pt; line-height: 1; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 580; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .ds-vconfidence-label { font-size: 7.2pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-family: "Inter", system-ui, sans-serif; font-weight: 580; }
  .ds-vconfidence-measured .ds-vconfidence-value { color: #0f172a; }
  .ds-vconfidence-inferred .ds-vconfidence-value { color: #475569; }
  .ds-vconfidence-insufficient .ds-vconfidence-value { color: #94a3b8; }
  .ds-vconfidence-unavailable .ds-vconfidence-value { color: #cbd5e1; }
  .ds-vconfidence-note { font-size: 8.6pt; line-height: 1.55; color: #64748b; margin: 4mm 0 0; font-style: italic; }

  /* Dimension row — pillar-tagged compact dimension bar. Used in the
     Dimension Breakdown grouped under each pillar header. */
  .ds-vdim-row { display: grid; grid-template-columns: 26mm 1fr 30mm 9mm; align-items: center; gap: 4mm; padding: 1.5mm 0; }
  .ds-vdim-tag { font-size: 6.6pt; letter-spacing: 0.22em; text-transform: uppercase; font-family: "Inter", system-ui, sans-serif; font-weight: 580; }
  .ds-vdim-label { font-size: 9pt; color: #1a2332; font-family: "Inter", system-ui, sans-serif; font-weight: 480; letter-spacing: -0.002em; }
  .ds-vdim-track { height: 1.4mm; background: #f1f5f9; border-radius: 0.7mm; overflow: hidden; }
  .ds-vdim-fill { height: 100%; border-radius: inherit; }
  .ds-vdim-value { font-size: 8.6pt; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 540; text-align: right; font-variant-numeric: tabular-nums; }

  /* Intelligence surface block — section sub-header + body group used
     for Score Drivers, Channel Leverage, Execution Window. */
  .ds-isurface { margin: 9mm 0 0; page-break-inside: avoid; max-width: 156mm; }
  .ds-isurface-eyebrow { font-size: 7.2pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 3.5mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-isurface-read { font-size: 10.4pt; line-height: 1.7; color: #1a2332; margin: 0 0 5mm; max-width: 152mm; }
  .ds-isurface-rows { margin: 0; padding: 0; list-style: none; }
  .ds-isurface-row { padding: 3mm 0; border-bottom: 0.15mm solid #f1f5f9; display: grid; grid-template-columns: 38mm 1fr; gap: 5mm; align-items: baseline; }
  .ds-isurface-row:last-child { border-bottom: 0; }
  .ds-isurface-row-key { font-size: 9pt; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 540; letter-spacing: -0.002em; }
  .ds-isurface-row-key small { font-size: 7pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 580; display: block; margin-bottom: 1mm; }
  .ds-isurface-row-text { font-size: 9.6pt; line-height: 1.6; color: #1a2332; }

  /* Pillar group header inside Dimension Breakdown. */
  .ds-vdim-group { margin: 6mm 0 0; page-break-inside: avoid; }
  .ds-vdim-group-header { margin: 0 0 2mm; }
  .ds-vdim-group-name { font-size: 9.6pt; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 580; letter-spacing: -0.005em; margin: 0 0 1mm; }
  .ds-vdim-group-read { font-size: 8.8pt; color: #64748b; font-style: italic; margin: 0 0 3mm; max-width: 150mm; }

  /* Execution window — horizon row treatment. */
  .ds-execwin-horizon { margin: 5mm 0 4mm; }
  .ds-execwin-horizon-label { font-size: 7.4pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-execwin-action { padding: 2.5mm 0 2.5mm 5mm; border-left: 0.4mm solid #e8edf2; margin: 0 0 3mm; page-break-inside: avoid; }
  .ds-execwin-action.is-critical { border-left-color: #b45309; }
  .ds-execwin-action-title { font-size: 9.6pt; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 540; margin: 0 0 1.2mm; letter-spacing: -0.002em; }
  .ds-execwin-action-meta { font-size: 7.4pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-family: "Inter", system-ui, sans-serif; font-weight: 580; }
  .ds-execwin-action-outcome { font-size: 8.8pt; line-height: 1.55; color: #475569; margin: 1.5mm 0 0; }

  /* ── Brand presence ───────────────────────────────────────────────────
     Restrained company-aware identity. The logo (when present) sits as a
     subtle mark above the company name on the cover. The footer carries
     the company name across every interior page so the dossier reads as
     written for this brand specifically. */
  .ds-cover-logo { margin: 0 0 4mm; max-height: 14mm; max-width: 50mm; display: block; }
  .ds-cover-logo[data-fallback="true"] { display: none; }
  .ds-cover-accent { width: 60mm; height: 0.4mm; background: linear-gradient(90deg, #0f4c6b, rgba(15, 76, 107, 0)); margin: 6mm 0 0; }

  /* ── Print rules (unchanged) ───────────────────────────────────────── */
  @media print {
    .ds-section { page-break-inside: auto; }
    .ds-insight, .ds-pillar, .ds-action, .ds-storyline-item, .ds-playbook-group, .ds-constraint, .ds-maturity, .ds-ai-hero, .ds-hero-score-row, .ds-signal, .ds-direction, .ds-evidence-bar, .ds-constraint-narrative, .ds-pattern, .ds-authority-shape-block, .ds-maturity-evolution, .ds-momentum-shape, .ds-closing, .ds-vbar, .ds-vstrip, .ds-vcontinuum, .ds-vspectrum, .ds-vbottleneck, .ds-vposition, .ds-vspark, .ds-vconfidence, .ds-vdim-group, .ds-isurface, .ds-execwin-action, .ds-brandbrief, .ds-posture, .ds-aitrajectory, .ds-aiblock, .ds-aiunlock, .ds-aiexample, .ds-vanchor, .ds-cmatrix, .ds-cgap, .ds-cbench, .ds-vlimiting, .ds-vlever, .ds-vgrowth, .ds-methodology-row, .ds-fourstate-card, .ds-dsource-panel, .ds-channelmix-card, .ds-herohead, .ds-cpressure-card { page-break-inside: avoid; }
    .ds-cover { page-break-after: always; }
    .ds-snapshot { page-break-after: always; }
    .ds-section { page-break-before: auto; }
    h1, h2, h3 { page-break-after: avoid; }
  }
`;

// ── Section renderers ────────────────────────────────────────────────────────



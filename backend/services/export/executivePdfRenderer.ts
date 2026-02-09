import PDFDocument from 'pdfkit';
import type { ExecutiveSummary } from '../networkIntelligence/executiveSummaryService';
import type { ExecutiveNarrativeOutput } from '../networkIntelligence/executiveNarrativeService';
import type { PlaybookEffectivenessMetrics } from '../networkIntelligence/playbookEffectivenessService';

type ExecutivePdfInput = {
  organizationName: string;
  summary: ExecutiveSummary;
  playbookPerformance: PlaybookEffectivenessMetrics[];
  narrative: ExecutiveNarrativeOutput;
  generatedAt: Date;
};

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

const formatTimestamp = (value: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};

const resolveMomentum = (lastActivityAt: string | null) => {
  if (!lastActivityAt) return 'No recent activity detected.';
  const lastDate = new Date(lastActivityAt);
  if (Number.isNaN(lastDate.getTime())) return 'No recent activity detected.';
  const daysSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince <= 7) return 'Network activity is increasing over the last 7 days.';
  if (daysSince <= 14) return 'Network activity is stable over the last 14 days.';
  if (daysSince <= 30) return 'Network activity is slowing over the last 30 days.';
  return 'Network activity is slowing; no recent momentum.';
};

const buildTopPlatform = (row: PlaybookEffectivenessMetrics) =>
  row.top_platforms?.[0]?.platform || '—';

export const renderExecutiveSummaryPdf = async (input: ExecutivePdfInput) => {
  const doc = new PDFDocument({ margin: 48, size: 'LETTER' });
  const chunks: Buffer[] = [];

  const bufferPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const ensureSpace = (height: number) => {
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
  };

  const sectionTitle = (title: string) => {
    ensureSpace(24);
    doc.moveDown(0.5);
    doc.fontSize(14).fillColor('#111827').text(title);
    doc.moveDown(0.2);
  };

  const addLine = (label: string, value: string) => {
    ensureSpace(16);
    doc.fontSize(10).fillColor('#374151').text(`${label}: ${value}`);
  };

  const addList = (items: string[]) => {
    if (items.length === 0) {
      addLine('Notes', '—');
      return;
    }
    items.forEach((item) => {
      ensureSpace(14);
      doc.fontSize(10).fillColor('#374151').text(`• ${item}`);
    });
  };

  doc.fontSize(18).fillColor('#111827').text(input.organizationName);
  doc.fontSize(16).text('Community-AI Executive Summary');
  doc.fontSize(10).fillColor('#6b7280').text(input.generatedAt.toLocaleDateString());
  doc.moveDown();

  sectionTitle('Executive Interpretation');
  addLine('Notice', 'Interpretation only — not an execution directive');
  addLine('Overview', input.narrative.overview || '—');
  sectionTitle('Key Shifts');
  addList(input.narrative.key_shifts);
  sectionTitle('Risks to Watch');
  addList(input.narrative.risks_to_watch);
  sectionTitle('What NOT to Change Yet');
  addList(input.narrative.explicitly_not_recommended);
  sectionTitle('Confidence Indicator');
  addLine('Confidence', formatPercent(input.narrative.confidence_level || 0));

  sectionTitle('Executive Snapshot');
  addLine('Total discovered users', String(input.summary.total_discovered_users));
  addLine('Eligibility rate', formatPercent(input.summary.eligibility_rate));
  addLine('Execution rate', formatPercent(input.summary.execution_rate));
  addLine(
    'Automation mix',
    `Observe ${formatPercent(input.summary.automation_mix.observe)}, Assist ${formatPercent(
      input.summary.automation_mix.assist
    )}, Automate ${formatPercent(input.summary.automation_mix.automate)}`
  );
  addLine('Last activity', formatTimestamp(input.summary.last_activity_at));

  sectionTitle('Network Health');
  addLine('Eligible users', String(input.summary.total_eligible_users));
  addLine(
    'Ineligible users',
    String(input.summary.total_discovered_users - input.summary.total_eligible_users)
  );
  addLine('Eligibility rate', formatPercent(input.summary.eligibility_rate));

  sectionTitle('Playbook Performance');
  const headers = [
    'Playbook',
    'Automation',
    'Discovered',
    'Eligible',
    'Exec Rate',
    'Top Platform',
  ];
  const columnWidths = [160, 80, 70, 60, 60, 100];
  const startX = doc.x;
  ensureSpace(18);
  doc.fontSize(9).fillColor('#6b7280');
  headers.forEach((header, index) => {
    doc.text(header, startX + columnWidths.slice(0, index).reduce((a, b) => a + b, 0), doc.y, {
      width: columnWidths[index],
      continued: false,
    });
  });
  doc.moveDown(0.5);
  doc.fillColor('#374151');

  const rows = [...input.playbookPerformance].sort(
    (a, b) => b.eligible_users_count - a.eligible_users_count
  );
  const maxRows = 30;
  rows.slice(0, maxRows).forEach((row) => {
    ensureSpace(16);
    const values = [
      row.playbook_name,
      row.automation_level,
      String(row.discovered_users_count),
      String(row.eligible_users_count),
      formatPercent(row.execution_rate),
      buildTopPlatform(row),
    ];
    values.forEach((value, index) => {
      doc.text(
        value,
        startX + columnWidths.slice(0, index).reduce((a, b) => a + b, 0),
        doc.y,
        {
          width: columnWidths[index],
        }
      );
    });
    doc.moveDown(0.3);
  });
  if (rows.length > maxRows) {
    ensureSpace(16);
    doc.fillColor('#6b7280').text(`Truncated to ${maxRows} rows.`);
    doc.fillColor('#374151');
  }

  sectionTitle('Platform Mix');
  input.summary.platform_mix.forEach((row) => {
    addLine(
      row.platform,
      `${row.discovered_users} (${formatPercent(row.share)})`
    );
  });

  sectionTitle('Recent Momentum');
  addLine('Summary', resolveMomentum(input.summary.last_activity_at));

  doc.moveDown(1.5);
  doc.fontSize(9).fillColor('#9ca3af').text('Generated by Community-AI');

  doc.end();
  return bufferPromise;
};

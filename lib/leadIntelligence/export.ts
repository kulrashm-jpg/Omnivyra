/**
 * Repository-backed export rows + serializers (CSV + Excel SpreadsheetML).
 *
 * Pure: a unified `CanonicalLeadView` (+ optional enrichments) → one flat export
 * row, then to CSV or Excel-openable XML. No source-specific logic, no dependency.
 */

import type { CanonicalLeadView } from './types';
import { recommendNextAction, summarizeLead } from './recommendations';

export interface LeadExportRow {
  identity: string;
  company: string;
  source: string;
  campaign: string;
  journey: string;
  timeline_summary: string;
  buying_intent: string;
  content_interests: string;
  recommended_next_action: string;
  ai_summary: string;
  status: string;
  metadata: string;
}

const s = (v: unknown): string => (v == null ? '' : String(v));
const intentOf = (v: CanonicalLeadView): number => v.scores.intent ?? v.scores.total ?? 0;

export function toExportRow(view: CanonicalLeadView, extras?: { timelineSummary?: string; contentInterests?: string[] }): LeadExportRow {
  const meta = view.attribution.sourceMetadata ?? {};
  return {
    identity: s(view.identity.email ?? view.identity.phone ?? view.identity.platform ?? view.unifiedPersonId),
    company: s(meta.company_name ?? meta.company ?? view.organizationId),
    source: s(view.sourceLabel),
    campaign: s(view.campaign),
    journey: s(view.attribution.originalSource ? `${view.attribution.originalSource} → ${view.source}` : view.source),
    timeline_summary: s(extras?.timelineSummary ?? view.occurredAt),
    buying_intent: `${Math.round(intentOf(view) * 100)}%`,
    content_interests: s((extras?.contentInterests ?? []).join('; ') || view.content),
    recommended_next_action: recommendNextAction(view),
    ai_summary: summarizeLead(view),
    status: s(view.status),
    metadata: JSON.stringify(meta),
  };
}

const COLUMNS: Array<keyof LeadExportRow> = [
  'identity', 'company', 'source', 'campaign', 'journey', 'timeline_summary',
  'buying_intent', 'content_interests', 'recommended_next_action', 'ai_summary', 'status', 'metadata',
];

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: LeadExportRow[]): string {
  const header = COLUMNS.join(',');
  const body = rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(',')).join('\n');
  return `${header}\n${body}`;
}

function xmlEscape(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Excel-openable SpreadsheetML 2003 (no dependency). */
export function toExcelXml(rows: LeadExportRow[]): string {
  const cell = (v: string) => `<Cell><Data ss:Type="String">${xmlEscape(v)}</Data></Cell>`;
  const headerRow = `<Row>${COLUMNS.map((c) => cell(c)).join('')}</Row>`;
  const dataRows = rows.map((r) => `<Row>${COLUMNS.map((c) => cell(r[c])).join('')}</Row>`).join('');
  return `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
    `<Worksheet ss:Name="Leads"><Table>${headerRow}${dataRows}</Table></Worksheet></Workbook>`;
}

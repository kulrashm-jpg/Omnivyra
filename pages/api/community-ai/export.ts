import type { NextApiRequest, NextApiResponse } from 'next';
import PDFDocument from 'pdfkit';
import { getProfile } from '../../../backend/services/companyProfileService';
import { COMMUNITY_AI_CAPABILITIES } from '../../../backend/services/rbac/communityAiCapabilities';
import { enforceActionRole, requireTenantScope } from './utils';
import contentKpisHandler from './content-kpis';
import trendsHandler from './trends';
import insightsHandler from './insights';

type ExportType = 'kpis' | 'trends' | 'insights' | 'full-report';
type ExportFormat = 'pdf' | 'csv';

const createMockRes = () => {
  let statusCode = 200;
  let jsonBody: any = null;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: any) {
      jsonBody = payload;
      return res;
    },
    get data() {
      return jsonBody;
    },
    get statusCode() {
      return statusCode;
    },
  };
  return res;
};

const runHandler = async (handler: any, req: NextApiRequest) => {
  const res = createMockRes();
  await handler(req, res);
  if (res.statusCode >= 400) {
    throw new Error(res.data?.error || 'FAILED_TO_BUILD_EXPORT');
  }
  return res.data;
};

const toCsv = (data: {
  kpis?: any;
  trends?: any;
  anomalies?: any;
  insights?: any;
  type: ExportType;
}) => {
  const lines: string[] = [];
  const pushSection = (title: string) => {
    lines.push('');
    lines.push(title);
  };

  if (data.type === 'kpis' || data.type === 'full-report') {
    pushSection('KPIs by Platform');
    lines.push('platform,total_posts,avg_likes,avg_comments,avg_shares,goal_hit_rate,underperforming_count');
    (data.kpis?.by_platform || []).forEach((row: any) => {
      lines.push(
        [
          row.platform,
          row.total_posts,
          row.avg_likes,
          row.avg_comments,
          row.avg_shares,
          row.goal_hit_rate,
          row.underperforming_count,
        ].join(',')
      );
    });

    pushSection('KPIs by Content Type');
    lines.push('content_type,total_posts,avg_engagement,goal_hit_rate');
    (data.kpis?.by_content_type || []).forEach((row: any) => {
      lines.push([row.content_type, row.total_posts, row.avg_engagement, row.goal_hit_rate].join(','));
    });
  }

  if (data.type === 'trends' || data.type === 'full-report') {
    pushSection('Trends');
    lines.push('platform,content_type,metric,previous_avg,current_avg,delta_percent,trend');
    (data.trends || []).forEach((row: any) => {
      lines.push(
        [
          row.platform,
          row.content_type,
          row.metric,
          row.previous_avg,
          row.current_avg,
          row.delta_percent,
          row.trend,
        ].join(',')
      );
    });

    pushSection('Anomalies');
    lines.push('post_id,platform,content_type,metric,value,severity,reason');
    (data.anomalies || []).forEach((row: any) => {
      lines.push(
        [row.post_id, row.platform, row.content_type, row.metric, row.value, row.severity, row.reason].join(',')
      );
    });
  }

  if (data.type === 'insights' || data.type === 'full-report') {
    pushSection('AI Insights Summary');
    lines.push(`summary_insight,${JSON.stringify(data.insights?.summary_insight || '')}`);
    lines.push(`confidence_level,${data.insights?.confidence_level ?? 0}`);
    pushSection('Key Findings');
    (data.insights?.key_findings || []).forEach((item: any) => {
      lines.push(JSON.stringify(item));
    });
    pushSection('Recommended Actions');
    (data.insights?.recommended_actions || []).forEach((item: any) => {
      lines.push(JSON.stringify(item));
    });
  }

  return lines.filter((line) => line !== '').join('\n');
};

const fetchLogoBuffer = async (logoUrl?: string | null): Promise<Buffer | null> => {
  if (!logoUrl) return null;
  if (!/^https?:\/\//i.test(logoUrl)) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(logoUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
};

const renderPdf = async (
  res: NextApiResponse,
  data: {
    kpis?: any;
    trends?: any;
    anomalies?: any;
    insights?: any;
    type: ExportType;
  },
  options: {
    organizationId: string;
    companyName?: string | null;
    logoUrl?: string | null;
  }
) => {
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);
  const footerHeight = 24;
  let pageNumber = 0;
  const generatedAt = new Date().toISOString();
  const logoBuffer = await fetchLogoBuffer(options.logoUrl || null);

  const renderFooter = () => {
    const bottomY = doc.page.height - doc.page.margins.bottom + 6;
    doc
      .fontSize(8)
      .fillColor('#6B7280')
      .text(`Page ${pageNumber}`, doc.page.margins.left, bottomY, {
        align: 'left',
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      })
      .text('Generated by Community-AI', doc.page.margins.left, bottomY, {
        align: 'right',
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      });
    doc.fillColor('#111827');
  };

  const renderHeader = () => {
    const left = doc.page.margins.left;
    const top = doc.page.margins.top;
    const right = doc.page.width - doc.page.margins.right;
    const headerHeight = 52;

    if (logoBuffer) {
      try {
        doc.image(logoBuffer, left, top, { fit: [36, 36] });
      } catch {
        // Ignore logo rendering failures
      }
    }

    const textX = logoBuffer ? left + 46 : left;
    doc.fontSize(16).fillColor('#111827').text('Community-AI Engagement Report', textX, top);
    const companyLine = options.companyName
      ? `Organization: ${options.companyName}`
      : `Organization: ${options.organizationId}`;
    doc.fontSize(10).fillColor('#6B7280').text(companyLine, textX, top + 20);
    doc.fontSize(9).fillColor('#6B7280').text(`Generated: ${generatedAt}`, textX, top + 34);
    doc
      .moveTo(left, top + headerHeight)
      .lineTo(right, top + headerHeight)
      .strokeColor('#E5E7EB')
      .stroke();
    doc.fillColor('#111827');
    doc.y = top + headerHeight + 12;
  };

  let hasPage = false;
  const addPageWithHeader = () => {
    if (hasPage) {
      renderFooter();
      doc.addPage();
    } else {
      hasPage = true;
    }
    pageNumber += 1;
    renderHeader();
  };

  const ensureSpace = (height: number) => {
    const bottomLimit = doc.page.height - doc.page.margins.bottom - footerHeight;
    if (doc.y + height > bottomLimit) {
      addPageWithHeader();
    }
  };

  const drawTable = (columns: string[], rows: Array<Array<string | number>>) => {
    const startX = doc.page.margins.left;
    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const columnWidths = columns.map(() => tableWidth / columns.length);
    const rowHeight = 18;
    const headerHeight = 20;

    const drawRow = (values: Array<string | number>, y: number, isHeader: boolean) => {
      values.forEach((value, index) => {
        const x = startX + columnWidths.slice(0, index).reduce((sum, w) => sum + w, 0);
        const text = value === null || value === undefined ? '' : String(value);
        if (isHeader) {
          doc.rect(x, y, columnWidths[index], headerHeight).fill('#F3F4F6');
          doc.fillColor('#111827').fontSize(9).text(text, x + 4, y + 5, {
            width: columnWidths[index] - 8,
            align: 'left',
          });
        } else {
          doc.fillColor('#111827').fontSize(9).text(text, x + 4, y + 4, {
            width: columnWidths[index] - 8,
            align: 'left',
          });
        }
        doc
          .rect(x, y, columnWidths[index], isHeader ? headerHeight : rowHeight)
          .strokeColor('#E5E7EB')
          .stroke();
      });
      doc.fillColor('#111827');
    };

    ensureSpace(headerHeight + 4);
    drawRow(columns, doc.y, true);
    doc.y += headerHeight;

    rows.forEach((row) => {
      ensureSpace(rowHeight + 2);
      drawRow(row, doc.y, false);
      doc.y += rowHeight;
    });
    doc.moveDown();
  };

  const startSection = (title: string) => {
    addPageWithHeader();
    doc.fontSize(13).fillColor('#111827').text(title);
    doc.moveDown(0.5);
  };

  if (data.type === 'kpis' || data.type === 'full-report') {
    startSection('KPIs');
    drawTable(
      ['Platform', 'Total Posts', 'Avg Likes', 'Avg Comments', 'Avg Shares', 'Goal Hit Rate', 'Underperforming'],
      (data.kpis?.by_platform || []).map((row: any) => [
        row.platform,
        row.total_posts,
        row.avg_likes,
        row.avg_comments,
        row.avg_shares,
        `${row.goal_hit_rate}%`,
        row.underperforming_count,
      ])
    );
  }

  if (data.type === 'trends' || data.type === 'full-report') {
    startSection('Trends');
    drawTable(
      ['Platform', 'Content Type', 'Metric', 'Previous Avg', 'Current Avg', 'Delta %', 'Trend'],
      (data.trends || []).map((row: any) => [
        row.platform,
        row.content_type,
        row.metric,
        row.previous_avg,
        row.current_avg,
        `${row.delta_percent}%`,
        row.trend,
      ])
    );

    startSection('Anomalies');
    drawTable(
      ['Post ID', 'Platform', 'Metric', 'Value', 'Expected Range', 'Severity', 'Reason'],
      (data.anomalies || []).map((row: any) => [
        row.post_id,
        row.platform,
        row.metric,
        row.value,
        row.expected_range ? `${row.expected_range.min}-${row.expected_range.max}` : '',
        row.severity,
        row.reason,
      ])
    );
  }

  if (data.type === 'insights' || data.type === 'full-report') {
    startSection('AI Insights');
    ensureSpace(80);
    doc.fontSize(10).text(data.insights?.summary_insight || '—');
    doc.moveDown();
    doc.fontSize(10).text('Key Findings');
    (data.insights?.key_findings || []).forEach((item: any) => {
      doc.fontSize(9).text(`• ${typeof item === 'string' ? item : JSON.stringify(item)}`);
    });
    doc.moveDown();
    doc.fontSize(10).text('Recommended Actions');
    (data.insights?.recommended_actions || []).forEach((item: any) => {
      doc.fontSize(9).text(`• ${typeof item === 'string' ? item : JSON.stringify(item)}`);
    });
    if (data.insights?.risks) {
      doc.moveDown();
      doc.fontSize(10).text('Risks');
      doc.fontSize(9).text(JSON.stringify(data.insights?.risks));
    }
    doc.moveDown();
    doc.fontSize(10).text(`Confidence Level: ${data.insights?.confidence_level ?? 0}`);
    doc.moveDown();
  }

  if (hasPage) {
    renderFooter();
  }
  doc.end();
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const scope = await requireTenantScope(req, res);
  if (!scope) return;

  const roleGate = await enforceActionRole({
    req,
    res,
    companyId: scope.organizationId,
    allowedRoles: [...COMMUNITY_AI_CAPABILITIES.VIEW_ACTIONS],
  });
  if (!roleGate) return;

  const type = (req.query?.type as ExportType) || 'full-report';
  const format = (req.query?.format as ExportFormat) || 'pdf';

  const query = {
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
  };

  const kpis =
    type === 'kpis' || type === 'full-report'
      ? await runHandler(contentKpisHandler, { method: 'GET', query } as any)
      : null;
  const trendsResponse =
    type === 'trends' || type === 'full-report'
      ? await runHandler(trendsHandler, { method: 'GET', query } as any)
      : null;
  const insights =
    type === 'insights' || type === 'full-report'
      ? await runHandler(insightsHandler, { method: 'GET', query } as any)
      : null;

  const payload = {
    type,
    kpis,
    trends: trendsResponse?.trends || [],
    anomalies: trendsResponse?.anomalies || [],
    insights,
  };

  const profile = await getProfile(scope.organizationId, { autoRefine: false, languageRefine: true });
  const companyName = profile?.name || null;
  const logoUrl =
    (profile as any)?.logo_url ||
    (profile as any)?.brand_logo_url ||
    (profile as any)?.company_logo_url ||
    null;

  const dateStamp = new Date().toISOString().slice(0, 10);
  const filename = `community-ai-report-${dateStamp}.${format}`;

  if (format === 'csv') {
    const csv = toCsv(payload);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  }

  res.status(200);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return renderPdf(res, payload, {
    organizationId: scope.organizationId,
    companyName,
    logoUrl,
  });
}

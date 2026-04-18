import type { PdfReportPayload } from './reportPdfRenderer';
import { clampPercent, escapeHtml, hasRealAiVisibilityData, safeText } from './reportHtmlCoreUtils';
import { displayScore } from './reportHtmlVisualPrimitives';

export type DerivedDataSource = {
  source: 'gsc' | 'content_coverage' | 'backlinks' | 'ai_visibility' | 'competitor_intelligence' | 'analytics';
  name: string;
  status: 'missing' | 'partial' | 'connected';
  confidence: 'low' | 'medium' | 'high';
  currentState: string;
  impact: string;
  unlocks: string[];
  usedInSections: string[];
  priority: 'high' | 'medium' | 'low';
};

export type MasterAction = {
  title: string;
  reasoning: string;
  focusPage: string;
  tactics: string[];
  timeline: { short: string; mid: string; long: string };
  priority: string;
  impact: string;
  effort: string;
};

export function ensureActionCoverage(actions: MasterAction[]): MasterAction[] {
  const defaults: MasterAction[] = [
    {
      title: 'Build comparison pages',
      reasoning: 'Capture decision-stage demand and compete directly with alternatives.',
      focusPage: '',
      tactics: ['Create /vs/ pages', 'Add proof blocks', 'Handle pricing and switching objections'],
      priority: 'HIGH',
      impact: 'HIGH',
      effort: 'MEDIUM',
      timeline: { short: '2-4 weeks', mid: '1-3 months', long: '3-6 months' },
    },
    {
      title: 'Strengthen authority signals',
      reasoning: 'Improve trust, rankings, and competitive visibility.',
      focusPage: '',
      tactics: ['Earn relevant backlinks', 'Publish proof-led assets', 'Reinforce trust indicators'],
      priority: 'HIGH',
      impact: 'HIGH',
      effort: 'MEDIUM',
      timeline: { short: '2-4 weeks', mid: '1-3 months', long: '3-6 months' },
    },
    {
      title: 'Expand content depth',
      reasoning: 'Cover buyer-stage topics more completely.',
      focusPage: '',
      tactics: ['Build decision pages', 'Expand core service content', 'Add use-case coverage'],
      priority: 'MEDIUM',
      impact: 'MEDIUM',
      effort: 'MEDIUM',
      timeline: { short: '2-4 weeks', mid: '1-3 months', long: '3-6 months' },
    },
    {
      title: 'Add structured answers (FAQs)',
      reasoning: 'Improve AI retrieval and search visibility.',
      focusPage: '',
      tactics: ['Add FAQ blocks', 'Strengthen summaries', 'Make answers retrieval-ready'],
      priority: 'MEDIUM',
      impact: 'MEDIUM',
      effort: 'LOW',
      timeline: { short: '1-2 weeks', mid: '1-2 months', long: '3-6 months' },
    },
    {
      title: 'Track keyword and performance data',
      reasoning: 'Enable data-driven prioritization and measurement.',
      focusPage: '',
      tactics: ['Connect GSC', 'Track keywords', 'Review performance monthly'],
      priority: 'LOW',
      impact: 'MEDIUM',
      effort: 'LOW',
      timeline: { short: '1-2 weeks', mid: '1-2 months', long: '3-6 months' },
    },
  ];

  const seen = new Set<string>();
  const merged = [...actions, ...defaults].filter((action) => {
    const key = safeText(action.title, 1).trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return merged.slice(0, 5);
}

export function toUpperStrength(value: string | null | undefined): 'STRONG' | 'INFERRED' | 'WEAK' | 'MISSING' {
  const normalized = safeText(value, 1).toUpperCase();
  if (normalized === 'STRONG' || normalized === 'INFERRED' || normalized === 'WEAK') return normalized;
  return 'MISSING';
}

export function deriveDataSources(payload: PdfReportPayload): DerivedDataSource[] {
  const gscConnected = payload.seoVisuals?.seoCapabilityRadar.keyword_research_score != null && payload.seoVisuals?.seoCapabilityRadar.rank_tracking_score != null;
  const gscPartial = payload.seoVisuals?.seoCapabilityRadar.keyword_research_score != null || payload.seoVisuals?.seoCapabilityRadar.rank_tracking_score != null;
  const contentSignals = payload.seoVisuals?.seoCapabilityRadar.content_quality_score != null || Boolean(payload.seoVisuals?.opportunityCoverageMatrix.opportunities?.length);
  const backlinkStrength = toUpperStrength(payload.seoVisuals?.seoCapabilityRadar.data_source_strength?.backlinks_score);
  const aiConnected = hasRealAiVisibilityData(payload);
  const competitorRadar = payload.competitorVisuals?.competitorPositioningRadar;
  const competitorConnected = Boolean(competitorRadar?.competitors?.length && payload.competitorVisuals?.keywordGapAnalysis);
  const competitorPartial = Boolean(competitorRadar?.competitors?.length || payload.competitorIntelligenceSummary);

  return [
    {
      source: 'gsc',
      name: 'SEO / Keyword Data (GSC)',
      status: gscConnected ? 'connected' : gscPartial ? 'partial' : 'missing',
      confidence: gscConnected ? 'high' : gscPartial ? 'medium' : 'low',
      currentState: gscConnected ? 'Keyword and ranking systems are connected.' : gscPartial ? 'Some search-system signals are available, but coverage is incomplete.' : 'Based on crawl-level inference.',
      impact: gscConnected ? 'Keyword and ranking data are available.' : 'Cannot fully measure keyword demand, rankings, or intent coverage.',
      unlocks: ['Keyword opportunities', 'Ranking data', 'Search intent mapping'],
      usedInSections: ['SEO', 'Search Funnel', 'Opportunity Matrix'],
      priority: 'high',
    },
    {
      source: 'content_coverage',
      name: 'Content Coverage',
      status: contentSignals ? 'partial' : 'missing',
      confidence: contentSignals ? 'medium' : 'low',
      currentState: contentSignals ? 'Based on available pages only.' : 'Very limited page-level signal is available.',
      impact: 'Coverage gaps are directional, not exhaustive.',
      unlocks: ['Full topic coverage', 'Buyer-stage mapping', 'Content depth scoring'],
      usedInSections: ['Reality Layer', 'Strategic Position', 'SEO'],
      priority: 'high',
    },
    {
      source: 'backlinks',
      name: 'Backlink & Authority',
      status: backlinkStrength === 'STRONG' ? 'connected' : backlinkStrength === 'INFERRED' || backlinkStrength === 'WEAK' ? 'partial' : 'missing',
      confidence: backlinkStrength === 'STRONG' ? 'high' : backlinkStrength === 'INFERRED' || backlinkStrength === 'WEAK' ? 'medium' : 'low',
      currentState: backlinkStrength === 'STRONG' ? 'Connected backlink signals are available.' : backlinkStrength === 'MISSING' ? 'No backlink source connected.' : 'Heuristic signals only.',
      impact: 'Authority score may not reflect true strength.',
      unlocks: ['Referring domains', 'Link quality', 'Authority benchmarking'],
      usedInSections: ['Backlink & Authority', 'Why This Matters'],
      priority: 'medium',
    },
    {
      source: 'ai_visibility',
      name: 'AI Visibility (Answer Engines)',
      status: aiConnected ? 'connected' : 'missing',
      confidence: aiConnected ? 'high' : 'low',
      currentState: aiConnected ? 'AI visibility signals are available.' : 'Structure-based inference.',
      impact: 'Cannot measure actual AI answer presence.',
      unlocks: ['AI answer visibility', 'Query-level presence', 'Citation strength'],
      usedInSections: ['AI Visibility'],
      priority: 'medium',
    },
    {
      source: 'competitor_intelligence',
      name: 'Competitor Intelligence',
      status: competitorConnected ? 'connected' : competitorPartial ? 'partial' : 'missing',
      confidence: competitorConnected ? 'high' : competitorPartial ? 'medium' : 'low',
      currentState: competitorConnected ? 'Competitor coverage is connected.' : competitorPartial ? 'Based on detected competitors only.' : 'No meaningful competitor benchmark available.',
      impact: 'Market comparison may be incomplete.',
      unlocks: ['Full competitor landscape', 'Share of visibility', 'Positioning accuracy'],
      usedInSections: ['Competitor Intelligence', 'Opportunity Matrix'],
      priority: 'medium',
    },
    {
      source: 'analytics',
      name: 'Conversion / Analytics',
      status: 'missing',
      confidence: 'low',
      currentState: 'No behavioral data.',
      impact: 'Cannot measure business impact.',
      unlocks: ['Funnel performance', 'Conversion rates', 'ROI attribution'],
      usedInSections: ['Search Funnel', 'Growth Trajectory'],
      priority: 'high',
    },
  ];
}

export function renderInlineDisclaimer(kind: 'missing' | 'partial', text: string, confidenceReason?: string): string {
  const title = kind === 'missing' ? 'Early-stage signal detected' : 'Directional signal detected';
  const confidence = confidenceReason ? `<span class="badge ${kind === 'missing' ? 'badge-red' : 'badge-amber'}">Signal confidence: ${kind === 'missing' ? 'Low' : 'Medium'} (${escapeHtml(confidenceReason)})</span>` : '';
  return `<div class="inline-disclaimer ${kind === 'missing' ? 'inline-disclaimer-missing' : 'inline-disclaimer-partial'}">${confidence}<p><strong>${title}.</strong> ${escapeHtml(text)}</p></div>`;
}

export function scoreMetricCard(label: string, score: number | null | undefined, dataStrength: string, note: string): string {
  const shown = displayScore(score, dataStrength);
  const width = shown === '--' ? 0 : clampPercent(score);
  return `
    <article class="metric-card no-break">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(shown)}</strong>
      <div class="bar"><span style="width:${width}%"></span></div>
      <p>${escapeHtml(note)}</p>
    </article>
  `;
}

export function collectMasterActions(payload: PdfReportPayload): MasterAction[] {
  const dedupeMasterActions = (items: MasterAction[]): MasterAction[] => {
    const seenTitles = new Set<string>();
    const seenTacticsSigs = new Set<string>();
    return items.filter((action) => {
      const titleKey = action.title?.trim().toLowerCase().slice(0, 60);
      if (!titleKey || seenTitles.has(titleKey)) return false;
      // Fuzzy tactics dedup: first 20 chars of each tactic, sorted
      const tacticsSig = action.tactics
        .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20))
        .sort()
        .join('|');
      if (tacticsSig.length > 10 && seenTacticsSigs.has(tacticsSig)) return false;
      seenTitles.add(titleKey);
      if (tacticsSig.length > 10) seenTacticsSigs.add(tacticsSig);
      return true;
    });
  };
  const fromSeo = (payload.seoExecutiveSummary?.top3Actions ?? []).map((action) => ({
    title: safeText(action.actionTitle || action.title, 1),
    reasoning: safeText(action.reasoning, 2),
    focusPage: safeText(action.focusPage, 1),
    tactics: Array.isArray(action.tactics) ? action.tactics.map((item) => safeText(item, 1)).filter(Boolean).slice(0, 3) : [],
    timeline: {
      short: safeText(action.timeline?.short, 1),
      mid: safeText(action.timeline?.mid, 1),
      long: safeText(action.timeline?.long, 1),
    },
    priority: safeText(action.priority, 1).toUpperCase(),
    impact: safeText(action.impact || action.expectedImpact, 1).toUpperCase(),
    effort: safeText(action.effort, 1).toUpperCase(),
  }));
  const fromGeo = (payload.geoAeoExecutiveSummary?.top3Actions ?? []).map((action) => ({
    title: safeText(action.actionTitle, 1),
    reasoning: safeText(action.reasoning, 2),
    focusPage: '',
    tactics: [],
    timeline: { short: '', mid: '', long: '' },
    priority: safeText(action.priority, 1).toUpperCase(),
    impact: safeText(action.expectedImpact, 1).toUpperCase(),
    effort: safeText(action.effort, 1).toUpperCase(),
  }));
  const fromNextSteps = payload.nextSteps.map((step) => ({
    title: safeText(step.action, 1),
    reasoning: safeText(step.reasoning || step.description, 2),
    focusPage: safeText(step.focusPage, 1),
    tactics: Array.isArray(step.tactics) ? step.tactics.map((item) => safeText(item, 1)).filter(Boolean).slice(0, 3) : [],
    timeline: {
      short: safeText(step.timeline?.short, 1),
      mid: safeText(step.timeline?.mid, 1),
      long: safeText(step.timeline?.long, 1),
    },
    priority: safeText(step.priority, 1).toUpperCase(),
    impact: safeText(step.impact, 1).toUpperCase(),
    effort: safeText(step.effort, 1).toUpperCase(),
  }));
  const deduped = dedupeMasterActions([...fromNextSteps, ...fromSeo, ...fromGeo]).slice(0, 5);
  // Clean up vague AI-generated titles
  return deduped.map((action) => {
    const lower = action.title.toLowerCase();
    if (lower.includes('execute the highest') || lower.includes('highest-impact action')) {
      // Rename based on tactics content
      const hasAuthority = action.tactics.some((t) => /backlink|director|authority|outreach|partner/i.test(t));
      const hasContent = action.tactics.some((t) => /comparison|content|page|case study/i.test(t));
      action.title = hasAuthority ? 'Build authority through directories, proof assets, and outreach' : hasContent ? 'Create high-impact content assets' : action.title;
    }
    return action;
  });
}

export function renderMasterActionCard(action: MasterAction, index: number): string {
  const problem = action.reasoning || 'Discoverability is being left to chance.';
  const impact = action.impact === 'HIGH'
    ? 'Buyers cannot discover and compare effectively.'
    : action.impact === 'MEDIUM'
      ? 'Visibility and trust gains will stay slower than they should.'
      : 'Progress will stay difficult to measure consistently.';
  const solution = action.title || 'Build structured comparison pages.';

  const impactColor = action.impact === 'HIGH' ? 'background:#FEF1EF;color:#991B1B;' : action.impact === 'MEDIUM' ? 'background:#E3F0FA;color:#0A5E91;' : 'background:#F5F7FA;color:#4A6274;';
  const effortColorStyle = action.effort === 'LOW' ? 'background:#E6F4EC;color:#1B7340;' : action.effort === 'MEDIUM' ? 'background:#FEF4E4;color:#B45309;' : 'background:#FEF1EF;color:#991B1B;';

  // Action card split into header + body + details — NO no-break on the outer wrapper
  // so Chrome can break across pages naturally instead of leaving huge whitespace
  const headerBlock = `<div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:#fff;border:1px solid #D4DDE6;border-radius:4px 4px 0 0;border-bottom:none;">
    <div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:#051C2C;color:#fff;font-family:Georgia,serif;font-size:14px;font-weight:700;flex-shrink:0;">${index + 1}</div>
    <div>
      <div style="font-size:13px;font-weight:700;color:#051C2C;line-height:1.3;margin-bottom:4px;">${escapeHtml(action.title)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${action.impact ? `<span style="display:inline-flex;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:3px 8px;border-radius:3px;${impactColor}">${escapeHtml(`${action.impact} IMPACT`)}</span>` : ''}
        ${action.effort ? `<span style="display:inline-flex;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:3px 8px;border-radius:3px;${effortColorStyle}">${escapeHtml(`${action.effort} EFFORT`)}</span>` : ''}
      </div>
    </div>
  </div>`;

  const bodyBlock = `<div style="padding:8px 14px 8px 52px;background:#fff;border-left:1px solid #D4DDE6;border-right:1px solid #D4DDE6;">
    <p style="font-size:11.5px;margin-bottom:4px;"><span style="display:inline-block;width:3px;height:12px;background:#991B1B;border-radius:2px;vertical-align:middle;margin-right:6px;"></span><strong>Problem:</strong> ${escapeHtml(problem)}</p>
    <p style="font-size:11.5px;margin-bottom:4px;"><span style="display:inline-block;width:3px;height:12px;background:#B45309;border-radius:2px;vertical-align:middle;margin-right:6px;"></span><strong>Impact:</strong> ${escapeHtml(impact)}</p>
    <p style="font-size:11.5px;margin-bottom:0;"><span style="display:inline-block;width:3px;height:12px;background:#1B7340;border-radius:2px;vertical-align:middle;margin-right:6px;"></span><strong>Action:</strong> ${escapeHtml(solution)}</p>
  </div>`;

  // Timeline removed from individual cards — kept only in the Execution Roadmap to avoid duplication
  const hasDetails = action.tactics.length > 0;
  const detailsBlock = hasDetails ? `<div style="padding:6px 14px 12px 52px;background:#fff;border:1px solid #D4DDE6;border-top:none;border-radius:0 0 4px 4px;">
    <div><div class="label">Tactics</div><ol style="padding-left:16px;font-size:11px;color:#4A6274;">${action.tactics.map((item) => `<li style="margin-bottom:2px;">${escapeHtml(item)}</li>`).join('')}</ol></div>
  </div>` : `<div style="height:4px;border-bottom:1px solid #D4DDE6;border-left:1px solid #D4DDE6;border-right:1px solid #D4DDE6;border-radius:0 0 4px 4px;background:#fff;"></div>`;

  return `<div style="margin-bottom:8px;">${headerBlock}${bodyBlock}${detailsBlock}</div>`;
}

export function inferMasterActionTrack(action: MasterAction): 'authority' | 'positioning' | 'comparison' | 'generic' {
  const signature = `${action.title} ${action.reasoning} ${action.tactics.join(' ')}`.toLowerCase();
  if (/(backlink|authority|citation|directory|publication|partner list|outreach|proof-led asset|links from)/.test(signature)) return 'authority';
  if (/(positioning proof|credibility|expert framing|proof architecture|trust signals|category claim)/.test(signature)) return 'positioning';
  if (/(comparison|competitor|\/vs\/|decision-stage|objection-handling|buying-stage)/.test(signature)) return 'comparison';
  return 'generic';
}

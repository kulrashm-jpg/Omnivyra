/**
 * F3c: campaign details is VIEW-ONLY for Viewers / view-only users / Engagers (owner
 * ruling; the server answers their writes with 403 ROLE_FORBIDDEN). Every write or AI
 * control is rendered only when canWriteThisCampaign is true, the AI chat never opens for
 * them (the batch-2 hook can still request it; the render site refuses), and a
 * "View only" notice explains why.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const FILES = ['components/CampaignDetailsContent.tsx', 'components/CampaignWeeklySection.tsx', 'components/WeekCard.tsx'];

/** Is `marker` inside an open `canWriteThisCampaign && (` … `)` group? (paren-balanced scan) */
function insideWriteGate(src: string, marker: string): boolean {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  const OPEN = 'canWriteThisCampaign && (';
  let from = 0;
  for (;;) {
    const o = src.indexOf(OPEN, from);
    if (o < 0 || o > at) return false;
    // find the matching ')' of the '(' that ends OPEN
    let depth = 0;
    let i = o + OPEN.length - 1;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') { depth--; if (depth === 0) break; }
    }
    if (at > o && at < i) return true;
    from = o + OPEN.length;
  }
}

describe('campaign details: write and AI controls only for writers (F3c)', () => {
  it.each(FILES)('%s parses (no JSX syntax errors from the wraps)', (p) => {
    const out = ts.transpileModule(read(p), { reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve }, fileName: p });
    expect((out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
  });

  it.each([
    ['components/CampaignDetailsContent.tsx', 'onClick={() => setShowAIChat(true)}'],
    ['components/CampaignDetailsContent.tsx', "fetchWithAuth('/api/campaigns/regenerate-blueprint'"],
    ['components/CampaignDetailsContent.tsx', 'onClick={createWeekPlanFromStoredContext}'],
    ['components/CampaignDetailsContent.tsx', "fetchWithAuth('/api/campaigns/negotiate-duration'"],
    ['components/CampaignDetailsContent.tsx', '<CampaignAIChat\n          isOpen={showAIChat}'],
    ['components/CampaignWeeklySection.tsx', 'onClick={enhanceAllWeeksWithAI}'],
    ['components/WeekCard.tsx', 'Enhancing…\' : \'Enhance with AI\''],
    ['components/WeekCard.tsx', 'onClick={() => regenerateWeekDailyPlan(weekNumber)}'],
    ['components/WeekCard.tsx', 'onClick={() => saveWeekDailyPlan(weekNumber)}'],
    ['components/WeekCard.tsx', '                                  Generate Daily Plans\n'],
  ])('%s: %s', (file, marker) => {
    expect(insideWriteGate(read(file), marker)).toBe(true);
  });

  it('navigation stays available to viewers (health, planner, calendar, topic workspace)', () => {
    expect(insideWriteGate(read('components/CampaignDetailsContent.tsx'), 'router.push(`/campaign-health/${campaign.id}`)')).toBe(false);
    expect(insideWriteGate(read('components/CampaignWeeklySection.tsx'), 'router.push(buildDailyPlanPageUrl(campaign.id))')).toBe(false);
    expect(insideWriteGate(read('components/WeekCard.tsx'), 'onClick={() => openCampaignCalendar(weekNumber)}')).toBe(false);
  });

  it('each file derives the flag from the shared rule and the real role', () => {
    for (const p of FILES) {
      expect(read(p)).toMatch(/const canWriteThisCampaign = canWriteCampaign\(useCompanyContext\(\)\.userRole\);/);
    }
    const c = read('components/CampaignDetailsContent.tsx');
    expect(c).toMatch(/!canWriteThisCampaign && \(\s*<div data-testid="campaign-read-only-notice"[\s\S]{0,200}View only: \{ROLE_FORBIDDEN_MESSAGE\}/);
  });
});

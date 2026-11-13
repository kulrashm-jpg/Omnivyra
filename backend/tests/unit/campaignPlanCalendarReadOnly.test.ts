/**
 * F3d: the daily plan and the campaign calendar are VIEW-ONLY for Viewers / view-only
 * users / Engagers (owner ruling; the server answers their writes with 403 ROLE_FORBIDDEN).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { insideWriteGate } from '../helpers/writeGateScan';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const DP = 'pages/campaign-daily-plan/[id].tsx';
const WV = 'components/campaign-daily-plan/CampaignDailyPlanSingleWeekView.tsx';
const CAL = 'components/CampaignCalendarView.tsx';

describe('daily plan + calendar: write and AI controls only for writers (F3d)', () => {
  it.each([DP, WV, CAL])('%s parses', (p) => {
    const out = ts.transpileModule(read(p), { reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve }, fileName: p });
    expect((out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
  });

  it.each([
    [DP, 'onClick={() => handleGenerateFromAI(weekNumber)}'],
    [DP, 'onClick={() => setShowScheduleConfirm(true)}'],
    [DP, 'onClick={handleRepurposeAndSchedule}'],
    [CAL, 'onClick={() => openReschedule(activity)}'],
  ])('%s: %s', (file, marker) => {
    expect(insideWriteGate(read(file), marker)).toBe(true);
  });

  it('the week view only gets write callbacks for writers', () => {
    const s = read(DP);
    expect(s).toContain('onRegenerateWeek={canWriteThisCampaign ? handleRegenerateWeek : undefined}');
    expect(s).toContain('onGenerateFromAI={canWriteThisCampaign ? handleGenerateFromAI : undefined}');
    expect(s).toContain('onSaveDayChanges={canWriteThisCampaign ? handleSaveDayChanges : undefined}');
    // and the week view hides Regenerate when it gets none
    expect(insideWriteGate(read(WV), 'onClick={() => onRegenerateWeek?.(weekNumber)}', 'onRegenerateWeek')).toBe(true);
  });

  it('viewing stays: activity detail, post preview and month navigation are not gated', () => {
    expect(insideWriteGate(read(CAL), 'onClick={() => openActivityDetail(activity)}')).toBe(false);
    expect(insideWriteGate(read(CAL), "onClick={() => moveMonth('next')}")).toBe(false);
  });

  it.each([DP, CAL])('%s derives the flag from the shared rule and the real role', (p) => {
    expect(read(p)).toMatch(/const canWriteThisCampaign = canWriteCampaign\(useCompanyContext\(\)\.userRole\);/);
  });
});

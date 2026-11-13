/**
 * UI D4 (owner decision 2026-11-13): campaign flow names + owner-approved hints come from
 * ONE constant (lib/navigation/campaignFlows.ts). Section tabs, breadcrumbs and page
 * headings read it, and no file copies a hint string. (uiCampaignHints pins the approved
 * wording itself; the header menu is deferred to the PI landing.)
 */
import * as fs from 'fs';
import * as path from 'path';
import { CAMPAIGN_FLOWS } from '../../../lib/navigation/campaignFlows';

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('one source for flow names and hints (D4)', () => {
  it('no hint string is copied outside the constant module', () => {
    const files = ['components', 'pages', 'lib', 'hooks', 'config'].flatMap((d) => (fs.existsSync(path.join(ROOT, d)) ? walk(path.join(ROOT, d)) : []));
    const offenders: string[] = [];
    for (const f of files) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      if (rel === 'lib/navigation/campaignFlows.ts') continue;
      const src = fs.readFileSync(f, 'utf8');
      for (const flow of Object.values(CAMPAIGN_FLOWS)) if (src.includes(`'${flow.hint}'`)) offenders.push(`${rel}: ${flow.hint}`);
    }
    expect(offenders).toEqual([]);
  });
  it('control: the scan would catch a copy', () => {
    expect(`label: 'x', hint: '${CAMPAIGN_FLOWS.boltText.hint}'`.includes(`'${CAMPAIGN_FLOWS.boltText.hint}'`)).toBe(true);
  });
  it('breadcrumbs name the flows from the constant', () => {
    const b = read('components/layout/Breadcrumbs.tsx');
    expect(b).toContain("'campaign-planner': CAMPAIGN_FLOWS.strategicMix.label,");
    expect(b).toContain("'bolt-text': CAMPAIGN_FLOWS.boltText.label,");
    expect(b).toContain("'bolt-creator-strategy': CAMPAIGN_FLOWS.boltCreator.label,");
    expect(b).toContain("'intelligent-mix-strategy': CAMPAIGN_FLOWS.intelligentMix.label,");
    expect(b).not.toContain('Strategic Mix Planner');
  });
  it('BOLT Text and Strategic Mix headings are the product name + hint', () => {
    expect(read('components/BoltStrategyViewMain.tsx')).toMatch(/<h1[^>]*>\{CAMPAIGN_FLOWS\.boltText\.label\}<\/h1>\s*<p[^>]*>\{CAMPAIGN_FLOWS\.boltText\.hint\}<\/p>/);
    expect(read('pages/campaign-planner.tsx')).toMatch(/<h1[^>]*>\{CAMPAIGN_FLOWS\.strategicMix\.label\}<\/h1>\s*<p[^>]*>\{CAMPAIGN_FLOWS\.strategicMix\.hint\}<\/p>/);
    expect(read('components/BoltStrategyViewMain.tsx')).not.toContain('BOLT (Text) Strategy Builder');
  });
});

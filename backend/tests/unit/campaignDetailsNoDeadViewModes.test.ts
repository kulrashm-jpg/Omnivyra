/**
 * F2 (e9 ruling): campaign details' CMO / system "view mode" layers were dead. getViewMode's
 * roles (CMO, CONTENT_MANAGER, …) are never the client's role, and the hook hard-codes
 * `session = undefined`, so they rendered for nobody. The branches are removed; they
 * must not come back. A future operator view would be gated on isSuperAdmin instead.
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('no dead view-mode layers in campaign details (F2)', () => {
  it.each([
    'components/WeekCard.tsx',
    'components/WeekCardController.tsx',
    'components/CampaignWeeklySection.tsx',
    'components/CampaignDetailsContent.tsx',
  ])('%s', (p) => {
    const s = read(p);
    expect(s).not.toMatch(/VIEW_RULES|showCMOLayer|showSystemFields/);
  });
  it('control: the matrix itself still exists (the activity workspace uses showCreatorBrief)', () => {
    expect(read('utils/viewVisibilityMatrix.ts')).toMatch(/showCreatorBrief/);
  });
});

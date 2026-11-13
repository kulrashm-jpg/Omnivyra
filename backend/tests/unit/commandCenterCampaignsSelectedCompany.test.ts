/**
 * 55's active-company sweep: /command-center/campaigns must act on the company the user
 * SELECTED, never user.defaultCompanyId (their first company). A multi-company user
 * would otherwise see another company's campaigns and experiments.
 */
import * as fs from 'fs';
import * as path from 'path';

const src = fs.readFileSync(path.join(process.cwd(), 'pages/command-center/campaigns.tsx'), 'utf8');

describe('command-center/campaigns: selected company', () => {
  it('the variant hub gets selectedCompanyId from the company context', () => {
    expect(src).toMatch(/const \{[^}]*\bselectedCompanyId\b[^}]*\} = useCompanyContext\(\);/);
    expect(src).toMatch(/<CampaignVariantHubSection companyId=\{selectedCompanyId\} \/>/);
  });
  it('never falls back to the default (first) company', () => {
    expect(src).not.toMatch(/defaultCompanyId/);
  });
});

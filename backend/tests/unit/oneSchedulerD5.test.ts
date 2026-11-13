/**
 * UI D5 (owner rule 2): one scheduler. The three standalone schedulers redirect to the
 * dashboard Calendar tab (redirects run before pages), and the header Campaigns menu has a
 * Calendar entry.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nextConfig = require('../../../next.config.js');

describe('one scheduler (D5)', () => {
  it.each(['/scheduler', '/creative-scheduler', '/scheduling-dashboard'])('%s → the dashboard Calendar tab', async (source) => {
    const cfg = typeof nextConfig === 'function' ? await nextConfig('phase-production-build', {}) : nextConfig;
    const redirects = await cfg.redirects();
    const hit = redirects.find((r: any) => r.source === source && !r.has);
    expect(hit).toEqual({ source, destination: '/dashboard?tab=calendar', permanent: false });
  });
  it('the dashboard accepts ?tab=calendar', () => {
    const src = require('fs').readFileSync(require('path').join(process.cwd(), 'components/hooks/useDashboardStateCore.tsx'), 'utf8');
    expect(src).toMatch(/p === 'calendar'/);
  });
});

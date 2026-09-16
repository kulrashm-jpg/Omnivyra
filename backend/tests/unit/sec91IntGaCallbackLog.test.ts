/**
 * STEP 3AH-91 integration — the GA/GSC OAuth callback must not log the
 * authorization code. The "hit" log line used to include req.url, whose query
 * carries the single-use `code` and the state.
 */
export {};
import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(path.join(__dirname, '../../../pages/api/analytics/connect/google/callback.ts'), 'utf8');

it('the callback never logs the raw request URL (query holds the OAuth code)', () => {
  const logLines = SRC.split('\n').filter((l) => /console\.(log|info|warn|error)\(/.test(l));
  expect(logLines.length).toBeGreaterThan(0);
  for (const l of logLines) expect(l).not.toMatch(/url:\s*req\.url\b/);
  expect(SRC).toMatch(/path:\s*String\(req\.url \?\? ''\)\.split\('\?'\)\[0\]/);
});

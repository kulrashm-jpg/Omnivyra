/**
 * S2 interim (e9 ruling 2026-11-13): 10 campaign-less scheduled_posts writes stay on raw ownedDbTable/supabase,
 * USER-ANCHORED, under 4 allow-list entries that carry an exit condition (exitWhenApplied 20270217000028 =
 * scheduled_posts.company_id). Pinned here:
 *   1. every marked UPDATE is predicated on the acting user; the 2 marked INSERTs stamp user_id from the session;
 *   2. the legacy-post service refuses another user's post (nothing changed) - and still works for the owner;
 *   3. gate rule R11: once 028 is recorded applied_in_prod, the scan FAILS while these entries exist.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());

/* eslint-disable @typescript-eslint/no-var-requires */
const H = require('../helpers/routeAuthHarness');
const { cancelLegacyScheduledPost, updateLegacyScheduledPost, publishLegacyScheduledPostNow } =
  require('../../services/structuredPlanSchedulerExecDaily');
/* eslint-enable @typescript-eslint/no-var-requires */

const ROOT = path.resolve(__dirname, '../../..');
const SITES: Record<string, { id: string; markers: number }> = {
  'pages/api/scheduler/schedule.ts': { id: 'scheduled-posts-user-anchored-scheduler-schedule', markers: 1 },
  'pages/api/schedule/reschedule.ts': { id: 'scheduled-posts-user-anchored-schedule-reschedule', markers: 1 },
  'backend/services/structuredPlanSchedulerExecDaily.ts': { id: 'scheduled-posts-user-anchored-legacy-posts', markers: 4 },
  'pages/api/scheduler/retry.ts': { id: 'scheduled-posts-user-anchored-scheduler-retry', markers: 4 },
};

describe('1. every marked statement is anchored to the acting user', () => {
  it.each(Object.entries(SITES))('%s', (rel, { id, markers }) => {
    const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    const at = lines.map((l, i) => (l.includes(`// cross-tenant: ${id}`) ? i : -1)).filter((i) => i >= 0);
    expect(at).toHaveLength(markers);
    for (const i of at) {
      // the statement the marker governs: up to its terminating `;`
      let j = i + 1;
      while (j < lines.length && !/;\s*$/.test(lines[j])) j++;
      const stmt = lines.slice(i + 1, j + 1).join('\n');
      if (/\.insert\(/.test(stmt)) {
        // the insert payload stamps user_id from the session, never the body
        const file = lines.join('\n');
        expect(file).toMatch(rel.includes('ExecDaily') ? /user_id:\s*input\.userId/ : /user_id:\s*userId,/);
      } else {
        expect(stmt).toMatch(/\.eq\('user_id',\s*(user\.id|user\.userId|input\.userId)\)/);
      }
    }
  });
});

describe('2. legacy posts: another user\'s post is refused (nothing changes); the owner still can', () => {
  const POST_B = 'pb000000-0000-4000-8000-0000000000b1';
  const POST_A = 'pa000000-0000-4000-8000-0000000000a1';
  const statusOf = (id: string) => H.rows('scheduled_posts').find((r: { id: string }) => r.id === id)?.status;
  beforeEach(() => {
    H.seed({
      scheduled_posts: [
        { id: POST_B, user_id: H.USER_B, campaign_id: null, platform: 'linkedin', status: 'scheduled', content: 'b' },
        { id: POST_A, user_id: H.USER_A, campaign_id: null, platform: 'linkedin', status: 'scheduled', content: 'a' },
      ],
    });
  });
  it('cancel: A cannot cancel B\'s post; A cancels its own', async () => {
    await cancelLegacyScheduledPost({ userId: H.USER_A, id: POST_B });
    expect(statusOf(POST_B)).toBe('scheduled');
    await cancelLegacyScheduledPost({ userId: H.USER_A, id: POST_A });
    expect(statusOf(POST_A)).toBe('cancelled');
  });
  it('update: A cannot change B\'s post', async () => {
    await updateLegacyScheduledPost({ userId: H.USER_A, id: POST_B, patch: { content: 'hijacked', status: 'failed' } });
    const b = H.rows('scheduled_posts').find((r: { id: string }) => r.id === POST_B);
    expect(b).toMatchObject({ content: 'b', status: 'scheduled' });
  });
  it('publish-now: A cannot re-schedule B\'s post', async () => {
    const before = { ...H.rows('scheduled_posts').find((r: { id: string }) => r.id === POST_B) };
    await publishLegacyScheduledPostNow({ userId: H.USER_A, id: POST_B });
    expect(H.rows('scheduled_posts').find((r: { id: string }) => r.id === POST_B)).toEqual(before);
  });
});

describe('3. gate rule R11: the interim entries expire when 028 is applied in prod', () => {
  const runGate = (reservations: unknown[]) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's2-r11-'));
    try {
      fs.mkdirSync(path.join(dir, 'backend', 'db'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'scripts', 'migrations'), { recursive: true });
      for (const f of ['tenantTables.ts', 'crossTenantAllowList.ts']) {
        fs.copyFileSync(path.join(ROOT, 'backend', 'db', f), path.join(dir, 'backend', 'db', f));
      }
      fs.writeFileSync(path.join(dir, 'scripts', 'migrations', 'version-reservations.json'), JSON.stringify({ reservations }));
      return spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-tenant-seam.js'), '--root', dir], { encoding: 'utf8' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  it('028 not applied: passes', () => {
    const r = runGate([{ version: '20270217000028', status: 'reserved' }]);
    expect(r.status).toBe(0);
  });
  it('028 recorded applied_in_prod while the 4 entries exist: FAILS, naming each entry', () => {
    const r = runGate([{ version: '20270217000028', status: 'merged', applied_in_prod: true }]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/BLOCK \(R11\)/);
    for (const { id } of Object.values(SITES)) expect(r.stderr).toContain(`${id} (exit: 20270217000028 applied in prod)`);
  });
  it('another version applied does not trip R11', () => {
    const r = runGate([{ version: '20270217000025', status: 'merged', applied_in_prod: true }]);
    expect(r.status).toBe(0);
  });
});

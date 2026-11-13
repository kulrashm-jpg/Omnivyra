/** reportNotificationInsertFailure (6f; 05 Q3): a per-user writer's failed insert is LOGGED and COUNTED on the metric
 * monitoring/notifications-alerts.yml alerts on (notification_undeliverable{reason="insert_failed"}); no error, no-op. */
const counters: Array<[string, number, Record<string, string>]> = [];
jest.mock('../../observability', () => ({ recordRawCounter: (n: string, v: number, l: Record<string, string>) => { counters.push([n, v, l]); } }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('not used'); } } }));
import { reportNotificationInsertFailure } from '../../services/userNotificationService';

it('an error is logged with its writer and counted as insert_failed', () => {
  const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    reportNotificationInsertFailure('role_updated', { message: 'permission denied' }, 'pages/api/team/self-joined.ts:87');
    expect(err).toHaveBeenCalledWith('NOTIFICATION_INSERT_FAILED', expect.stringContaining('self-joined.ts:87'));
  } finally { err.mockRestore(); }
  expect(counters).toEqual([['notification_undeliverable', 1, { reason: 'insert_failed', type: 'role_updated' }]]);
});

it('no error: nothing logged, nothing counted', () => {
  counters.length = 0;
  const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try { reportNotificationInsertFailure('role_updated', null, 'x'); expect(err).not.toHaveBeenCalled(); } finally { err.mockRestore(); }
  expect(counters).toEqual([]);
});

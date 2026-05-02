import {
  ACTIONABLE_INBOX_LOOKBACK_MS,
  isNeedsResponseThread,
  isPeopleReactionThread,
  selectNeedsResponseThreads,
} from '../../../lib/engagement/queueRules';

const NOW = Date.parse('2026-05-02T12:00:00.000Z');

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

describe('engagement queue rules', () => {
  it('shows only DMs where the other party sent the latest message', () => {
    expect(isNeedsResponseThread({
      latest_message_type: 'direct_message',
      latest_message_direction: 'incoming',
      latest_message_author_self: false,
      latest_message_time: iso(NOW - 60_000),
    }, NOW)).toBe(true);

    expect(isNeedsResponseThread({
      latest_message_type: 'direct_message',
      latest_message_direction: 'outgoing',
      latest_message_author_self: true,
      latest_message_time: iso(NOW - 60_000),
    }, NOW)).toBe(false);
  });

  it('hides DMs already covered by a confirmed outbound action', () => {
    expect(isNeedsResponseThread({
      latest_message_type: 'direct_message',
      latest_message_direction: 'incoming',
      latest_message_author_self: false,
      has_completed_outbound_action: true,
      latest_message_time: iso(NOW - 60_000),
    }, NOW)).toBe(false);
  });

  it('uses the latest message time for the 60 day window', () => {
    expect(isNeedsResponseThread({
      latest_message_type: 'direct_message',
      latest_message_direction: 'incoming',
      latest_message_author_self: false,
      latest_message_time: iso(NOW - ACTIONABLE_INBOX_LOOKBACK_MS + 60_000),
    }, NOW)).toBe(true);

    expect(isNeedsResponseThread({
      latest_message_type: 'direct_message',
      latest_message_direction: 'incoming',
      latest_message_author_self: false,
      latest_message_time: iso(NOW - ACTIONABLE_INBOX_LOOKBACK_MS - 60_000),
    }, NOW)).toBe(false);
  });

  it('keeps People Reaction separate from Need Response', () => {
    const comment = {
      latest_message_type: 'comment',
      latest_message_direction: 'incoming',
      latest_message_author_self: false,
      latest_message_time: iso(NOW - 60_000),
    };

    expect(isNeedsResponseThread(comment, NOW)).toBe(false);
    expect(isPeopleReactionThread(comment, NOW)).toBe(true);
  });

  it('sorts actionable DMs newest first and leaves self-latest rows out', () => {
    const selected = selectNeedsResponseThreads([
      {
        latest_message_type: 'direct_message',
        latest_message_direction: 'outgoing',
        latest_message_author_self: true,
        latest_message_time: iso(NOW),
      },
      {
        latest_message_type: 'direct_message',
        latest_message_direction: 'incoming',
        latest_message_author_self: false,
        latest_message_time: iso(NOW - 5_000),
        priority_score: 10,
      },
      {
        latest_message_type: 'direct_message',
        latest_message_direction: 'incoming',
        latest_message_author_self: false,
        latest_message_time: iso(NOW - 1_000),
        priority_score: 1,
      },
    ], NOW);

    expect(selected).toHaveLength(2);
    expect(selected.map((thread) => thread.latest_message_time)).toEqual([
      iso(NOW - 1_000),
      iso(NOW - 5_000),
    ]);
  });
});

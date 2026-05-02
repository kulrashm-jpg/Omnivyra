import { resolveDmThreadIdentity } from '../../../lib/engagement/dmThreadIdentity';

describe('DM thread identity', () => {
  it('uses an older inbound message to identify the counterparty when the latest message is self-authored', () => {
    const identity = resolveDmThreadIdentity({
      platform: 'linkedin',
      threadId: 'self-latest-thread',
      platformThreadId: 'linkedin-conversation-1',
      latestMessage: {
        message_type: 'direct_message',
        direction: 'outgoing',
        content: 'my number is 9311214700',
        author_id: null,
        raw_payload: { sender_self: true },
      },
      messages: [
        {
          message_type: 'direct_message',
          direction: 'outgoing',
          content: 'my number is 9311214700',
          author_id: null,
          raw_payload: { sender_self: true },
        },
        {
          message_type: 'direct_message',
          direction: 'incoming',
          content: 'Can we talk tomorrow?',
          author_id: 'durga-author-id',
          raw_payload: { sender_name: 'Durga Prasad' },
        },
      ],
    });

    expect(identity.key).toBe('author:durga-author-id');
    expect(identity.counterpartyAuthorId).toBe('durga-author-id');
  });

  it('falls back to participant identity when message rows lack author ids', () => {
    const identity = resolveDmThreadIdentity({
      platform: 'linkedin',
      threadId: 'participant-thread',
      platformThreadId: 'linkedin-conversation-2',
      threadRawPayload: {
        participant_name: 'Rajesh Singh',
      },
      latestMessage: {
        message_type: 'direct_message',
        direction: 'outgoing',
        content: 'Thanks, will check',
        raw_payload: { sender_self: true },
      },
      messages: [
        {
          message_type: 'direct_message',
          direction: 'outgoing',
          content: 'Thanks, will check',
          raw_payload: { sender_self: true },
        },
      ],
    });

    expect(identity.key).toBe('name:rajesh singh');
    expect(identity.targetIds).toContain('Rajesh Singh');
  });
});

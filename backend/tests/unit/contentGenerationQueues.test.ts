import { normalizeContentQueueName } from '../../queue/contentGenerationQueues';

describe('contentGenerationQueues', () => {
  it('normalizes legacy colon-based content queue names', () => {
    expect(normalizeContentQueueName('content:blog')).toBe('content-blog');
    expect(normalizeContentQueueName('content:engagement')).toBe('content-engagement');
    expect(normalizeContentQueueName('content:refinement')).toBe('content-refinement');
  });

  it('keeps valid queue names unchanged', () => {
    expect(normalizeContentQueueName('content-blog')).toBe('content-blog');
    expect(normalizeContentQueueName('creator-video')).toBe('creator-video');
  });
});

import { inferExecutionMode, isExecutionMode } from '../../services/executionModeInference';

describe('executionModeInference', () => {
  describe('CREATOR_REQUIRED', () => {
    it('returns CREATOR_REQUIRED for video, reel, short, audio, podcast', () => {
      expect(inferExecutionMode('video')).toBe('CREATOR_REQUIRED');
      expect(inferExecutionMode('reel')).toBe('CREATOR_REQUIRED');
      expect(inferExecutionMode('short')).toBe('CREATOR_REQUIRED');
      expect(inferExecutionMode('audio')).toBe('CREATOR_REQUIRED');
      expect(inferExecutionMode('podcast')).toBe('CREATOR_REQUIRED');
      expect(inferExecutionMode('song')).toBe('CREATOR_REQUIRED');
    });
    it('returns CREATOR_REQUIRED for compound types and normalized forms', () => {
      expect(inferExecutionMode('short_form_video')).toBe('CREATOR_REQUIRED');
      expect(inferExecutionMode('instagram_reel')).toBe('CREATOR_REQUIRED');
      expect(inferExecutionMode('video_short')).toBe('CREATOR_REQUIRED');
      expect(inferExecutionMode('short-video')).toBe('CREATOR_REQUIRED');
      expect(inferExecutionMode('Video')).toBe('CREATOR_REQUIRED');
    });
    it('returns CREATOR_REQUIRED when placeholder is true', () => {
      expect(inferExecutionMode('post', { placeholder: true })).toBe('CREATOR_REQUIRED');
    });
    it('returns CREATOR_REQUIRED when source is placeholder', () => {
      expect(inferExecutionMode('post', { source: 'placeholder' })).toBe('CREATOR_REQUIRED');
    });
  });

  describe('CONDITIONAL_AI', () => {
    it('returns CONDITIONAL_AI for carousel, slides, infographic, deck, presentation', () => {
      expect(inferExecutionMode('carousel')).toBe('CONDITIONAL_AI');
      expect(inferExecutionMode('slides')).toBe('CONDITIONAL_AI');
      expect(inferExecutionMode('slide')).toBe('CONDITIONAL_AI');
      expect(inferExecutionMode('slideware')).toBe('CONDITIONAL_AI');
      expect(inferExecutionMode('infographic')).toBe('CONDITIONAL_AI');
      expect(inferExecutionMode('deck')).toBe('CONDITIONAL_AI');
      expect(inferExecutionMode('presentation')).toBe('CONDITIONAL_AI');
    });
    it('returns CONDITIONAL_AI for compound carousel/slide types', () => {
      expect(inferExecutionMode('linkedin_carousel')).toBe('CONDITIONAL_AI');
    });
  });

  describe('AI_AUTOMATED', () => {
    it('returns AI_AUTOMATED for text, post, article, thread, story', () => {
      expect(inferExecutionMode('text')).toBe('AI_AUTOMATED');
      expect(inferExecutionMode('post')).toBe('AI_AUTOMATED');
      expect(inferExecutionMode('article')).toBe('AI_AUTOMATED');
      expect(inferExecutionMode('thread')).toBe('AI_AUTOMATED');
      expect(inferExecutionMode('story')).toBe('AI_AUTOMATED');
      expect(inferExecutionMode('tweet')).toBe('AI_AUTOMATED');
      expect(inferExecutionMode('blog')).toBe('AI_AUTOMATED');
    });
    it('returns AI_AUTOMATED for empty or unknown type', () => {
      expect(inferExecutionMode('')).toBe('AI_AUTOMATED');
      expect(inferExecutionMode('unknown_format')).toBe('AI_AUTOMATED');
    });
    it('returns AI_AUTOMATED for creator type when media_ready is true', () => {
      expect(inferExecutionMode('video', { media_ready: true })).toBe('AI_AUTOMATED');
    });
  });

  describe('isExecutionMode (type guard)', () => {
    it('returns true only for valid ExecutionMode literals', () => {
      expect(isExecutionMode('AI_AUTOMATED')).toBe(true);
      expect(isExecutionMode('CREATOR_REQUIRED')).toBe(true);
      expect(isExecutionMode('CONDITIONAL_AI')).toBe(true);
      expect(isExecutionMode('CREATOR')).toBe(false);
      expect(isExecutionMode('AUTO')).toBe(false);
      expect(isExecutionMode('')).toBe(false);
      expect(isExecutionMode(null)).toBe(false);
      expect(isExecutionMode(undefined)).toBe(false);
    });
  });
});

import ShortformTopicPage from '../../components/content/ShortformTopicPage';

const POST_FORMATS = [
  {
    value: 'authority-post',
    label: 'Authority Post',
    description: 'Perspective-led shortform built to signal expertise, credibility, and a clear market point of view.',
    wordRange: '120-220 words',
  },
  {
    value: 'quick-insight',
    label: 'Quick Insight',
    description: 'A concise, high-signal post that turns one sharp observation into a memorable takeaway.',
    wordRange: '80-160 words',
  },
  {
    value: 'launch-post',
    label: 'Launch Post',
    description: 'A more momentum-driven format for announcements, launches, and campaign moments that need polish.',
    wordRange: '100-200 words',
  },
];

export default function PostGeneratePage() {
  return (
    <ShortformTopicPage
      contentType="post"
      pageTitle="Generate Post"
      heading="Start with your own post topic"
      subtitle="Use this when the team already knows the angle and just needs a clean route into the managed shortform workflow."
      accentSurfaceClassName="from-blue-50 via-white to-cyan-50"
      accentButtonClassName="bg-blue-600 hover:bg-blue-700"
      accentTextClassName="text-blue-700"
      backPath="/posts/intelligence"
      templatePath="/posts/template"
      defaultFormat="authority-post"
      formatOptions={POST_FORMATS}
    />
  );
}

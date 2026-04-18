import ManagedIntelligencePage from '../../components/content/ManagedIntelligencePage';

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

export default function PostIntelligencePage() {
  return (
    <ManagedIntelligencePage
      contentType="post"
      pageTitle="Post Intelligence"
      eyebrow="Post Intelligence"
      heading="Create a Post"
      icon="P"
      accentClassName="text-blue-700"
      accentSurfaceClassName="from-blue-50 via-white to-cyan-50"
      backPath="/posts/create"
      createPath="/posts/create"
      templatePath="/posts/template"
      generatePath="/posts/generate"
      formatOptions={POST_FORMATS}
      defaultFormat="authority-post"
    />
  );
}

import FormatSelectionPage from '../../components/content/FormatSelectionPage';

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

export default function PostCreatePage() {
  return (
    <FormatSelectionPage
      title="Create a Post"
      subtitle="Choose the shortform direction that best fits the moment, the message, and the level of authority you want the brand to project."
      icon="P"
      formats={POST_FORMATS}
      generatePath="/posts/intelligence"
      accentColor="blue"
      pageTitle="Create Post"
    />
  );
}

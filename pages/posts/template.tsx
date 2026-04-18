import ManagedTemplateSelectionPage from '../../components/content/ManagedTemplateSelectionPage';

export default function PostTemplatePage() {
  return (
    <ManagedTemplateSelectionPage
      contentType="post"
      pageTitle="Post"
      heading="Choose a Post Template"
      subtitle="Select the shortform structure that best fits the hook, proof, and call-to-action shape you need."
      accentColor="blue"
      backPath="/posts/intelligence"
      generatePath="/posts/result"
      suggestionsPath="/posts/suggestions"
    />
  );
}

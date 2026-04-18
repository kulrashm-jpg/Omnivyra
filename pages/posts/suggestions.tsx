import ManagedSuggestionsPage from '../../components/content/ManagedSuggestionsPage';

export default function PostSuggestionsPage() {
  return (
    <ManagedSuggestionsPage
      contentType="post"
      title="Post Suggestions"
      stepLabel="Step 4 of 5 - Refine the brief"
      heading="Refine Your Post"
      theme="blue"
      generatePath="/posts/result"
      backPath="/posts/template"
    />
  );
}

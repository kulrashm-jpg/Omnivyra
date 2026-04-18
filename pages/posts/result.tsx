import ShortformResultPage from '../../components/content/ShortformResultPage';

export default function PostResultPage() {
  return (
    <ShortformResultPage
      contentType="post"
      pageTitle="Generated Post"
      heading="Your post is ready"
      accentSurfaceClassName="from-blue-50 via-white to-cyan-50"
      accentButtonClassName="bg-blue-600 hover:bg-blue-700"
      accentBadgeClassName="bg-blue-100 text-blue-700"
      createPath="/posts/create"
    />
  );
}

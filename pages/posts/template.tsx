import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function PostTemplateCompatibilityPage() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    void router.replace({
      pathname: '/posts/intelligence',
      query: router.query,
    });
  }, [router]);

  return null;
}

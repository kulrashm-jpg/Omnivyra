/**
 * Platform Configuration Page
 *
 * G1.5: Single Connect entry — redirects to Community AI Connectors.
 * Use /community-ai/connectors as the canonical Connect Accounts entry point.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function PlatformConfiguration() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/community-ai/connectors');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-gray-600">Redirecting to Connect Accounts…</p>
    </div>
  );
}


/**
 * Community Engagement — redirect to Engagement Command Center
 */
import React, { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function CommunityEngagementPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/engagement');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center text-gray-500 text-sm">Redirecting to Engagement Console...</div>
    </div>
  );
}

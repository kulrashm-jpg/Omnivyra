/**
 * Legacy create campaign route.
 * Redirects to Campaign Planner (canonical creation entry).
 */

import React, { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function CreateCampaign() {
  const router = useRouter();

  useEffect(() => {
    const companyId = router.query.companyId;
    const params = new URLSearchParams({ mode: 'direct' });
    if (typeof companyId === 'string' && companyId.trim()) params.set('companyId', companyId);
    router.replace(`/campaign-planner?${params.toString()}`);
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-500">Redirecting to Campaign Planner...</p>
    </div>
  );
}

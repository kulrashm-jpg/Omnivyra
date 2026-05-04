import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';
import CommunityAiLayout from '../../components/community-ai/CommunityAiLayout';
import SectionCard from '../../components/community-ai/SectionCard';
import { apiFetch } from '@/lib/apiFetch';
import type { PendingAction } from '../../components/community-ai/types';
import {
  validateActionAgainstPlaybook,
  type PlaybookValidationInput,
} from '../../backend/services/playbooks/playbookValidator';

const tabs = ['Pending', 'Scheduled', 'Completed', 'Skipped'];

import { useCommunityActions } from '../../hooks/useCommunityActions';
import CommunityActionsView from '../../components/CommunityActionsView';
export default function CommunityActionsPage() {
  const d = useCommunityActions();
  return <CommunityActionsView d={d} />;
}

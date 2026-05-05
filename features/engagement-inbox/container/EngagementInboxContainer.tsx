import { useEngagementInboxPage } from '@/features/engagement-inbox/hooks/useEngagementInboxPage';
import EngagementInboxView from '@/features/engagement-inbox/view/EngagementInboxView';

export default function EngagementInboxContainer() {
  const { state, actions } = useEngagementInboxPage();
  return <EngagementInboxView state={state} actions={actions} />;
}

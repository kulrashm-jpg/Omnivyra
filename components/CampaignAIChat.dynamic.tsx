import dynamic from 'next/dynamic';

const CampaignAIChat = dynamic(() => import('./CampaignAIChat'), {
  ssr: false,
  loading: () => null,
});

export default CampaignAIChat;

import { runCommunityAiScheduler } from '../backend/services/communityAiScheduler';

const run = async () => {
  const result = await runCommunityAiScheduler();
  console.log('COMMUNITY_AI_SCHEDULER_RESULT', result);
};

run().catch((error) => {
  console.error('COMMUNITY_AI_SCHEDULER_FAILED', error);
  process.exit(1);
});

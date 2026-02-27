export {};

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { runCampaignAiPlan } = require('../backend/services/campaignAiOrchestrator');
  const campaignId = process.argv[2];
  if (!campaignId) {
    throw new Error('Usage: ts-node scripts/debug-weekly-sim.ts <campaignId>');
  }

  const result = await runCampaignAiPlan({
    campaignId,
    mode: 'generate_plan',
    message: 'Simulate one weekly card debug',
  });

  const week = (result.plan?.weeks || [])[0] ?? null;
  console.log('[weekly-debug][post-enrichment-week][script]', JSON.stringify(week, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

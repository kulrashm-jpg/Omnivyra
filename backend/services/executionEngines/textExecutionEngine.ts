import { processBlockSchedule, type BlockDailyPlanRow } from '../boltScheduleBlockProcessor';

export function createTextExecutionEngine() {
  return {
    async schedule(input: {
      campaignId: string;
      dailyPlans: BlockDailyPlanRow[];
      campaign: { start_date: string; user_id: string; company_id?: string | null };
      accountMap: Map<string, string>;
      normalize: (p: string) => string | null;
      typeMapByPlatform: Record<string, Record<string, string>>;
      onProgress?: (event: any) => void;
    }) {
      return processBlockSchedule(
        input.campaignId,
        input.dailyPlans,
        input.campaign,
        input.accountMap,
        input.normalize,
        input.typeMapByPlatform,
        input.onProgress ? { onProgress: input.onProgress } : undefined
      );
    },
  };
}

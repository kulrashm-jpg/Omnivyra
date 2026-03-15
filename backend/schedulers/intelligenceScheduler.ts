/**
 * Intelligence Scheduler
 * Cron: 0 3 * * * (3 AM daily)
 * Runs runDailyIntelligence() to orchestrate Campaign Health, Strategic Insights, Opportunity Detection.
 */

import { runDailyIntelligence } from '../jobs/dailyIntelligenceScheduler';

const CRON_EXPRESSION = '0 3 * * *';

export { runDailyIntelligence, CRON_EXPRESSION };

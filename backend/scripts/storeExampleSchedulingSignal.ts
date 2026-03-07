/**
 * Phase 6A: Store an example scheduling signal.
 * Run after migration: database/scheduling_intelligence_signals.sql
 *
 * Usage: npx ts-node -r tsconfig-paths/register backend/scripts/storeExampleSchedulingSignal.ts
 * Optional: EXAMPLE_COMPANY_ID=uuid node ...
 */

import { recordSignal, getSignalsForWeek } from '../services/signalIntelligenceEngine';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const EXAMPLE_COMPANY_ID = process.env.EXAMPLE_COMPANY_ID ?? '00000000-0000-0000-0000-000000000001';

async function main() {
  console.log('Phase 6A: Storing example scheduling signal...');
  console.log('Company ID:', EXAMPLE_COMPANY_ID);

  const row = await recordSignal({
    company_id: EXAMPLE_COMPANY_ID,
    signal_type: 'industry_trend',
    signal_source: 'news',
    signal_topic: 'AI regulation',
    signal_score: 0.82,
    signal_timestamp: '2025-03-07T10:00:00Z',
    metadata: { region: 'global', example: true },
  });

  console.log('Stored signal:', JSON.stringify(row, null, 2));

  const weekStart = new Date('2025-03-03');
  const weekEnd = new Date('2025-03-09');
  const signals = await getSignalsForWeek(EXAMPLE_COMPANY_ID, weekStart, weekEnd);
  console.log('Retrieved signals for week:', signals.length);
  if (signals.length > 0) {
    console.log('First signal:', signals[0]!.signal_topic, 'score:', signals[0]!.signal_score);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

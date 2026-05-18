import { runPublishingWorker } from '../backend/services/publishingJobService';

const limitArg = Number(process.argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1] || 5);
const workerId = process.argv.find((arg) => arg.startsWith('--worker-id='))?.split('=')[1] || `cli-publisher-${Date.now()}`;

runPublishingWorker({ workerId, limit: Number.isFinite(limitArg) ? limitArg : 5 })
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });

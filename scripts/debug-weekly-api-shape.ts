export {};

async function main() {
  const campaignId = process.argv[2];
  if (!campaignId) {
    throw new Error('Usage: ts-node scripts/debug-weekly-api-shape.ts <campaignId>');
  }

  // eslint-disable-next-line
  const handler = require('../pages/api/campaigns/get-weekly-plans').default;

  const req = {
    method: 'GET',
    query: { campaignId },
  } as any;

  let payload: any = null;
  const res = {
    status(code: number) {
      return {
        json(data: any) {
          payload = { code, data };
          return data;
        },
      };
    },
  } as any;

  await handler(req, res);
  const firstWeek = Array.isArray(payload?.data) ? payload.data[0] ?? null : null;
  console.log('[weekly-debug][api-response-week][script]', JSON.stringify(firstWeek, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

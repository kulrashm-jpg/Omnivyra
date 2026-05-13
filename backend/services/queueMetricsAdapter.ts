export type QueueMetricsSnapshot = {
  redisMemoryMb: number | null;
  redisConnected: boolean;
};

export async function getQueueMetricsSnapshot(): Promise<QueueMetricsSnapshot> {
  const { getInstrumentedClient } = await import('../queue/bullmqClient');
  const client = getInstrumentedClient('metrics');
  const info = await client.info('memory');
  const match = info.match(/used_memory:(\d+)/);

  return {
    redisMemoryMb: match
      ? Math.round(parseInt(match[1], 10) / 1024 / 1024 * 10) / 10
      : null,
    redisConnected: true,
  };
}

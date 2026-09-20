/**
 * startContentWorkers refuses to start a PARTIAL generic topology.
 *
 * Every queue the manifest assigns to the generic-content family must have a
 * CONTENT_QUEUE_CONFIG entry. If one does not, registration fails loudly
 * (registerSharedConsumers reports the family as FAILED) before ANY generic
 * worker is constructed, rather than starting some queues and silently
 * leaving another without a consumer.
 */
describe('startContentWorkers — generic queue without a config entry', () => {
  it('throws before constructing any worker', async () => {
    const constructed: string[] = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock('bullmq', () => ({
        Worker: class {
          constructor(name: string) { constructed.push(name); }
          on() { return this; }
        },
        Queue: class { on() { return this; } },
      }));
      jest.doMock('../../queue/bullmqClient', () => ({ getConnectionConfig: () => ({}), getQueuePrefix: () => 'bull' }));
      jest.doMock('../../observability/queueObservability', () => ({ observeQueueEvents: jest.fn() }));
      jest.doMock('../../queue/workerTopologyManifest', () => ({
        genericContentQueueNames: () => ['content-blog', 'content-unconfigured'],
      }));
      const { startContentWorkers } = await import('../../queue/contentGenerationQueues');
      await expect(startContentWorkers(async () => undefined)).rejects.toThrow(/content-unconfigured/);
    });
    expect(constructed).toEqual([]);
  });
});

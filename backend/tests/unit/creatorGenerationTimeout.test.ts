import { withCreatorTimeout } from '../../services/creator/generateRoute/generatePrep';

describe('Creator generation timeout', () => {
  it('reports an unknown outcome without cancelling the underlying work', async () => {
    let workCompleted = false;
    let finishWork: (() => void) | undefined;
    const work = new Promise<string>((resolve) => {
      finishWork = () => {
        workCompleted = true;
        resolve('completed');
      };
    });

    const timeoutError = await withCreatorTimeout(work, 'Creator generation', 1)
      .catch((error: unknown) => error);
    expect(timeoutError).toBeInstanceOf(Error);
    expect(timeoutError).toMatchObject({ statusCode: 504 });
    expect(timeoutError instanceof Error ? timeoutError.message : '')
      .toMatch(/timed out before its outcome could be confirmed.*a retry may start another generation/i);
    expect(workCompleted).toBe(false);

    finishWork?.();
    await expect(work).resolves.toBe('completed');
    expect(workCompleted).toBe(true);
  });
});

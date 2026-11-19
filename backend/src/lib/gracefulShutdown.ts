export type ShutdownWaitResult =
  | { status: 'completed' }
  | { status: 'failed'; error: unknown }
  | { status: 'timed-out' };

export async function waitForShutdownTask(
  task: Promise<unknown>,
  timeoutMs: number
): Promise<ShutdownWaitResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task.then<ShutdownWaitResult, ShutdownWaitResult>(
        () => ({ status: 'completed' }),
        (error: unknown) => ({ status: 'failed', error })
      ),
      new Promise<ShutdownWaitResult>((resolve) => {
        timer = setTimeout(() => resolve({ status: 'timed-out' }), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

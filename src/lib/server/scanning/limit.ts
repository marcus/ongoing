export function createConcurrencyLimit(
  concurrency: number
): <T>(operation: () => Promise<T>) => Promise<T> {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new RangeError('Concurrency must be a positive integer');
  let active = 0;
  const waiting: (() => void)[] = [];

  return async <T>(operation: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await operation();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

import type { Handle } from '@sveltejs/kit';

let scheduled = false;

export const handle: Handle = ({ event, resolve }) => {
  // Do not await startup work: the first page renders immediately from the durable cache.
  if (!scheduled) {
    scheduled = true;
    setTimeout(() => {
      void import('$lib/server/scanning/runtime').then(({ catalogScanScheduler }) =>
        catalogScanScheduler.start()
      );
    }, 0);
  }
  return resolve(event);
};

import type { CatalogRepository } from '$lib/server/catalog/repository';
import {
  encodeServerSentEvent,
  isTerminalProgressEvent,
  type ScanProgressBus,
  type ScanProgressEvent
} from './progress';

const encoder = new TextEncoder();

export interface ScanEventResponseOptions {
  runId: string;
  lastEventId: number;
  signal: AbortSignal;
  repository: Pick<CatalogRepository, 'getScanRun'>;
  progress: ScanProgressBus;
}

export function createScanEventResponse(options: ScanEventResponseOptions): Response {
  let unsubscribe: () => void = () => undefined;
  let detachAbort: () => void = () => undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        detachAbort();
        controller.close();
      };
      const send = (event: ScanProgressEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeServerSentEvent(event)));
        if (isTerminalProgressEvent(event)) close();
      };
      for (const event of options.progress.eventsAfter(options.runId, options.lastEventId))
        send(event);
      if (closed) return;

      // EventSource reconnects automatically. Re-send the terminal event when its cursor
      // is already current so the client can observe termination and close itself again.
      if (options.progress.isTerminal(options.runId)) {
        const terminal = options.progress.eventsAfter(options.runId).at(-1);
        if (terminal) send(terminal);
        else close();
        return;
      }

      const run = options.repository.getScanRun(options.runId);
      if (run?.status !== 'running') {
        send({
          id: options.lastEventId + 1,
          runId: options.runId,
          type:
            run?.status === 'completed'
              ? 'completed'
              : run?.status === 'cancelled'
                ? 'cancelled'
                : 'failed',
          at: run?.finishedAt ?? new Date().toISOString(),
          discoveredCount: run?.discoveredCount,
          updatedCount: run?.updatedCount,
          errorCount: run?.errorCount
        });
        return;
      }
      unsubscribe = options.progress.subscribe(options.runId, send);
      const abort = () => close();
      options.signal.addEventListener('abort', abort, { once: true });
      detachAbort = () => options.signal.removeEventListener('abort', abort);
    },
    cancel() {
      unsubscribe();
      detachAbort();
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    }
  });
}

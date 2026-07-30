export type ScanProgressType =
  | 'started'
  | 'discovered'
  | 'project-started'
  | 'collector-completed'
  | 'collector-failed'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ScanProgressEvent {
  id: number;
  runId: string;
  type: ScanProgressType;
  at: string;
  projectId?: string;
  collector?: 'git' | 'loc' | 'issues' | 'stack';
  discoveredCount?: number;
  updatedCount?: number;
  errorCount?: number;
  message?: string;
}

type Listener = (event: ScanProgressEvent) => void;

const TERMINAL_TYPES = new Set<ScanProgressType>(['completed', 'failed', 'cancelled']);

export function isTerminalProgressEvent(event: ScanProgressEvent): boolean {
  return TERMINAL_TYPES.has(event.type);
}

export class ScanProgressBus {
  private nextId = 1;
  private readonly eventsByRun = new Map<string, ScanProgressEvent[]>();
  private readonly listenersByRun = new Map<string, Set<Listener>>();

  publish(event: Omit<ScanProgressEvent, 'id'>): ScanProgressEvent {
    const events = this.eventsByRun.get(event.runId) ?? [];
    const terminal = events.at(-1);
    if (terminal && isTerminalProgressEvent(terminal)) return terminal;
    const complete = { ...event, id: this.nextId++ };
    events.push(complete);
    this.eventsByRun.set(event.runId, events);
    for (const listener of this.listenersByRun.get(event.runId) ?? []) listener(complete);
    if (isTerminalProgressEvent(complete)) this.listenersByRun.delete(event.runId);
    return complete;
  }

  eventsAfter(runId: string, lastEventId = 0): ScanProgressEvent[] {
    return (this.eventsByRun.get(runId) ?? []).filter(({ id }) => id > lastEventId);
  }

  isTerminal(runId: string): boolean {
    const events = this.eventsByRun.get(runId) ?? [];
    return events.length > 0 && isTerminalProgressEvent(events.at(-1)!);
  }

  subscribe(runId: string, listener: Listener): () => void {
    if (this.isTerminal(runId)) return () => undefined;
    const listeners = this.listenersByRun.get(runId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listenersByRun.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listenersByRun.delete(runId);
    };
  }

  clear(runId: string): void {
    this.eventsByRun.delete(runId);
    this.listenersByRun.delete(runId);
  }
}

export const scanProgress = new ScanProgressBus();

export function encodeServerSentEvent(event: ScanProgressEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

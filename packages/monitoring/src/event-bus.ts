import type { ProjectEvent } from '@contracts/index';

type Listener = (event: ProjectEvent) => void;

export class EventBus {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: ProjectEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

import { EventEmitter } from 'node:events';
import type { ProjectEvent } from '../../contracts/src';

export type NotificationKind = 'info' | 'warning' | 'error' | 'success';

export interface Notification {
  id: string;
  projectId?: string;
  kind: NotificationKind;
  title: string;
  body: string;
  timestamp: string;
}

export class NotificationService extends EventEmitter {
  private notifications: Notification[] = [];
  private lastDailySummaryAt = 0;

  push(notification: Omit<Notification, 'id' | 'timestamp'>): Notification {
    const entry: Notification = { ...notification, id: crypto.randomUUID(), timestamp: new Date().toISOString() };
    this.notifications.push(entry);
    if (this.notifications.length > 200) this.notifications = this.notifications.slice(-200);
    this.emit('notification', entry);
    return entry;
  }

  list(): Notification[] { return [...this.notifications].reverse(); }

  aggregateRecentEvents(events: ProjectEvent[], now = Date.now()): Notification | undefined {
    if (!events.length) return undefined;
    const summaries = events.map((event) => `${event.type}: ${String(event.payload.message ?? event.payload.summary ?? event.type)}`).join('; ');
    return this.push({ kind: 'info', title: 'Project signals', body: summaries.slice(0, 240) });
  }

  maybeDailySummary(projectName: string, eventCount: number, now = Date.now()): Notification | undefined {
    if (now - this.lastDailySummaryAt < 12 * 60 * 60 * 1000) return undefined;
    if (eventCount === 0) return undefined;
    this.lastDailySummaryAt = now;
    return this.push({ kind: 'info', title: `${projectName} while you were away`, body: `Observed ${eventCount} relevant signals since the last summary.` });
  }
}

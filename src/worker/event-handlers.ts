import type { EventEnvelope } from '../events/domain-events.js';

export type EventHandler = (event: EventEnvelope) => Promise<void>;
/** Queue name → handler. Provided by WorkerModule. */
export const EVENT_HANDLERS = Symbol('EVENT_HANDLERS');
export type EventHandlers = Record<string, EventHandler>;

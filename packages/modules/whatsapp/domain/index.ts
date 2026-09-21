export * from './access.js';
export * from './conversation.js';
export * from './intent.js';
export * from './message.js';
export * from './service-window.js';
export type { DeadlineLine, Wording } from './replies.js';

/**
 * The bot's words, reached as `replies.STOPPED` rather than imported one by
 * one. There are a dozen of them and they are all the same kind of thing, so a
 * namespace reads better at the call site than a dozen bare names would.
 */
export * as replies from './replies.js';

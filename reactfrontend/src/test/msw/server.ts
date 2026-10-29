import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/**
 * The MSW server, shared by every integration test.
 *
 * `setupServer` (node) rather than `setupWorker` (browser): Vitest runs in Node
 * with jsdom, so there is no service worker. The browser variant is for running
 * the real app against mocks during development, which is a genuinely useful
 * second use of the same handlers - write them once, use them in tests and in a
 * demo mode.
 */
export const server = setupServer(...handlers);

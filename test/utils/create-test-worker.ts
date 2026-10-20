import { Test, type TestingModule } from '@nestjs/testing';
import {
  CHAT_FETCH,
  CHAT_SLEEP,
} from '../../src/modules/chat-channel/google-chat.client.js';
import { Maintenance } from '../../src/worker/maintenance.js';
import { WorkerModule } from '../../src/worker/worker.module.js';
import { ensureTestVhost } from './rabbit.js';

export async function createTestWorker(
  options: { fetch?: typeof fetch } = {},
): Promise<TestingModule> {
  await ensureTestVhost();
  // The minute ticker never runs in tests: a digest firing mid-test would
  // reach the fake Google Chat. Tests call runDigest and the cleanup directly.
  const builder = Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(Maintenance)
    .useValue({ start: () => {}, stop: async () => {}, tick: async () => {} })
    .overrideProvider(CHAT_SLEEP)
    .useValue(async () => {});
  if (options.fetch) {
    builder.overrideProvider(CHAT_FETCH).useValue(options.fetch);
  }
  const worker = await builder.compile();
  await worker.init(); // runs onApplicationBootstrap: consumers and relay
  return worker;
}

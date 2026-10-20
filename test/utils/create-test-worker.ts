import { Test, type TestingModule } from '@nestjs/testing';
import { Maintenance } from '../../src/worker/maintenance.js';
import { WorkerModule } from '../../src/worker/worker.module.js';
import { ensureTestVhost } from './rabbit.js';

export async function createTestWorker(): Promise<TestingModule> {
  await ensureTestVhost();
  // The minute ticker never runs in tests: a digest firing mid-test would
  // reach the fake Google Chat. Tests call runDigest and the cleanup directly.
  const worker = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(Maintenance)
    .useValue({ start: () => {}, stop: async () => {}, tick: async () => {} })
    .compile();
  await worker.init(); // runs onApplicationBootstrap: consumers and relay
  return worker;
}

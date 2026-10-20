import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  // SIGTERM: stop taking messages, finish those in progress, then exit.
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
}

await bootstrap();

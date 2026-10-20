import { Injectable } from '@nestjs/common';

/** Minute ticker for digests and cleanup; Task 13 fills it. */
@Injectable()
export class Maintenance {
  start(): void {}

  async stop(): Promise<void> {}

  async tick(): Promise<void> {}
}
